/**
 * Fast, offline recognition for equations drawn with NoteLens ink.
 *
 * This is deliberately geometry-first. The board already owns clean vector
 * strokes, so flattening them to a screenshot before looking at their layout
 * throws away the most useful information: which marks belong together,
 * which one is a fraction bar, and whether a small glyph is a superscript.
 * OCR remains a fallback for photographs and uncommon symbols.
 */

export interface InkMathPoint {
	x: number;
	y: number;
}

export interface InkMathStroke {
	points: InkMathPoint[];
	width?: number;
}

export interface InkMathToken {
	value: string;
	alternatives: string[];
	confidence: number;
}

export interface InkMathRecognition {
	source: string;
	confidence: number;
	tokens: InkMathToken[];
	/** A short explanation suitable for the recognition status line. */
	detail: string;
}

interface Bounds {
	x: number;
	y: number;
	w: number;
	h: number;
	right: number;
	bottom: number;
}

interface StrokeInfo {
	stroke: InkMathStroke;
	bounds: Bounds;
	length: number;
	chord: number;
	angle: number;
	straightness: number;
}

interface GlyphResult extends InkMathToken {
	bounds: Bounds;
}

interface ParsedExpression {
	source: string;
	tokens: InkMathToken[];
	confidence: number;
	structured: boolean;
}

import { matchShape } from "./ink-shapes";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function boundsOfPoints(points: InkMathPoint[]): Bounds {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	if (!Number.isFinite(minX)) minX = minY = maxX = maxY = 0;
	const w = Math.max(0.5, maxX - minX), h = Math.max(0.5, maxY - minY);
	return { x: minX, y: minY, w, h, right: minX + w, bottom: minY + h };
}

function boundsOfStrokes(strokes: InkMathStroke[]): Bounds {
	return boundsOfPoints(strokes.flatMap(stroke => stroke.points));
}

function pathLength(points: InkMathPoint[]): number {
	let length = 0;
	for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
	return length;
}

function strokeInfo(stroke: InkMathStroke): StrokeInfo {
	const points = stroke.points;
	const first = points[0] ?? { x: 0, y: 0 };
	const last = points[points.length - 1] ?? first;
	const dx = last.x - first.x;
	const dy = last.y - first.y;
	const chord = Math.hypot(dx, dy);
	const length = Math.max(pathLength(points), chord, 0.01);
	let angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
	if (angle > 90) angle = 180 - angle;
	return { stroke, bounds: boundsOfPoints(points), length, chord, angle, straightness: chord / length };
}

function median(values: number[]): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
	return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function centre(bounds: Bounds): InkMathPoint {
	return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

function pointDistance(a: InkMathPoint, b: InkMathPoint): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function minStrokeDistance(a: InkMathStroke[], b: InkMathStroke[]): number {
	let best = Infinity;
	for (const sa of a) {
		const stepA = Math.max(1, Math.floor(sa.points.length / 24));
		for (let ai = 0; ai < sa.points.length; ai += stepA) {
			for (const sb of b) {
				const stepB = Math.max(1, Math.floor(sb.points.length / 24));
				for (let bi = 0; bi < sb.points.length; bi += stepB) best = Math.min(best, pointDistance(sa.points[ai], sb.points[bi]));
			}
		}
	}
	return best;
}

function isHorizontalLine(info: StrokeInfo): boolean {
	return info.straightness > 0.91 && info.angle < 13 && info.bounds.w > Math.max(8, info.bounds.h * 3.2);
}

function isVerticalLine(info: StrokeInfo): boolean {
	return info.straightness > 0.91 && info.angle > 76 && info.bounds.h > Math.max(8, info.bounds.w * 3.2);
}

function lineIntersection(a: StrokeInfo, b: StrokeInfo): boolean {
	const p = a.stroke.points[0], p2 = a.stroke.points[a.stroke.points.length - 1];
	const q = b.stroke.points[0], q2 = b.stroke.points[b.stroke.points.length - 1];
	if (!p || !p2 || !q || !q2) return false;
	const cross = (u: InkMathPoint, v: InkMathPoint, w: InkMathPoint) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
	const d1 = cross(p, p2, q), d2 = cross(p, p2, q2), d3 = cross(q, q2, p), d4 = cross(q, q2, p2);
	// Collinear segments make every cross product zero, and the sign test then
	// calls them crossing however far apart they are. Two marks on the same
	// vertical — the limits above and below an integral — are not one glyph, so
	// the extents have to overlap for real.
	const eps = 1e-6;
	if (Math.abs(d1) < eps && Math.abs(d2) < eps && Math.abs(d3) < eps && Math.abs(d4) < eps) {
		return overlap(a.bounds.x, a.bounds.right, b.bounds.x, b.bounds.right) >= 0
			&& overlap(a.bounds.y, a.bounds.bottom, b.bounds.y, b.bounds.bottom) >= 0
			&& minStrokeDistance([a.stroke], [b.stroke]) < Math.max(a.bounds.h, a.bounds.w) * 0.35;
	}
	return d1 * d2 <= 0 && d3 * d4 <= 0;
}

/**
 * Where two straight strokes cross, as a fraction along each (0 = start,
 * 1 = end), or null when they do not. Endpoints count: a "7" is two strokes
 * that meet at a corner.
 */
function crossingParameters(a: StrokeInfo, b: StrokeInfo): { alongA: number; alongB: number } | null {
	const p = a.stroke.points[0], p2 = a.stroke.points[a.stroke.points.length - 1];
	const q = b.stroke.points[0], q2 = b.stroke.points[b.stroke.points.length - 1];
	if (!p || !p2 || !q || !q2) return null;
	const rx = p2.x - p.x, ry = p2.y - p.y;
	const sx = q2.x - q.x, sy = q2.y - q.y;
	const denominator = rx * sy - ry * sx;
	if (Math.abs(denominator) < 1e-9) return null;
	const alongA = ((q.x - p.x) * sy - (q.y - p.y) * sx) / denominator;
	const alongB = ((q.x - p.x) * ry - (q.y - p.y) * rx) / denominator;
	if (alongA < -0.02 || alongA > 1.02 || alongB < -0.02 || alongB > 1.02) return null;
	return { alongA, alongB };
}

/** A cross, not a corner: both strokes are cut somewhere other than their ends. */
function crossesInside(a: StrokeInfo, b: StrokeInfo): boolean {
	const at = crossingParameters(a, b);
	if (!at) return false;
	const inside = (t: number) => t > 0.12 && t < 0.88;
	return inside(at.alongA) && inside(at.alongB);
}

function hasNonBarInk(strokes: InkMathStroke[]): boolean {
	return strokes.some(stroke => {
		const info = strokeInfo(stroke);
		return !isHorizontalLine(info) || info.bounds.h > 3.5;
	});
}

interface FractionSplit {
	bar: InkMathStroke;
	left: InkMathStroke[];
	numerator: InkMathStroke[];
	denominator: InkMathStroke[];
	right: InkMathStroke[];
	score: number;
}

/** Finds a genuine fraction bar without mistaking an equals sign for one. */
function findFraction(strokes: InkMathStroke[]): FractionSplit | null {
	if (strokes.length < 3) return null;
	const all = boundsOfStrokes(strokes);
	const infos = strokes.map(strokeInfo);
	let best: FractionSplit | null = null;
	for (const info of infos) {
		if (!isHorizontalLine(info) || info.bounds.w < Math.max(18, all.w * 0.12)) continue;
		const barY = info.bounds.y + info.bounds.h / 2;
		const padX = Math.max(5, info.bounds.w * 0.06);
		const candidates = strokes.filter(stroke => stroke !== info.stroke);
		const numerator = candidates.filter(stroke => {
			const b = boundsOfPoints(stroke.points);
			return centre(b).y < barY - 1 && overlap(b.x, b.right, info.bounds.x - padX, info.bounds.right + padX) > 0;
		});
		const denominator = candidates.filter(stroke => {
			const b = boundsOfPoints(stroke.points);
			return centre(b).y > barY + 1 && overlap(b.x, b.right, info.bounds.x - padX, info.bounds.right + padX) > 0;
		});
		if (!numerator.length || !denominator.length || !hasNonBarInk(numerator) || !hasNonBarInk(denominator)) continue;

		const inside = new Set([...numerator, ...denominator, info.stroke]);
		const left = candidates.filter(stroke => !inside.has(stroke) && centre(boundsOfPoints(stroke.points)).x < info.bounds.x);
		const right = candidates.filter(stroke => !inside.has(stroke) && centre(boundsOfPoints(stroke.points)).x > info.bounds.right);
		const numBounds = boundsOfStrokes(numerator), denBounds = boundsOfStrokes(denominator);
		const coverage = Math.min(numBounds.w, denBounds.w) / Math.max(info.bounds.w, 1);
		const balance = 1 - Math.min(1, Math.abs(numBounds.w - denBounds.w) / Math.max(info.bounds.w, 1));
		const score = info.bounds.w / Math.max(all.w, 1) + coverage * 0.8 + balance * 0.25;
		if (!best || score > best.score) best = { bar: info.stroke, left, numerator, denominator, right, score };
	}
	return best;
}

interface GlyphGroup {
	strokes: InkMathStroke[];
	bounds: Bounds;
}

function shouldMerge(a: GlyphGroup, b: GlyphGroup, scale: number): boolean {
	const ai = a.strokes.map(strokeInfo), bi = b.strokes.map(strokeInfo);
	const xOverlap = overlap(a.bounds.x, a.bounds.right, b.bounds.x, b.bounds.right);
	const yOverlap = overlap(a.bounds.y, a.bounds.bottom, b.bounds.y, b.bounds.bottom);
	const aHoriz = ai.length === 1 && isHorizontalLine(ai[0]);
	const bHoriz = bi.length === 1 && isHorizontalLine(bi[0]);

	// Equals: two similarly sized horizontal marks directly above each other.
	if (aHoriz && bHoriz) {
		const widthRatio = Math.min(a.bounds.w, b.bounds.w) / Math.max(a.bounds.w, b.bounds.w);
		const verticalGap = Math.max(0, Math.max(a.bounds.y, b.bounds.y) - Math.min(a.bounds.bottom, b.bounds.bottom));
		if (widthRatio > 0.58 && xOverlap > Math.min(a.bounds.w, b.bounds.w) * 0.55 && verticalGap < Math.max(scale * 1.45, Math.min(a.bounds.w, b.bounds.w) * 0.42)) return true;
	}

	// Plus, multiplication sign, crossed t and four: their straight marks meet.
	if (ai.length === 1 && bi.length === 1 && ai[0].straightness > 0.86 && bi[0].straightness > 0.86 && lineIntersection(ai[0], bi[0])) return true;

	// A pen lifted and put back down on the same spot is still one symbol: the
	// corner of a "7", the flag of a "1", the two strokes of a "4" or a "5".
	// Without this the bench read a 7 as "-" followed by "/".
	const ends = (group: GlyphGroup) => group.strokes.flatMap(stroke =>
		stroke.points.length ? [stroke.points[0], stroke.points[stroke.points.length - 1]] : []);
	const reach = Math.max(4, scale * 0.16);
	for (const endA of ends(a)) {
		for (const endB of ends(b)) {
			if (pointDistance(endA, endB) < reach) return true;
		}
	}

	// The bowl of a "b" leans on its stem without either end meeting the other,
	// and reading it against the median glyph on the line split the letter in
	// two whenever the line held smaller symbols. What matters is how close the
	// ink is compared with the smaller of the two marks.
	const sizeA = Math.max(a.bounds.w, a.bounds.h);
	const sizeB = Math.max(b.bounds.w, b.bounds.h);
	const smaller = Math.min(sizeA, sizeB);
	if (smaller > 0 && minStrokeDistance(a.strokes, b.strokes) < smaller * 0.14
		&& overlap(a.bounds.y, a.bounds.bottom, b.bounds.y, b.bounds.bottom) > smaller * 0.3) {
		return true;
	}

	// A dot above a narrow body is i or j, not a separate decimal point.
	const smallA = a.bounds.w < scale * 0.24 && a.bounds.h < scale * 0.24;
	const smallB = b.bounds.w < scale * 0.24 && b.bounds.h < scale * 0.24;
	if ((smallA || smallB) && xOverlap > 0 && Math.abs(centre(a.bounds).x - centre(b.bounds).x) < scale * 0.28) {
		const gap = Math.max(0, Math.max(a.bounds.y, b.bounds.y) - Math.min(a.bounds.bottom, b.bounds.bottom));
		// Measured against the body the dot sits over, not against the median
		// glyph: a lone "i" makes the median tiny and the dot was left behind.
		const body = smallA ? b.bounds.h : a.bounds.h;
		if (gap < Math.max(scale * 0.42, body * 0.55)) return true;
	}

	const combined = boundsOfStrokes([...a.strokes, ...b.strokes]);
	if (combined.w > scale * 1.55 || combined.h > scale * 1.8) return false;
	if (xOverlap > Math.min(a.bounds.w, b.bounds.w) * 0.18 && yOverlap > 0) return minStrokeDistance(a.strokes, b.strokes) < scale * 0.22;
	return minStrokeDistance(a.strokes, b.strokes) < Math.max(3.5, scale * 0.1);
}

function groupGlyphs(strokes: InkMathStroke[]): GlyphGroup[] {
	let groups = strokes.map(stroke => ({ strokes: [stroke], bounds: boundsOfPoints(stroke.points) }));
	const scale = Math.max(12, median(groups.map(group => Math.max(group.bounds.h, Math.min(group.bounds.w, group.bounds.h * 1.4)))));
	let changed = true;
	while (changed) {
		changed = false;
		outer: for (let i = 0; i < groups.length; i++) {
			for (let j = i + 1; j < groups.length; j++) {
				if (!shouldMerge(groups[i], groups[j], scale)) continue;
				const strokes = [...groups[i].strokes, ...groups[j].strokes];
				groups[i] = { strokes, bounds: boundsOfStrokes(strokes) };
				groups.splice(j, 1);
				changed = true;
				break outer;
			}
		}
	}
	return groups.sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
}

// -------------------------------------------------------------------------
// Lightweight glyph matching
// -------------------------------------------------------------------------

const MASK_SIZE = 42;
type Mask = { pixels: Uint8Array; aspect: number; density: number };
const templateCache = new Map<string, Mask[]>();

const GLYPHS: { glyph: string; value: string }[] = [
	...[..."0123456789"].map(glyph => ({ glyph, value: glyph })),
	...[..."xyzabcnmtefghijkopqrsuv"].map(glyph => ({ glyph, value: glyph })),
	...[..."()[]<>"].map(glyph => ({ glyph, value: glyph })),
	{ glyph: "+", value: "+" }, { glyph: "−", value: "-" }, { glyph: "=", value: "=" },
	{ glyph: "/", value: "/" }, { glyph: "×", value: "*" }, { glyph: ".", value: "." },
	{ glyph: ",", value: "," }, { glyph: "√", value: "sqrt" }, { glyph: "π", value: "pi" },
	{ glyph: "∫", value: "int" }, { glyph: "Σ", value: "sum" }
];

function cropMask(source: HTMLCanvasElement): Mask {
	const ctx = source.getContext("2d", { willReadFrequently: true });
	if (!ctx) return { pixels: new Uint8Array(MASK_SIZE * MASK_SIZE), aspect: 1, density: 0 };
	const data = ctx.getImageData(0, 0, source.width, source.height).data;
	let minX = source.width, minY = source.height, maxX = -1, maxY = -1;
	for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
		const i = (y * source.width + x) * 4;
		if (data[i + 3] > 40 && (data[i] + data[i + 1] + data[i + 2]) < 700) {
			minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
		}
	}
	if (maxX < minX) return { pixels: new Uint8Array(MASK_SIZE * MASK_SIZE), aspect: 1, density: 0 };
	const w = maxX - minX + 1, h = maxY - minY + 1;
	const fit = createEl("canvas");
	fit.width = fit.height = MASK_SIZE;
	const out = fit.getContext("2d", { willReadFrequently: true });
	if (!out) return { pixels: new Uint8Array(MASK_SIZE * MASK_SIZE), aspect: w / h, density: 0 };
	const padding = 4;
	const scale = Math.min((MASK_SIZE - padding * 2) / w, (MASK_SIZE - padding * 2) / h);
	const dw = w * scale, dh = h * scale;
	out.clearRect(0, 0, MASK_SIZE, MASK_SIZE);
	out.drawImage(source, minX, minY, w, h, (MASK_SIZE - dw) / 2, (MASK_SIZE - dh) / 2, dw, dh);
	const normalized = out.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
	const pixels = new Uint8Array(MASK_SIZE * MASK_SIZE);
	let count = 0;
	for (let i = 0; i < pixels.length; i++) {
		const at = i * 4;
		if (normalized[at + 3] > 45 && normalized[at] + normalized[at + 1] + normalized[at + 2] < 710) { pixels[i] = 1; count++; }
	}
	return { pixels, aspect: w / Math.max(h, 1), density: count / pixels.length };
}

function maskForStrokes(strokes: InkMathStroke[]): Mask {
	const canvas = createEl("canvas");
	canvas.width = canvas.height = 120;
	const ctx = canvas.getContext("2d");
	if (!ctx) return cropMask(canvas);
	const bounds = boundsOfStrokes(strokes);
	const pad = 12;
	const scale = Math.min((canvas.width - pad * 2) / Math.max(bounds.w, 1), (canvas.height - pad * 2) / Math.max(bounds.h, 1));
	ctx.strokeStyle = "#000";
	ctx.fillStyle = "#000";
	ctx.lineWidth = 4;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	for (const stroke of strokes) {
		if (!stroke.points.length) continue;
		ctx.beginPath();
		const first = stroke.points[0];
		ctx.moveTo(pad + (first.x - bounds.x) * scale, pad + (first.y - bounds.y) * scale);
		for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(pad + (stroke.points[i].x - bounds.x) * scale, pad + (stroke.points[i].y - bounds.y) * scale);
		if (stroke.points.length === 1) ctx.arc(pad + (first.x - bounds.x) * scale, pad + (first.y - bounds.y) * scale, 2, 0, Math.PI * 2);
		stroke.points.length === 1 ? ctx.fill() : ctx.stroke();
	}
	return cropMask(canvas);
}

function templateMasks(glyph: string): Mask[] {
	const cached = templateCache.get(glyph);
	if (cached) return cached;
	const fonts = ["Segoe Print", "Comic Sans MS", "Arial", "Georgia"];
	const masks = fonts.map(font => {
		const canvas = createEl("canvas");
		canvas.width = canvas.height = 120;
		const ctx = canvas.getContext("2d");
		if (!ctx) return cropMask(canvas);
		ctx.fillStyle = "#000";
		ctx.font = `${font === "Georgia" ? "italic " : ""}86px ${font}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(glyph, 60, 63);
		return cropMask(canvas);
	});
	templateCache.set(glyph, masks);
	return masks;
}

function distanceField(mask: Uint8Array): Float32Array {
	const size = MASK_SIZE;
	const field = new Float32Array(mask.length);
	for (let i = 0; i < mask.length; i++) field[i] = mask[i] ? 0 : 999;
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const i = y * size + x;
		if (x) field[i] = Math.min(field[i], field[i - 1] + 1);
		if (y) field[i] = Math.min(field[i], field[i - size] + 1);
		if (x && y) field[i] = Math.min(field[i], field[i - size - 1] + 1.414);
		if (x + 1 < size && y) field[i] = Math.min(field[i], field[i - size + 1] + 1.414);
	}
	for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) {
		const i = y * size + x;
		if (x + 1 < size) field[i] = Math.min(field[i], field[i + 1] + 1);
		if (y + 1 < size) field[i] = Math.min(field[i], field[i + size] + 1);
		if (x + 1 < size && y + 1 < size) field[i] = Math.min(field[i], field[i + size + 1] + 1.414);
		if (x && y + 1 < size) field[i] = Math.min(field[i], field[i + size - 1] + 1.414);
	}
	return field;
}

function directedDistance(from: Uint8Array, toField: Float32Array): number {
	let total = 0, count = 0;
	for (let i = 0; i < from.length; i++) if (from[i]) { total += Math.min(toField[i], 12); count++; }
	return count ? total / count : 12;
}

function maskDistance(a: Mask, b: Mask): number {
	const spatial = (directedDistance(a.pixels, distanceField(b.pixels)) + directedDistance(b.pixels, distanceField(a.pixels))) / (2 * MASK_SIZE);
	const aspect = Math.abs(Math.log(Math.max(0.08, a.aspect) / Math.max(0.08, b.aspect))) * 0.14;
	const density = Math.abs(a.density - b.density) * 0.45;
	return spatial + aspect + density;
}

/**
 * A radical: down into a sharp vertex, steeply up to the top, then a long flat
 * run to the right for the vinculum. The tail is what separates it from a "2"
 * or an "m", both of which finish at the bottom.
 */
function looksLikeRadical(points: InkMathPoint[], b: Bounds): boolean {
	if (points.length < 8 || b.h < 8 || b.w < 8) return false;
	let vertex = 0;
	for (let i = 1; i < points.length; i++) if (points[i].y > points[vertex].y) vertex = i;
	const position = vertex / (points.length - 1);
	if (position < 0.08 || position > 0.75) return false;
	if (points[vertex].y < b.y + b.h * 0.6) return false;

	let peak = vertex;
	for (let i = vertex; i < points.length; i++) if (points[i].y < points[peak].y) peak = i;
	if (peak <= vertex || points[peak].y > b.y + b.h * 0.35) return false;

	const last = points[points.length - 1];
	const tailWidth = last.x - points[peak].x;
	const tailDrop = Math.abs(last.y - points[peak].y);
	return tailWidth > b.w * 0.28 && tailDrop < b.h * 0.3 && last.x > b.right - b.w * 0.15;
}

/**
 * An integral: tall, narrow and curved, with the top hook to the right of the
 * bottom one. A "1" or an "l" fails the curvature test, a "j" the lean.
 */
/** True when the stroke passes over itself: the loop of a 6, a 9, an 8 or an e. */
function selfCrosses(points: InkMathPoint[]): boolean {
	const segments = Math.min(points.length - 1, 80);
	const step = Math.max(1, Math.floor((points.length - 1) / segments));
	const sign = (a: InkMathPoint, b: InkMathPoint, c: InkMathPoint) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
	for (let i = 0; i + step < points.length; i += step) {
		// Neighbouring segments always touch; only distant ones mean a loop.
		for (let j = i + step * 3; j + step < points.length; j += step) {
			const [a, b, c, d] = [points[i], points[i + step], points[j], points[j + step]];
			if (sign(a, b, c) !== sign(a, b, d) && sign(c, d, a) !== sign(c, d, b)) return true;
		}
	}
	return false;
}

function looksLikeIntegral(info: StrokeInfo, points: InkMathPoint[], b: Bounds): boolean {
	if (points.length < 6) return false;
	if (b.h < b.w * 1.9 || b.w < 4) return false;
	if (info.straightness > 0.82) return false;
	const first = points[0], last = points[points.length - 1];
	if (first.y > b.y + b.h * 0.28 || last.y < b.bottom - b.h * 0.28) return false;
	// An integral is one sweep from top to bottom. A 6 and a 9 are just as tall
	// and just as curved, and both were being read as integrals. What tells them
	// apart is the loop: it crosses itself, and it climbs back up. The climb is
	// the reliable half — a 6 whose loop stops just short of closing still goes
	// back up to draw it.
	if (selfCrosses(points)) return false;
	let climb = 0;
	for (let i = 1; i < points.length; i++) climb += Math.max(0, points[i - 1].y - points[i].y);
	if (climb > b.h * 0.3) return false;
	return first.x > last.x + b.w * 0.3;
}

function hardGeometry(group: GlyphGroup): { value: string; alternatives: string[]; confidence: number } | null {
	const infos = group.strokes.map(strokeInfo);
	const b = group.bounds;
	if (b.w < 4 && b.h < 4) return { value: ".", alternatives: [".", ","], confidence: 0.95 };
	if (infos.length === 1 && infos[0].straightness > 0.93) {
		if (isHorizontalLine(infos[0])) return { value: "-", alternatives: ["-", "="], confidence: 0.97 };
		if (isVerticalLine(infos[0])) return { value: "1", alternatives: ["1", "l", "i"], confidence: 0.9 };
		if (infos[0].angle > 25 && infos[0].angle < 68) return { value: "/", alternatives: ["/", "1"], confidence: 0.82 };
	}
	if (infos.length === 2 && infos.every(info => isHorizontalLine(info))) {
		return { value: "=", alternatives: ["=", "-"], confidence: 0.98 };
	}
	// Two straight strokes that really cross, rather than meeting at a corner:
	// a corner is a "7", a "4" or the flag of a "1", and calling those a cross
	// read a flagged 1 as "x".
	if (infos.length === 2 && infos.every(info => info.straightness > 0.88) && crossesInside(infos[0], infos[1])) {
		const angles = infos.map(info => info.angle);
		const axisAligned = angles.some(angle => angle < 20) && angles.some(angle => angle > 70);
		if (!axisAligned) return { value: "x", alternatives: ["x", "*", "+"], confidence: 0.82 };
		// A "+" is crossed through the middle of both marks; a "t" is crossed
		// near the top of its stem, with most of the stem hanging below.
		const vertical = infos[0].angle > 70 ? infos[0] : infos[1];
		const at = crossingParameters(infos[0], infos[1]);
		const alongStem = !at ? 0.5 : vertical === infos[0] ? at.alongA : at.alongB;
		const downwards = vertical.stroke.points[0].y < vertical.stroke.points[vertical.stroke.points.length - 1].y;
		const fromTop = downwards ? alongStem : 1 - alongStem;
		return fromTop < 0.36
			? { value: "t", alternatives: ["t", "+", "7"], confidence: 0.84 }
			: { value: "+", alternatives: ["+", "t", "4"], confidence: 0.94 };
	}
	if (infos.length === 1) {
		const info = infos[0];
		const first = info.stroke.points[0], last = info.stroke.points[info.stroke.points.length - 1];
		const points = info.stroke.points;
		// A radical and an integral are the two shapes template matching gets
		// worst — a hand-drawn root came back as "m" and an integral as "j" —
		// and they are also the two easiest to describe geometrically.
		if (looksLikeRadical(points, b)) return { value: "sqrt", alternatives: ["sqrt", "v", "r"], confidence: 0.9 };
		if (looksLikeIntegral(info, points, b)) return { value: "int", alternatives: ["int", "j", "f"], confidence: 0.86 };
		if (points.length >= 5 && first && last) {
			const earlyEnd = Math.max(1, points.length - 2);
			let maxXIndex = 0;
			for (let index = 1; index <= earlyEnd; index++) if (points[index].x > points[maxXIndex].x) maxXIndex = index;
			const lowerLeftIndex = points.reduce((best, point, index) => index > maxXIndex && point.x < points[best].x ? index : best, Math.min(points.length - 1, maxXIndex + 1));
			const upperTurn = points[maxXIndex], lowerTurn = points[lowerLeftIndex];
			// The tail of a 2 runs along the bottom to the right. Without that
			// test an opening bracket was read as a 2: it also turns right at
			// the top and ends low, it just never levels out.
			const tailFrom = points[Math.max(0, Math.floor(points.length * 0.78))];
			const flatTail = last.x - tailFrom.x > b.w * 0.35
				&& Math.abs(last.y - tailFrom.y) < b.h * 0.14;
			const looksLikeTwo = maxXIndex < points.length * 0.7
				&& lowerLeftIndex > maxXIndex
				&& upperTurn.y < b.y + b.h * 0.58
				&& lowerTurn.y > b.y + b.h * 0.48
				&& last.x > b.x + b.w * 0.68
				&& last.y > b.y + b.h * 0.68
				&& flatTail;
			if (looksLikeTwo) return { value: "2", alternatives: ["2", "z", "sqrt"], confidence: 0.82 };
		}
		if (first && last && pointDistance(first, last) < Math.max(6, info.length * 0.13) && info.length > (b.w + b.h) * 1.35) {
			return { value: "0", alternatives: ["0", "o", "6", "9"], confidence: 0.72 };
		}
	}
	return null;
}

/**
 * Reads one glyph. Geometry decides the shapes that are defined by their
 * layout (bars, radicals, integrals); otherwise the stroke matcher runs, and
 * the bitmap templates only break ties between its top answers. Comparing ink
 * with printed fonts was the primary vote until 2.6.0 and scored 42 % on the
 * bench, so it is now worth a fifth of a vote.
 */
function classifyGlyph(group: GlyphGroup): GlyphResult {
	const hard = hardGeometry(group);
	if (hard && hard.confidence >= 0.8) return { ...hard, bounds: group.bounds };

	const shapes = matchShape(group.strokes.map(stroke => stroke.points));
	const scores = new Map<string, number>();
	// Lower is better throughout, so a shape score of 1 becomes a distance of 0.
	for (const match of shapes) scores.set(match.value, 1 - match.score);

	// The templates cannot introduce a symbol the matcher never saw; they only
	// nudge the order of the ones it did.
	const contenders = shapes.slice(0, 6).map(match => match.value);
	if (contenders.length > 1 && canRasterise()) {
		const input = maskForStrokes(group.strokes);
		for (const candidate of GLYPHS) {
			if (!contenders.includes(candidate.value)) continue;
			const distance = Math.min(...templateMasks(candidate.glyph).map(mask => maskDistance(input, mask)));
			scores.set(candidate.value, (scores.get(candidate.value) ?? 1) + distance * 0.2);
		}
	}
	if (hard) scores.set(hard.value, Math.min(scores.get(hard.value) ?? Infinity, 0.1 + (1 - hard.confidence) * 0.2));

	const ranked = [...scores.entries()].sort((a, b) => a[1] - b[1]);
	const best = ranked[0] ?? ["?", 1] as [string, number];
	const second = ranked[1]?.[1] ?? best[1] + 0.2;
	// Confident when the winner is both close to the ink and clear of the rest.
	const confidence = clamp01(0.2 + (second - best[1]) * 3.2 + (0.45 - best[1]) * 1.1);
	return { value: best[0], alternatives: ranked.slice(0, 5).map(entry => entry[0]), confidence, bounds: group.bounds };
}

/** The templates need a canvas; the node tests and any headless call have none. */
function canRasterise(): boolean {
	try {
		return typeof createEl === "function" && !!createEl("canvas").getContext("2d");
	} catch {
		return false;
	}
}

function serializeGlyphs(glyphs: GlyphResult[]): ParsedExpression {
	if (!glyphs.length) return { source: "", tokens: [], confidence: 0, structured: false };
	const heights = glyphs.map(glyph => glyph.bounds.h).filter(height => height > 2);
	const normalHeight = Math.max(8, median(heights));
	const main = glyphs.filter(glyph => glyph.bounds.h >= normalHeight * 0.72);
	const baseline = median((main.length ? main : glyphs).map(glyph => centre(glyph.bounds).y));
	let source = "";
	let previous: GlyphResult | null = null;
	for (let i = 0; i < glyphs.length; i++) {
		const glyph = glyphs[i];
		const c = centre(glyph.bounds);
		const isSmall = glyph.bounds.h < normalHeight * 0.9;
		const gap = previous ? glyph.bounds.x - previous.bounds.right : 0;
		const spaced = previous && gap > normalHeight * 0.46;
		if (spaced) source += " ";
		if (previous && isSmall && c.y < baseline - normalHeight * 0.2) {
			const supers: string[] = [glyph.value];
			while (i + 1 < glyphs.length) {
				const next = glyphs[i + 1];
				if (next.bounds.h >= normalHeight * 0.8 || centre(next.bounds).y >= baseline - normalHeight * 0.16) break;
				supers.push(next.value); i++;
			}
			source += `^{${supers.join("")}}`;
		} else if (previous && isSmall && c.y > baseline + normalHeight * 0.25) {
			const subs: string[] = [glyph.value];
			while (i + 1 < glyphs.length) {
				const next = glyphs[i + 1];
				if (next.bounds.h >= normalHeight * 0.8 || centre(next.bounds).y <= baseline + normalHeight * 0.18) break;
				subs.push(next.value); i++;
			}
			source += `_{${subs.join("")}}`;
		} else {
			source += glyph.value;
		}
		previous = glyph;
	}
	const confidence = glyphs.reduce((sum, glyph) => sum + glyph.confidence, 0) / glyphs.length;
	return { source, tokens: glyphs.map(({ value, alternatives, confidence }) => ({ value, alternatives, confidence })), confidence, structured: false };
}

function combine(parts: ParsedExpression[]): ParsedExpression {
	const useful = parts.filter(part => part.source.trim());
	if (!useful.length) return { source: "", tokens: [], confidence: 0, structured: false };
	return {
		source: useful.map(part => part.source).join(" ").replace(/\s+([,.)\]])/g, "$1").replace(/([([])\s+/g, "$1"),
		tokens: useful.flatMap(part => part.tokens),
		confidence: useful.reduce((sum, part) => sum + part.confidence, 0) / useful.length,
		structured: useful.some(part => part.structured)
	};
}


// -------------------------------------------------------------------------
// Subordinate sub-expressions
//
// A radical, a sum and an integral are dominant symbols: they own regions of
// the page (inside the hook, above and below the sign) and whatever is written
// there belongs to them rather than to the baseline. Reading those regions and
// recursing into them is what turns a row of loose glyphs into a real formula,
// and it is the step Microsoft's ink recognizer calls subordinate
// sub-expression analysis.
// -------------------------------------------------------------------------

/** A glyph that keeps the strokes it came from, so a region can be re-parsed. */
interface PlacedGlyph extends GlyphResult {
	strokes: InkMathStroke[];
}

interface DominantSplit {
	kind: "sqrt" | "sum" | "int";
	left: PlacedGlyph[];
	inside: PlacedGlyph[];
	above: PlacedGlyph[];
	below: PlacedGlyph[];
	right: PlacedGlyph[];
}

const DOMINANT_VALUES = new Set(["sqrt", "sum", "int"]);

/**
 * Splits the glyphs around the first dominant symbol that owns something.
 * Returns null when nothing was written in its regions, so a lone radical is
 * still serialised as an ordinary glyph instead of producing an empty root.
 */
function findDominant(glyphs: PlacedGlyph[]): DominantSplit | null {
	for (let index = 0; index < glyphs.length; index++) {
		const dominant = glyphs[index];
		if (!DOMINANT_VALUES.has(dominant.value) || dominant.confidence < 0.45) continue;
		const d = dominant.bounds;
		const scale = Math.max(10, d.h);
		const others = glyphs.filter((_, i) => i !== index);
		const left = others.filter(glyph => centre(glyph.bounds).x < centre(d).x && glyph.bounds.right <= d.x + scale * 0.2);
		const rest = others.filter(glyph => !left.includes(glyph));

		if (dominant.value === "sqrt") {
			// Everything the vinculum covers, plus a glyph written just past a
			// short hook, belongs under the root.
			const inside: PlacedGlyph[] = [];
			const right: PlacedGlyph[] = [];
			for (const glyph of rest) {
				const b = glyph.bounds;
				const vertical = overlap(b.y, b.bottom, d.y, d.bottom) / Math.max(1, Math.min(b.h, d.h));
				const covered = b.x < d.right;
				const justAfter = !right.length && b.x < d.right + scale * 0.55;
				if (vertical > 0.3 && (covered || (justAfter && !inside.length))) inside.push(glyph);
				else right.push(glyph);
			}
			if (!inside.length) continue;
			return { kind: "sqrt", left, inside, above: [], below: [], right };
		}

		// Sums and integrals carry their limits above and below the sign. An
		// integral is written tall and thin and its limits drift to the right,
		// so its window reaches a little further than the sum's.
		const reach = dominant.value === "int" ? scale * 0.9 : scale * 0.7;
		const above: PlacedGlyph[] = [];
		const below: PlacedGlyph[] = [];
		const right: PlacedGlyph[] = [];
		for (const glyph of rest) {
			const b = glyph.bounds;
			const c = centre(b);
			const inWindow = c.x > d.x - scale * 0.5 && c.x < d.right + reach;
			if (inWindow && b.bottom < d.y + d.h * 0.2) above.push(glyph);
			else if (inWindow && b.y > d.bottom - d.h * 0.2) below.push(glyph);
			else right.push(glyph);
		}
		if (!above.length && !below.length) continue;
		return { kind: dominant.value === "int" ? "int" : "sum", left, inside: [], above, below, right };
	}
	return null;
}

/** Re-parses one region, so a root can hold a fraction and a limit a sum. */
function parseRegion(glyphs: PlacedGlyph[], depth: number): ParsedExpression {
	if (!glyphs.length) return { source: "", tokens: [], confidence: 0, structured: false };
	return parseExpression(glyphs.flatMap(glyph => glyph.strokes), depth + 1);
}

function buildDominant(split: DominantSplit, depth: number): ParsedExpression {
	const left = parseRegion(split.left, depth);
	const right = parseRegion(split.right, depth);
	let middle: ParsedExpression;
	if (split.kind === "sqrt") {
		const inside = parseRegion(split.inside, depth);
		middle = {
			source: `\\sqrt{${inside.source || "?"}}`,
			tokens: inside.tokens,
			confidence: (inside.confidence || 0.35) * 0.92 + 0.06,
			structured: true
		};
	} else {
		const above = parseRegion(split.above, depth);
		const below = parseRegion(split.below, depth);
		const command = split.kind === "sum" ? "\\sum" : "\\int";
		let source = command;
		if (below.source) source += `_{${below.source}}`;
		if (above.source) source += `^{${above.source}}`;
		const parts = [above, below].filter(part => part.source);
		middle = {
			source,
			tokens: [...below.tokens, ...above.tokens],
			confidence: (parts.reduce((sum, part) => sum + part.confidence, 0) / Math.max(1, parts.length)) * 0.9 + 0.08,
			structured: true
		};
	}
	return combine([left, middle, right]);
}

function parseExpression(strokes: InkMathStroke[], depth = 0): ParsedExpression {
	if (!strokes.length) return { source: "", tokens: [], confidence: 0, structured: false };
	if (depth < 3) {
		const fraction = findFraction(strokes);
		if (fraction) {
			const left = parseExpression(fraction.left, depth + 1);
			const numerator = parseExpression(fraction.numerator, depth + 1);
			const denominator = parseExpression(fraction.denominator, depth + 1);
			const right = parseExpression(fraction.right, depth + 1);
			const middle: ParsedExpression = {
				source: `\\frac{${numerator.source || "?"}}{${denominator.source || "?"}}`,
				tokens: [...numerator.tokens, ...denominator.tokens],
				confidence: Math.min(numerator.confidence || 0.35, denominator.confidence || 0.35) * 0.9 + 0.09,
				structured: true
			};
			return combine([left, middle, right]);
		}
	}
	const glyphs: PlacedGlyph[] = groupGlyphs(strokes).map(group => ({ ...classifyGlyph(group), strokes: group.strokes }));
	if (depth < 3) {
		const dominant = findDominant(glyphs);
		if (dominant) return buildDominant(dominant, depth);
	}
	return serializeGlyphs(glyphs);
}

/** Recognises the common notation used in school and university notes. */
export function recognizeInkFormula(strokes: InkMathStroke[]): InkMathRecognition {
	const clean = strokes
		.map(stroke => ({ ...stroke, points: stroke.points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) }))
		.filter(stroke => stroke.points.length > 0);
	if (!clean.length) return { source: "", confidence: 0, tokens: [], detail: "Sin tinta" };
	const parsed = parseExpression(clean);
	const uncertain = parsed.tokens.filter(token => token.confidence < 0.56).length;
	const confidence = clamp01(parsed.confidence + (parsed.structured ? 0.08 : 0));
	const detail = parsed.structured
		? `Estructura matemática detectada · ${Math.round(confidence * 100)}%`
		: uncertain
			? `${uncertain} símbolo${uncertain === 1 ? "" : "s"} por revisar · ${Math.round(confidence * 100)}%`
			: `Lectura vectorial · ${Math.round(confidence * 100)}%`;
	return { source: parsed.source.trim(), confidence, tokens: parsed.tokens, detail };
}

/** Scores OCR/vector candidates without requiring a language model. */
export function formulaCandidateScore(source: string): number {
	const value = source.trim();
	if (!value) return -100;
	let score = Math.min(18, value.length * 0.45);
	const valid = value.match(/[A-Za-z0-9+\-=/*^_().,<>[\]{}|!\\]/g)?.length ?? 0;
	score += valid / value.length * 12;
	score += (value.match(/[=+\-/*^_]|\\(?:frac|sqrt|sum|int)/g) ?? []).length * 1.7;
	if (/\\frac\{[^{}]+\}\{[^{}]+\}/.test(value)) score += 7;
	if (/\^(?:\([^()]+\)|\{[^{}]+\}|[0-9])/.test(value)) score += 3;
	if (/[?]{2,}|[_^]\s*$|[+\-=/*]{3,}/.test(value)) score -= 8;
	if (/\b[A-Za-z]{7,}\b/.test(value)) score -= 3;
	const opens = (value.match(/[({[]/g) ?? []).length;
	const closes = (value.match(/[)}\]]/g) ?? []).length;
	score -= Math.abs(opens - closes) * 2;
	return score;
}

/** Returns the strongest non-empty candidate, favouring vector structure. */
export function pickFormulaCandidate(candidates: { source: string; bonus?: number }[]): string {
	return candidates
		.filter(candidate => candidate.source.trim())
		.sort((a, b) => formulaCandidateScore(b.source) + (b.bonus ?? 0) - formulaCandidateScore(a.source) - (a.bonus ?? 0))[0]?.source.trim() ?? "";
}
