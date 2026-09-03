/**
 * Recognises a handwritten symbol from the trajectory of its strokes.
 *
 * The previous classifier drew the strokes into a bitmap and compared it with
 * the same characters rendered in a printed font. Handwriting does not look
 * like a printed font, and it scored 42 % on a bench of ordinary symbols: every
 * round shape came out as "b", a "t" read as "+" with 0.96 confidence.
 *
 * This is the $P point-cloud recogniser (Vatavu, Anthony and Wobbrock, 2012).
 * A symbol is a cloud of resampled points, uniformly scaled and centred, and
 * the distance between two clouds is a greedy nearest-point matching. It cares
 * about the shape and not about the order, the direction or the number of
 * strokes, which is what handwriting varies most: people write "=" upwards or
 * downwards, "x" in either diagonal first, and "5" in one stroke or two.
 *
 * Rotation is deliberately NOT normalised. In maths, `+` rotated is `×` and `<`
 * rotated is `>`; a rotation-invariant matcher would confuse exactly the pairs
 * that must stay apart.
 */

import { HANDWRITTEN_SHAPES } from "./ink-prototypes-odbl";

export interface ShapePoint {
	x: number;
	y: number;
	/** Which stroke this point came from; the matcher keeps them apart. */
	id: number;
}

export interface ShapeMatch {
	value: string;
	/** 0..1, from the cloud distance. */
	score: number;
	/** The raw cloud distance: 0 is identical, and past REJECT_DISTANCE it is a guess. */
	distance: number;
}

/**
 * How far a match can sit and still be believed. Measured on single symbols:
 * every one the library knows lands at 1.26 or better (median 0.09), and the
 * first thing it does not know lands at 1.28.
 */
export const REJECT_DISTANCE = 1.2;

/**
 * The second half of the test. A recognised symbol has one answer standing
 * clear of the rest — a handwritten 9 beats the runner-up by 0.72 — while ink
 * the library cannot name has several equally mediocre answers: a spiral
 * offers * at 1.34 and ∂ at 1.40. A poor best with nothing behind it is a
 * guess, whatever its absolute distance.
 */
export const AMBIGUOUS_BEST = 0.85;

/**
 * How close the whole ink has to be for it to be one symbol rather than an
 * expression. Recognised symbols match at 0.09 on average and 0.38 at the
 * ninth decile, while a written expression compared against a single prototype
 * lands above 1.5. Kept well down that range because the cost of being wrong
 * is asymmetric: reading "2x" as one symbol loses the expression entirely.
 */
export const WHOLE_SYMBOL_DISTANCE = 0.35;
export const AMBIGUOUS_MARGIN = 0.1;

/** True when the ranked matches do not add up to an answer. */
export function shouldReject(matches: ShapeMatch[]): boolean {
	if (!matches.length) return true;
	const best = matches[0].distance;
	if (best > REJECT_DISTANCE) return true;
	const second = matches[1]?.distance ?? best + 1;
	return best > AMBIGUOUS_BEST && second - best < AMBIGUOUS_MARGIN;
}

/** Points per cloud. 32 is the number $P was tuned on and it is fast enough. */
const CLOUD_POINTS = 32;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function pathLength(points: ShapePoint[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		if (points[i].id !== points[i - 1].id) continue;
		total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
	}
	return total;
}

/** Even spacing along the path, so speed while writing stops mattering. */
function resample(points: ShapePoint[], n: number): ShapePoint[] {
	const interval = pathLength(points) / (n - 1);
	if (!Number.isFinite(interval) || interval <= 0) {
		// A dot, or every point on top of the next: spread the cloud over them.
		return Array.from({ length: n }, (_, i) => ({ ...points[Math.min(i, points.length - 1)] }));
	}
	const out: ShapePoint[] = [{ ...points[0] }];
	let accumulated = 0;
	const working = points.map(p => ({ ...p }));
	for (let i = 1; i < working.length; i++) {
		if (working[i].id !== working[i - 1].id) { out.push({ ...working[i] }); continue; }
		const distance = Math.hypot(working[i].x - working[i - 1].x, working[i].y - working[i - 1].y);
		if (accumulated + distance >= interval) {
			const ratio = (interval - accumulated) / distance;
			const inserted = {
				x: working[i - 1].x + ratio * (working[i].x - working[i - 1].x),
				y: working[i - 1].y + ratio * (working[i].y - working[i - 1].y),
				id: working[i].id
			};
			out.push(inserted);
			working.splice(i, 0, { ...inserted });
			accumulated = 0;
		} else {
			accumulated += distance;
		}
	}
	while (out.length < n) out.push({ ...out[out.length - 1] });
	return out.slice(0, n);
}

/**
 * Uniform scaling into a unit box, keeping the aspect ratio: a minus sign and
 * a vertical bar are the same cloud once each is stretched to a square.
 */
function scaleAndCentre(points: ShapePoint[]): ShapePoint[] {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const p of points) {
		minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
	}
	const size = Math.max(maxX - minX, maxY - minY) || 1;
	const scaled = points.map(p => ({ x: (p.x - minX) / size, y: (p.y - minY) / size, id: p.id }));
	let cx = 0, cy = 0;
	for (const p of scaled) { cx += p.x; cy += p.y; }
	cx /= scaled.length; cy /= scaled.length;
	return scaled.map(p => ({ x: p.x - cx, y: p.y - cy, id: p.id }));
}

export function toCloud(strokes: { x: number; y: number }[][]): ShapePoint[] | null {
	const points: ShapePoint[] = [];
	strokes.forEach((stroke, id) => {
		for (const p of stroke) points.push({ x: p.x, y: p.y, id });
	});
	if (points.length < 2) {
		if (points.length === 0) return null;
		// A single tap is a dot: give it a cloud of its own so it can be matched.
		return Array.from({ length: CLOUD_POINTS }, () => ({ ...points[0] }));
	}
	return scaleAndCentre(resample(points, CLOUD_POINTS));
}

// ---------------------------------------------------------------------------
// $P distance
// ---------------------------------------------------------------------------

/** Greedy matching from `a` to `b` starting at one index, weighted by rank. */
function cloudDistance(a: ShapePoint[], b: ShapePoint[], start: number): number {
	const matched = new Array<boolean>(b.length).fill(false);
	let sum = 0;
	let i = start;
	do {
		let best = Infinity;
		let index = -1;
		for (let j = 0; j < b.length; j++) {
			if (matched[j]) continue;
			const d = Math.hypot(a[i].x - b[j].x, a[i].y - b[j].y) + (a[i].id === b[j].id ? 0 : 0.02);
			if (d < best) { best = d; index = j; }
		}
		if (index >= 0) matched[index] = true;
		// Points matched early count for more: a wrong start is punished.
		sum += (1 - ((i - start + a.length) % a.length) / a.length) * best;
		i = (i + 1) % a.length;
	} while (i !== start);
	return sum;
}

export function shapeDistance(a: ShapePoint[], b: ShapePoint[]): number {
	const step = Math.max(1, Math.round(a.length ** 0.5));
	let best = Infinity;
	for (let i = 0; i < a.length; i += step) {
		best = Math.min(best, cloudDistance(a, b, i), cloudDistance(b, a, i));
	}
	return best;
}

// ---------------------------------------------------------------------------
// A cheap sieve
// ---------------------------------------------------------------------------

/** Cells across the grid a signature counts points into. */
const GRID = 4;

/**
 * How the points spread over a 4×4 grid, plus the shape's aspect ratio. Two
 * clouds that are nothing alike differ here already, at seventeen subtractions
 * instead of twelve thousand.
 */
export function signatureOf(cloud: ShapePoint[]): Float32Array {
	const signature = new Float32Array(GRID * GRID + 1);
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const p of cloud) {
		minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
	}
	const w = maxX - minX || 1e-6;
	const h = maxY - minY || 1e-6;
	for (const p of cloud) {
		const cx = Math.min(GRID - 1, Math.floor((p.x - minX) / w * GRID));
		const cy = Math.min(GRID - 1, Math.floor((p.y - minY) / h * GRID));
		signature[cy * GRID + cx] += 1 / cloud.length;
	}
	// Aspect, so a minus sign is sieved out when the ink is a vertical bar.
	signature[GRID * GRID] = Math.min(2, w / h) / 2;
	return signature;
}

function signatureDistance(a: Float32Array, b: Float32Array): number {
	let total = 0;
	for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
	return total;
}

/** Prototypes that survive the sieve and get a real comparison. */
const SHORTLIST = 150;

/** Examples of a symbol averaged into its score; see the note on imbalance. */
const VOTES = 3;

// ---------------------------------------------------------------------------
// The prototypes
// ---------------------------------------------------------------------------

type Pt = [number, number];
const TAU = Math.PI * 2;

/**
 * A smooth line through every control point (Catmull-Rom). Handwriting is
 * curves through places the pen went, not arcs of a compass, and control
 * points can be drawn and checked — dev-harness/shape-render.mjs does exactly
 * that.
 */
function path(controls: Pt[], perSegment = 6): Pt[] {
	if (controls.length < 3) return straight(controls);
	const pts = [controls[0], ...controls, controls[controls.length - 1]];
	const out: Pt[] = [];
	for (let i = 1; i < pts.length - 2; i++) {
		const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
		for (let s = 0; s < perSegment; s++) {
			const t = s / perSegment, t2 = t * t, t3 = t2 * t;
			out.push([
				0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
				0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
			]);
		}
	}
	out.push(pts[pts.length - 1]);
	return out;
}

function straight(controls: Pt[]): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i < controls.length - 1; i++) {
		for (let s = 0; s < 8; s++) {
			const t = s / 8;
			out.push([controls[i][0] + (controls[i + 1][0] - controls[i][0]) * t, controls[i][1] + (controls[i + 1][1] - controls[i][1]) * t]);
		}
	}
	out.push(controls[controls.length - 1]);
	return out;
}

/** A straight mark. */
const line = (x1: number, y1: number, x2: number, y2: number): Pt[] => straight([[x1, y1], [x2, y2]]);

/** A closed ring, clockwise from the top. */
const ring = (cx: number, cy: number, rx: number, ry: number, n = 24): Pt[] =>
	Array.from({ length: n }, (_, i) => {
		const t = (-0.25 + i / (n - 1)) * TAU;
		return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as Pt;
	});

interface Prototype {
	value: string;
	cloud: ShapePoint[];
	signature: Float32Array;
	/** How often the symbol turns up in a student's formula, 0..1. */
	prior: number;
}

/**
 * How each symbol is written, in a 0..70 box with the baseline near 64.
 * Several shapes per symbol where people genuinely differ: a "1" with and
 * without its flag, a "7" with and without the bar, an "a" whose bowl is a
 * separate stroke or one continuous line.
 */
const SHAPES: [string, Pt[][]][] = [
	["0", [ring(32, 34, 15, 26)]],
	["0", [ring(32, 34, 11, 26)]],
	["1", [line(32, 6, 32, 64)]],
	["1", [line(18, 16, 32, 6), line(32, 6, 32, 64)]],
	["1", [line(18, 16, 32, 6), line(32, 6, 32, 64), line(16, 64, 48, 64)]],
	["2", [path([[14, 18], [22, 6], [40, 6], [50, 18], [40, 34], [14, 62], [56, 62]])]],
	["3", [path([[16, 10], [38, 4], [52, 16], [38, 30], [28, 32], [42, 34], [56, 48], [40, 64], [16, 60]])]],
	["3", [path([[16, 10], [40, 6], [50, 20], [34, 32]]), path([[34, 32], [52, 40], [50, 58], [30, 64], [16, 58]])]],
	["4", [line(42, 6, 12, 44), line(12, 44, 58, 44), line(42, 6, 42, 64)]],
	["4", [path([[42, 6], [12, 44], [58, 44]]), line(42, 6, 42, 64)]],
	["5", [line(52, 8, 20, 8), line(20, 8, 18, 32), path([[18, 32], [40, 28], [54, 42], [42, 62], [18, 58]])]],
	["5", [path([[52, 8], [20, 8], [18, 32], [40, 28], [54, 42], [42, 62], [18, 58]])]],
	["6", [path([[48, 6], [30, 20], [22, 38], [24, 54], [38, 62], [50, 52], [44, 38], [28, 38], [22, 46]])]],
	["7", [line(12, 8, 56, 8), line(56, 8, 26, 64)]],
	["7", [path([[12, 8], [56, 8], [26, 64]]), line(20, 36, 46, 36)]],
	["8", [path([[36, 6], [24, 14], [38, 26], [48, 38], [38, 60], [22, 50], [34, 30], [44, 16], [36, 6]])]],
	["9", [path([[48, 20], [36, 8], [24, 18], [32, 32], [46, 28], [48, 16], [46, 40], [38, 64]])]],
	["9", [ring(34, 22, 12, 14), path([[46, 22], [46, 44], [38, 64]])]],
	["x", [line(14, 24, 50, 60), line(50, 24, 14, 60)]],
	["y", [line(16, 24, 34, 56), line(52, 24, 22, 82)]],
	["y", [path([[16, 24], [22, 44], [34, 56], [46, 40], [52, 24]]), path([[52, 24], [40, 60], [22, 82]])]],
	["z", [line(14, 26, 54, 26), line(54, 26, 14, 62), line(14, 62, 54, 62)]],
	["a", [ring(30, 44, 13, 15), line(44, 28, 44, 62)]],
	["a", [path([[46, 34], [32, 28], [20, 40], [26, 56], [42, 56], [46, 40], [44, 28], [44, 62]])]],
	["b", [line(16, 4, 16, 60), path([[16, 42], [30, 30], [44, 40], [42, 56], [26, 62], [16, 56]])]],
	["c", [path([[48, 30], [34, 24], [22, 34], [22, 50], [34, 62], [48, 56]])]],
	["d", [ring(30, 44, 13, 15), line(44, 4, 44, 62)]],
	["e", [path([[20, 46], [46, 42], [40, 28], [24, 34], [22, 52], [38, 62], [48, 54]])]],
	["f", [path([[46, 14], [36, 6], [26, 18], [24, 44], [20, 76]]), line(14, 34, 44, 34)]],
	["g", [ring(30, 42, 13, 14), path([[43, 30], [44, 62], [36, 78], [20, 74]])]],
	["h", [line(16, 4, 16, 62), path([[16, 40], [26, 30], [40, 32], [44, 44], [44, 62]])]],
	["i", [line(32, 30, 32, 62), line(32, 16, 32, 19)]],
	["j", [path([[38, 30], [38, 62], [30, 78], [16, 74]]), line(38, 16, 38, 19)]],
	["k", [line(16, 4, 16, 62), line(46, 34, 18, 50), line(22, 46, 48, 62)]],
	["l", [line(30, 4, 30, 62)]],
	["m", [line(12, 32, 12, 62), path([[12, 40], [20, 30], [28, 32], [30, 42], [30, 62]]), path([[30, 40], [38, 30], [46, 32], [48, 42], [48, 62]])]],
	["n", [line(16, 30, 16, 64), path([[16, 40], [26, 28], [40, 30], [44, 42], [44, 64]])]],
	["p", [line(16, 30, 16, 80), path([[16, 40], [30, 28], [44, 38], [42, 54], [26, 60], [16, 54]])]],
	["q", [ring(30, 42, 13, 14), line(44, 30, 44, 80)]],
	["r", [line(18, 30, 18, 62), path([[18, 40], [28, 30], [42, 32]])]],
	["s", [path([[46, 34], [32, 26], [22, 34], [34, 44], [44, 52], [32, 62], [18, 56]])]],
	["t", [line(32, 6, 32, 62), line(16, 24, 48, 24)]],
	["u", [path([[16, 30], [16, 52], [26, 62], [40, 56], [44, 30]]), line(44, 44, 44, 62)]],
	["v", [line(14, 28, 32, 62), line(32, 62, 50, 28)]],
	["w", [path([[10, 28], [20, 62], [30, 38], [40, 62], [50, 28]])]],
	["+", [line(10, 36, 56, 36), line(33, 14, 33, 58)]],
	["-", [line(10, 36, 56, 36)]],
	["=", [line(10, 28, 56, 28), line(10, 44, 56, 44)]],
	["*", [line(16, 20, 48, 52), line(48, 20, 16, 52)]],
	["/", [line(50, 8, 18, 62)]],
	[".", [line(30, 60, 33, 63)]],
	[",", [line(33, 58, 27, 72)]],
	["(", [path([[42, 8], [28, 24], [26, 40], [40, 62]])]],
	[")", [path([[22, 8], [36, 24], [38, 40], [24, 62]])]],
	["[", [line(46, 6, 24, 6), line(24, 6, 24, 62), line(24, 62, 46, 62)]],
	["]", [line(22, 6, 44, 6), line(44, 6, 44, 62), line(44, 62, 22, 62)]],
	["<", [line(50, 14, 16, 36), line(16, 36, 50, 58)]],
	[">", [line(18, 14, 52, 36), line(52, 36, 18, 58)]],
	["pi", [line(10, 24, 58, 24), path([[24, 24], [21, 44], [18, 62]]), path([[46, 24], [46, 48], [50, 62], [58, 58]])]],
	["alpha", [path([[48, 30], [34, 24], [22, 36], [26, 54], [40, 56], [46, 40], [44, 26], [50, 46], [56, 62]])]],
	["theta", [ring(32, 34, 14, 28), line(20, 34, 46, 34)]],
	["lambda", [line(18, 6, 48, 62), path([[36, 34], [24, 50], [16, 62]])]],
	["oo", [path([[20, 34], [10, 44], [20, 54], [34, 44], [48, 34], [58, 44], [48, 54], [34, 44], [20, 34]])]],
	// Written often enough to belong here: the honesty test found people drawing
	// them and the reader having nothing to offer.
	["~~", [path([[10, 28], [20, 22], [30, 32], [40, 26]]), path([[10, 44], [20, 38], [30, 48], [40, 42]])]],
	["!=", [line(10, 28, 54, 28), line(10, 44, 54, 44), line(40, 14, 24, 58)]],
	["+-", [line(10, 30, 56, 30), line(33, 8, 33, 52), line(10, 60, 56, 60)]],
	["-:", [line(10, 36, 56, 36), line(32, 20, 34, 22), line(32, 50, 34, 52)]],
	["xx", [line(16, 20, 48, 52), line(48, 20, 16, 52)]],
	["del", [path([[46, 16], [34, 8], [24, 18], [34, 30], [46, 38], [42, 56], [26, 60], [16, 50]])]],
	["Delta", [line(32, 8, 12, 60), line(12, 60, 52, 60), line(52, 60, 32, 8)]],
	["grad", [line(12, 10, 52, 10), line(52, 10, 32, 60), line(32, 60, 12, 10)]],
	["in", [path([[48, 22], [28, 20], [18, 34], [28, 50], [48, 48]]), line(22, 34, 42, 34)]],
	["<=", [line(50, 12, 16, 32), line(16, 32, 50, 50), line(16, 60, 50, 60)]],
	[">=", [line(18, 12, 52, 32), line(52, 32, 18, 50), line(18, 60, 52, 60)]],
	["mu", [line(14, 28, 16, 78), path([[16, 50], [22, 60], [34, 58], [40, 46], [40, 28]]), line(40, 46, 46, 60)]],
	["sqrt", [path([[4, 38], [12, 38], [22, 62], [34, 8], [64, 8]])]],
	["int", [path([[46, 12], [42, 4], [34, 8], [33, 24], [30, 44], [28, 60], [20, 64], [16, 56]])]],
	["sum", [line(56, 6, 14, 6), line(14, 6, 38, 34), line(38, 34, 14, 62), line(14, 62, 56, 62)]],
	// Most people draw a sigma without lifting the pen, and squarer than the
	// printed one; both shapes have to be in here or a hand-drawn sum reads as 3.
	["sum", [straight([[56, 6], [14, 6], [38, 34], [14, 62], [56, 62]])]],
	["sum", [straight([[52, 12], [16, 12], [34, 32], [16, 52], [52, 52]])]]
];

/**
 * A prior, because ink is ambiguous and the alternatives are not equally
 * likely: a round shape in a student's formula is a zero far more often than a
 * theta, and "a" beats "alpha". These are nudges, not decisions — a clear
 * match still wins against a common symbol that does not fit.
 */
/**
 * How much to add to a symbol's distance before comparing it with the others,
 * in the same units as the cloud distance (REJECT_DISTANCE is 1.45). It is a
 * prior, not a veto: a clear match still beats a common symbol that does not
 * fit. What it prevents is a shape being read as a set-theory operator merely
 * because nothing more ordinary was closer.
 *
 * Anything not listed is free: digits, the usual variables, and the arithmetic
 * a student writes on every line.
 */
const RARE: Record<string, number> = {
	// Greek, written now and then
	alpha: 0.14, beta: 0.2, gamma: 0.2, delta: 0.18, epsilon: 0.2, theta: 0.16,
	lambda: 0.18, mu: 0.2, rho: 0.22, sigma: 0.22, tau: 0.22, phi: 0.2,
	omega: 0.22, Delta: 0.18, Omega: 0.24, pi: 0.06,
	// Operators and relations that do turn up in schoolwork
	oo: 0.12, del: 0.14, grad: 0.2, "~~": 0.12, "!=": 0.1, "+-": 0.08,
	"xx": 0.12, "-:": 0.12, "<=": 0.08, ">=": 0.08, "==": 0.2, "->": 0.14,
	"=>": 0.2, "<=>": 0.24, prop: 0.26, perp: 0.24, parallel: 0.24, angle: 0.24,
	// Set theory and blackboard bold: real symbols, rarely in a hand-written line
	in: 0.22, notin: 0.26, sub: 0.28, sube: 0.28, uu: 0.28, nn: 0.28,
	emptyset: 0.3, AA: 0.24, EE: 0.24, RR: 0.26, NN: 0.28, ZZ: 0.28, QQ: 0.3,
	prod: 0.26,
	// Latin letters that are rare as maths variables
	j: 0.1, q: 0.1, w: 0.08, z: 0.06, k: 0.06, g: 0.06, e: 0.05, s: 0.05,
	u: 0.05, v: 0.05, r: 0.05
};

let prototypes: Prototype[] | null = null;

/** "x y,x y;x y,…" back into strokes. See ink-prototypes-odbl.ts. */
function parseShape(packed: string): { x: number; y: number }[][] {
	return packed.split(";").map(stroke => stroke.split(",").map(point => {
		const [x, y] = point.split(" ");
		return { x: Number(x), y: Number(y) };
	}));
}

function buildPrototypes(): Prototype[] {
	if (prototypes) return prototypes;
	prototypes = [];
	for (const [value, strokes] of SHAPES) {
		const cloud = toCloud(strokes.map(stroke => stroke.map(([x, y]) => ({ x, y }))));
		if (cloud) prototypes.push({ value, cloud, signature: signatureOf(cloud), prior: RARE[value] ?? 0 });
	}
	// Real handwriting for the maths symbols, from the Detexify/Hand-TeX data.
	// One person drawing a sigma once is a guess; 260 people drawing it is what
	// a sigma looks like.
	for (const [value, packed] of HANDWRITTEN_SHAPES) {
		const cloud = toCloud(parseShape(packed));
		if (cloud) prototypes.push({ value, cloud, signature: signatureOf(cloud), prior: RARE[value] ?? 0 });
	}
	return prototypes;
}

/** The prototypes as drawn, so the harness can render and check them. */
export function prototypeShapes(): { value: string; strokes: { x: number; y: number }[][] }[] {
	return [
		...SHAPES.map(([value, strokes]) => ({ value, strokes: strokes.map(stroke => stroke.map(([x, y]) => ({ x, y }))) })),
		...HANDWRITTEN_SHAPES.map(([value, packed]) => ({ value, strokes: parseShape(packed) }))
	];
}

/**
 * The symbols this recogniser knows, best first. An empty list means the ink
 * had nothing to match.
 */
export function matchShape(strokes: { x: number; y: number }[][]): ShapeMatch[] {
	const cloud = toCloud(strokes);
	if (!cloud) return [];
	const signature = signatureOf(cloud);
	const all = buildPrototypes();
	// Rank by signature, keep the plausible ones, and only then do the work.
	// Every symbol keeps at least one candidate so the sieve cannot hide an
	// answer entirely — it decides the order, never the outcome.
	const seen = new Set<string>();
	const shortlist = all
		.map((prototype, index) => ({ index, rough: signatureDistance(signature, prototype.signature) }))
		.sort((a, b) => a.rough - b.rough)
		.filter((entry, position) => {
			const value = all[entry.index].value;
			if (position < SHORTLIST) { seen.add(value); return true; }
			if (seen.has(value)) return false;
			seen.add(value);
			return true;
		});
	// Every distance a symbol offered, not just its best one.
	const perSymbol = new Map<string, number[]>();
	for (const { index } of shortlist) {
		const prototype = all[index];
		const distance = shapeDistance(cloud, prototype.cloud) + prototype.prior;
		const list = perSymbol.get(prototype.value);
		if (list) list.push(distance);
		else perSymbol.set(prototype.value, [distance]);
	}
	const best = new Map<string, number>();
	for (const [value, distances] of perSymbol) {
		distances.sort((a, b) => a - b);
		// The mean of the three closest, so a symbol with sixty-four examples
		// cannot win on the luckiest of them against one with a single example.
		const take = distances.slice(0, VOTES);
		best.set(value, take.reduce((total, d) => total + d, 0) / take.length);
	}
	// The cloud distance of a good match is around 2-5 for 32 points; 12 and up
	// means nothing in the library looks like this.
	return [...best.entries()]
		.sort((a, b) => a[1] - b[1])
		.map(([value, distance]) => ({ value, distance, score: Math.max(0, 1 - distance / 14) }));
}
