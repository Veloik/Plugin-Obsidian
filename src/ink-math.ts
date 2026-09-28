/**
 * Handwritten maths → LaTeX, offline, from the board's own vector ink.
 *
 * Three stages, the classic architecture of online formula recognisers:
 *
 * 1. Segmentation. Strokes arrive in the order they were written, and a symbol
 *    is almost always written in one go, so the candidates are runs of up to
 *    four consecutive strokes. Every candidate is read by the trained network
 *    (ink-classifier.ts) and a dynamic programme picks the cut whose symbols
 *    are, together, the most believable. The network also knows "junk" — two
 *    symbols read as one — which is what stops it from gluing neighbours. A
 *    second pass joins strokes added later (the dot of an i, the bar of a t).
 *
 * 2. Structure. Fraction bars, radicals and big operators own regions of the
 *    page; what is written there is parsed on its own and becomes one unit.
 *    The remaining units are read along a baseline, where a glyph written
 *    higher and smaller is an exponent and lower and smaller a subscript.
 *
 * 3. Output. LaTeX, with the case of c/C, s/S, x/X… chosen from the size of
 *    the letter against its neighbours, and sin, cos, log, lim… recognised as
 *    words.
 *
 * Measured on handwriting nobody here wrote (MathWriting, dev-harness/
 * formula-bench.mjs), not on a corpus drawn to agree with the code.
 */
import { classifyFeatures, JUNK, SYMBOL_CLASSES } from "./ink-classifier";
import { glyphFeatures } from "./ink-features";
import { personalVotes } from "./ink-memory";
import { tr } from "./i18n";

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
	/** Nothing the reader knows looked like this; the value is its best guess. */
	unknown?: boolean;
	/** The ink of this glyph, so a correction can be learned from it. */
	strokes?: InkMathStroke[];
}

export interface InkMathRecognition {
	source: string;
	confidence: number;
	tokens: InkMathToken[];
	/** Glyphs the reader could not name. */
	unknown: number;
	/** A short explanation suitable for the recognition status line. */
	detail: string;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Box { x: number; y: number; right: number; bottom: number; w: number; h: number }

function boxOf(points: Iterable<InkMathPoint>): Box {
	let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
	for (const p of points) {
		if (p.x < x) x = p.x;
		if (p.y < y) y = p.y;
		if (p.x > right) right = p.x;
		if (p.y > bottom) bottom = p.y;
	}
	if (!Number.isFinite(x)) x = y = right = bottom = 0;
	return { x, y, right, bottom, w: right - x, h: bottom - y };
}

function union(boxes: Box[]): Box {
	const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
	const right = Math.max(...boxes.map(b => b.right)), bottom = Math.max(...boxes.map(b => b.bottom));
	return { x, y, right, bottom, w: right - x, h: bottom - y };
}

const cx = (b: Box) => (b.x + b.right) / 2;
const cy = (b: Box) => (b.y + b.bottom) / 2;
const overlap1 = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function median(values: number[]): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Closest approach between two sets of strokes, sampling long strokes. */
function inkDistance(a: InkMathStroke[], b: InkMathStroke[]): number {
	let best = Infinity;
	for (const sa of a) {
		const stepA = Math.max(1, Math.floor(sa.points.length / 20));
		for (let i = 0; i < sa.points.length; i += stepA) {
			const p = sa.points[i];
			for (const sb of b) {
				const stepB = Math.max(1, Math.floor(sb.points.length / 20));
				for (let j = 0; j < sb.points.length; j += stepB) {
					const d = Math.hypot(p.x - sb.points[j].x, p.y - sb.points[j].y);
					if (d < best) best = d;
				}
			}
		}
	}
	return best;
}

// ---------------------------------------------------------------------------
// What a symbol is, typographically
// ---------------------------------------------------------------------------

/** Letters whose two cases are one shape; the layout decides by size. */
const MERGED_CASE = new Set(["c", "k", "p", "s", "u", "v", "w", "x", "z"]);
const ASCENDERS = new Set([..."0123456789bdfhklt", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "!", "?", "\\partial", "\\delta", "\\lambda", "\\theta", "\\beta",
	"\\Delta", "\\Omega", "\\Gamma", "\\Pi", "\\forall", "\\exists", "\\nabla", "\\emptyset"]);
const DESCENDERS = new Set([..."gjpqy", "\\beta", "\\gamma", "\\mu", "\\rho", "\\phi", "\\psi", "\\eta", "\\chi"]);
/** Centred on the maths axis, like an operator; never the base of a script. */
const OPERATORS = new Set(["+", "-", "=", "<", ">", "\\times", "\\div", "\\pm", "\\leq", "\\geq", "\\neq", "\\approx", "\\sim",
	"\\equiv", "\\rightarrow", "\\Rightarrow", "\\Leftrightarrow", "\\in", "\\cup", "\\cap", "\\subset", "\\subseteq", "\\cdot", "\\ast", ","]);
const FENCES = new Set(["(", ")", "[", "]", "\\{", "\\}", "|"]);
const BIG = new Set(["\\sum", "\\prod", "\\int"]);

/**
 * How likely each symbol is in the maths people write, before looking at the
 * ink. The network cannot tell an x from a ×, a w from an ω or a c from a ⊂ by
 * shape alone; students write the first of each far more often.
 */
const PRIOR: Record<string, number> = {
	"\\times": 0.3, "\\omega": 0.35, "\\subset": 0.2, "\\subseteq": 0.25, "\\cup": 0.25, "\\cap": 0.3, "\\Pi": 0.12, "\\prod": 0.35,
	"\\emptyset": 0.25, "\\psi": 0.35, "\\Gamma": 0.3, "\\in": 0.5, "\\epsilon": 0.6, "\\nabla": 0.4, "\\forall": 0.4, "\\exists": 0.4,
	"\\Leftrightarrow": 0.5, "\\div": 0.4, "\\ast": 0.35, "\\equiv": 0.6, "\\sim": 0.5, "\\approx": 0.7, "!": 0.35, "\\Omega": 0.5,
	"\\rho": 0.6, "\\tau": 0.5, "\\gamma": 0.7, "\\phi": 0.7, "\\sigma": 0.8, "\\mu": 0.8, "\\beta": 0.8, "Y": 0.6, "|": 0.7,
	"\\{": 0.5, "\\}": 0.5, "[": 0.8, "]": 0.8, "q": 0.7, "g": 0.8, "J": 0.6, "Q": 0.5, "G": 0.6, "I": 0.5, "l": 0.6,
	"<": 0.7, ">": 0.7, "z": 0.5, "Z": 0.5, "\\partial": 0.45, "\\alpha": 0.6, "\\Delta": 0.8, "\\leq": 0.8, "\\geq": 0.8, "\\Rightarrow": 0.8
};
const priorOf = (value: string) => PRIOR[value] ?? 1;

// ---------------------------------------------------------------------------
// Stage 1 — segmentation
// ---------------------------------------------------------------------------

interface Glyph {
	strokes: InkMathStroke[];
	/** Indices into the input, to join later strokes onto a glyph. */
	ids: number[];
	box: Box;
	/** Best readings, most likely first, without junk. */
	ranked: { value: string; p: number }[];
	junk: number;
	score: number;
	/** Too small to have a shape: a dot, a decimal point, a stroke of a colon. */
	dot?: boolean;
	/** The name finally given to it, once the layout has had its say. */
	value: string;
}

/** Same shape, different symbol: the classifier answers the first, the layout may restore the second. */
const TWINS: Record<string, string> = { "\\times": "x", "|": "1" };

/** Log-cost of one extra symbol. Positive values favour fewer, larger symbols. */
const SYMBOL_COST = 0.5;
const MAX_STROKES_PER_SYMBOL = 4;

function readGroup(strokes: InkMathStroke[], ids: number[], scale: number): Glyph {
	const box = boxOf(strokes.flatMap(s => s.points));
	if (Math.max(box.w, box.h) < scale * 0.16 && strokes.length <= 2) {
		// A short dash is a minus in an exponent, not a dot.
		if (strokes.length === 1 && box.w > scale * 0.07 && box.w > box.h * 2.5) {
			return { strokes, ids, box, ranked: [{ value: "-", p: 0.9 }, { value: ".", p: 0.05 }], junk: 0, score: Math.log(0.9), value: "-" };
		}
		return { strokes, ids, box, ranked: [{ value: ".", p: 0.9 }, { value: "\\cdot", p: 0.05 }], junk: 0, score: Math.log(0.9), dot: true, value: "." };
	}
	if (strokes.length === 2 && looksLikeEquals(strokes, scale)) {
		return { strokes, ids, box, ranked: [{ value: "=", p: 0.95 }, { value: "-", p: 0.02 }], junk: 0, score: Math.log(0.95), value: "=" };
	}
	const { probs, embedding } = classifyFeatures(glyphFeatures(strokes.map(s => s.points)));
	// Read it again leaning a little each way and average: hands slant, and
	// the network was trained on upright writing more than on slanted.
	for (const k of SLANTS) {
		const cyy = (box.y + box.bottom) / 2;
		const other = classifyFeatures(glyphFeatures(strokes.map(s => s.points.map(p => ({ x: p.x + (p.y - cyy) * k, y: p.y }))))).probs;
		for (let i = 0; i < probs.length; i++) probs[i] += other[i];
	}
	if (SLANTS.length) for (let i = 0; i < probs.length; i++) probs[i] /= SLANTS.length + 1;
	const byValue = new Map<string, number>();
	let junk = 0;
	let norm = 0;
	for (let i = 0; i < probs.length; i++) {
		const name = SYMBOL_CLASSES[i];
		if (name === JUNK) { junk = probs[i]; continue; }
		// Twins that only context can tell apart are read as the common one;
		// the layout turns them back (× between numbers, | taller than the line).
		const value = TWINS[name] ?? name;
		const p = probs[i] * priorOf(name);
		norm += p;
		byValue.set(value, (byValue.get(value) ?? 0) + p);
	}
	const ranked = [...byValue].map(([value, p]) => ({ value, p }));
	// Renormalise over real symbols, but keep the junk mass out of the total so
	// a group the network calls junk still scores badly. A single stroke cannot
	// be cut any further, so there junk says nothing about the segmentation.
	const keep = strokes.length === 1 ? 1 : Math.max(1e-6, 1 - junk);
	for (const r of ranked) r.p = r.p / Math.max(norm, 1e-9) * keep * Math.exp(-sizePenalty(r.value, box, scale));
	// Your own examples: a close one pulls its symbol up, whatever the network
	// learned from other hands. Only the symbol, not its case or its twin
	// (x or ×, 1 or |): those depend on where it stands, and one × taught in
	// "3 × 4" must not turn every later x into a product.
	for (const [label, weight] of personalVotes(embedding)) {
		const key = foldLabel(label);
		const entry = ranked.find(r => r.value === key) ?? (ranked.push({ value: key, p: 0 }), ranked[ranked.length - 1]);
		entry.p = Math.min(0.98, entry.p + Math.min(1, weight) * 0.7 * keep);
	}
	ranked.sort((a, b) => b.p - a.p);
	const top = ranked.slice(0, 6);
	// Strokes that touch were almost always meant as one symbol: the corner of
	// a 7 drawn in two strokes, the bar of a t, the two halves of a 4.
	const bonus = strokes.length > 1 && touching(strokes, scale) ? TOUCH_BONUS : 0;
	return { strokes, ids, box, ranked: top, junk, score: Math.log(Math.max(1e-6, top[0].p)) + bonus, value: top[0].value };
}

/** The class a written symbol belongs to: X → x, × → x, | → 1, O → 0. */
function foldLabel(label: string): string {
	if (TWINS[label]) return TWINS[label];
	if (label === "o" || label === "O") return "0";
	const lower = label.toLowerCase();
	return label.length === 1 && MERGED_CASE.has(lower) ? lower : label;
}

const TOUCH_BONUS = 1.4;
/** Shears tried besides the ink as written (measured on MathWriting valid: ±0.12 best). */
const SLANTS = [0.12, -0.12];

/**
 * Two short flat lines of about the same length, one right over the other: an
 * equals sign. The network sees too little ink in a small = to be sure of it,
 * and two minuses cost less than one symbol it doubts, so "A = b" came out as
 * "A − − b". The geometry is unambiguous; a fraction bar is much longer than
 * a minus over it, and a minus in a numerator has its number beside it.
 */
function looksLikeEquals(strokes: InkMathStroke[], scale: number): boolean {
	const [a, b] = strokes.map(s => boxOf(s.points));
	const flat = (o: Box) => o.w > Math.max(o.h * 2, scale * 0.12);
	if (!flat(a) || !flat(b)) return false;
	const shorter = Math.min(a.w, b.w), longer = Math.max(a.w, b.w);
	if (shorter < longer * 0.45 || longer > scale * 2.2) return false;
	// Hands shift the second line sideways and space the two generously.
	if (Math.abs(cx(a) - cx(b)) > longer * 0.8) return false;
	const gap = Math.abs(cy(a) - cy(b));
	return gap > Math.max(a.h, b.h) * 0.8 && gap < Math.min(scale * 0.8, longer * 1.7);
}

/** Every stroke meets another one: a single connected piece of ink. */
function touching(strokes: InkMathStroke[], scale: number): boolean {
	const reach = Math.max(2, scale * 0.09);
	const seen = new Set([0]);
	const queue = [0];
	while (queue.length) {
		const i = queue.pop()!;
		for (let j = 0; j < strokes.length; j++) {
			if (!seen.has(j) && inkDistance([strokes[i]], [strokes[j]]) < reach) { seen.add(j); queue.push(j); }
		}
	}
	return seen.size === strokes.length;
}

/** Can these strokes be one symbol at all? Far-apart ink never is. */
function plausibleGroup(strokes: InkMathStroke[], scale: number): boolean {
	const box = boxOf(strokes.flatMap(s => s.points));
	if (box.w > scale * 3.2 || box.h > scale * 3.6) return false;
	const boxes = strokes.map(s => boxOf(s.points));
	// The strokes of one symbol are stacked over each other or touch: an x
	// crosses, an = stacks, an i has its dot above. Two neighbours on a line
	// sit side by side, and so do a letter and its subscript. Every stroke has
	// to be linked to the rest through such contacts.
	if (strokes.length > 1) {
		const linked = (i: number, j: number) => {
			const a = boxes[i], b = boxes[j];
			const wa = Math.max(a.w, scale * 0.12), wb = Math.max(b.w, scale * 0.12);
			const ox = overlap1(a.x - scale * 0.04, a.x + wa + scale * 0.04, b.x - scale * 0.04, b.x + wb + scale * 0.04);
			if (ox > Math.min(wa, wb) * 0.3) return true;
			return inkDistance([strokes[i]], [strokes[j]]) < scale * 0.12;
		};
		const seen = new Set([0]);
		const queue = [0];
		while (queue.length) {
			const i = queue.pop()!;
			for (let j = 0; j < strokes.length; j++) if (!seen.has(j) && linked(i, j)) { seen.add(j); queue.push(j); }
		}
		if (seen.size < strokes.length) return false;
	}
	for (let i = 0; i < strokes.length; i++) {
		const others = strokes.filter((_, j) => j !== i);
		const b = boxes[i];
		// The two lines of an = can sit further apart than the strokes of a letter.
		const flatPair = b.w > b.h * 2.5 && boxes.some((o, j) => j !== i && o.w > o.h * 2.5
			&& overlap1(o.x, o.right, b.x, b.right) > Math.min(o.w, b.w) * 0.5);
		if (inkDistance([strokes[i]], others) > Math.max(scale * (flatPair ? 0.95 : 0.55), 3)) return false;
		// A long flat stroke over smaller ink is a fraction bar or a minus next
		// to something, never part of it: "1" over a bar read as π, and a
		// numerator with its bar as ≠. Bars only join bars (=, ≡).
		if (b.w > b.h * 3 && b.w > scale * 1.25) {
			const rest = boxes.filter((_, j) => j !== i);
			const flat = rest.every(o => o.w > o.h * 2.5 && o.w > b.w * 0.45);
			if (!flat && b.w > Math.max(...rest.map(o => Math.max(o.w, o.h))) * 1.6) return false;
		}
	}
	return true;
}

/** Symbols allowed to be much taller than the handwriting around them. */
const TALL = new Set(["\\sqrt", "\\int", "\\sum", "\\prod", "(", ")", "[", "]", "\\{", "\\}", "|", "/"]);
/** Symbols allowed to be much wider: bars and arrows. */
const WIDE = new Set(["\\sqrt", "\\sum", "\\prod", "-", "=", "\\rightarrow", "\\Rightarrow", "\\Leftrightarrow", "\\equiv", "\\approx", "\\sim"]);

/** How far a reading's size is from what that symbol usually measures. */
function sizePenalty(value: string, box: Box, scale: number): number {
	const h = box.h / scale, w = box.w / scale;
	const hLimit = TALL.has(value) ? 4 : 1.7;
	const wLimit = WIDE.has(value) ? 5 : 1.9;
	return Math.max(0, h - hLimit) * 2.5 + Math.max(0, w - wLimit) * 2.5;
}

function segment(strokes: InkMathStroke[], scale: number): Glyph[] {
	const n = strokes.length;
	const cache = new Map<string, Glyph | null>();
	const group = (from: number, to: number): Glyph | null => {
		const key = `${from}:${to}`;
		if (cache.has(key)) return cache.get(key)!;
		const slice = strokes.slice(from, to);
		const result = slice.length === 1 || plausibleGroup(slice, scale)
			? readGroup(slice, Array.from({ length: to - from }, (_, k) => from + k), scale)
			: null;
		cache.set(key, result);
		return result;
	};
	const best = new Array<number>(n + 1).fill(-Infinity);
	const back = new Array<number>(n + 1).fill(0);
	best[0] = 0;
	for (let j = 1; j <= n; j++) {
		for (let k = 1; k <= Math.min(MAX_STROKES_PER_SYMBOL, j); k++) {
			if (best[j - k] === -Infinity) continue;
			const g = group(j - k, j);
			if (!g) continue;
			const score = best[j - k] + g.score - SYMBOL_COST;
			if (score > best[j]) { best[j] = score; back[j] = k; }
		}
	}
	const glyphs: Glyph[] = [];
	for (let j = n; j > 0; j -= back[j]) glyphs.unshift(group(j - back[j], j)!);
	return joinLateStrokes(glyphs, scale);
}

/**
 * A stroke added later to a symbol written earlier: the dot of an i or a j,
 * the bar of a t, the second line of an = drawn after the next number. Two
 * glyphs whose ink overlaps or stacks tightly are joined when the network
 * finds the whole more believable than the parts.
 */
function joinLateStrokes(glyphs: Glyph[], scale: number): Glyph[] {
	let changed = true;
	let guard = 0;
	while (changed && guard++ < 40) {
		changed = false;
		let bestGain = 0, bestPair: [number, number] | null = null, bestGlyph: Glyph | null = null;
		for (let i = 0; i < glyphs.length; i++) {
			for (let j = i + 1; j < glyphs.length; j++) {
				const a = glyphs[i], b = glyphs[j];
				if (a.strokes.length + b.strokes.length > MAX_STROKES_PER_SYMBOL) continue;
				// Neighbours in time were already weighed by the dynamic programme.
				if (Math.abs(Math.max(...a.ids) - Math.min(...b.ids)) <= 1 && Math.abs(Math.max(...b.ids) - Math.min(...a.ids)) <= 1) continue;
				const ox = overlap1(a.box.x, a.box.right, b.box.x, b.box.right);
				const oy = overlap1(a.box.y, a.box.bottom, b.box.y, b.box.bottom);
				const smaller = Math.min(Math.max(a.box.w, a.box.h), Math.max(b.box.w, b.box.h));
				const crossing = ox > smaller * 0.3 && oy > smaller * 0.3;
				const dotAbove = (a.dot || b.dot) && ox > -scale * 0.1
					&& Math.abs(cx(a.box) - cx(b.box)) < scale * 0.35 && inkDistance(a.strokes, b.strokes) < scale * 0.7;
				if (!crossing && !dotAbove) continue;
				const strokes = [...a.strokes, ...b.strokes];
				if (!plausibleGroup(strokes, scale)) continue;
				const merged = readGroup(strokes, [...a.ids, ...b.ids], scale);
				const gain = merged.score - (a.score + b.score - SYMBOL_COST);
				if (gain > bestGain) { bestGain = gain; bestPair = [i, j]; bestGlyph = merged; }
			}
		}
		if (bestPair && bestGlyph) {
			glyphs.splice(bestPair[1], 1);
			glyphs[bestPair[0]] = bestGlyph;
			changed = true;
		}
	}
	return glyphs;
}

// ---------------------------------------------------------------------------
// Stage 2 — structure
// ---------------------------------------------------------------------------

/** A glyph, or a region already parsed (a fraction, a root, a big operator). */
interface Unit {
	box: Box;
	latex: string;
	/** Height of this unit's line of writing, as a capital letter would be. */
	size: number;
	/** Height of the maths axis: where a minus sign would sit next to it. */
	axis: number;
	glyph?: Glyph;
	kind: "glyph" | "compound";
	/** Big operators take limits; fractions and roots are closed. */
	takesScripts: boolean;
	operator: boolean;
	tokens: InkMathToken[];
	/** For c/C, x/X…: the size and axis if it is the capital. */
	alt?: { size: number; axis: number };
}

function glyphUnit(g: Glyph, scale: number): Unit {
	const unit = glyphUnitAs(g, scale, g.value);
	// The case of c/C, x/X… is not known yet, so both readings are kept and a
	// script needs both to agree.
	if (MERGED_CASE.has(g.value)) {
		const capital = glyphUnitAs(g, scale, "A");
		const small = glyphUnitAs(g, scale, "a");
		unit.size = small.size;
		unit.axis = small.axis;
		unit.alt = { size: capital.size, axis: capital.axis };
	}
	return unit;
}

function glyphUnitAs(g: Glyph, scale: number, v: string): Unit {
	const b = g.box;
	let size: number, axis: number;
	if (g.dot) {
		size = scale;
		axis = b.bottom - scale * 0.3;
	} else if (OPERATORS.has(v)) {
		size = Math.max(b.h * 1.6, scale * 0.6);
		axis = cy(b);
	} else if (FENCES.has(v) || BIG.has(v) || v === "\\sqrt") {
		size = b.h / 1.2;
		axis = cy(b);
	} else if (DESCENDERS.has(v)) {
		size = b.h / 1.05;
		axis = b.y + b.h * 0.3;
	} else if (ASCENDERS.has(v)) {
		size = b.h;
		axis = b.bottom - b.h * 0.33;
	} else {
		// x-height letters: a, c, e, m, n, r, u, x...
		size = b.h / 0.62;
		axis = cy(b);
	}
	return {
		box: b, latex: v, size: Math.max(size, 1), axis, glyph: g, kind: "glyph",
		takesScripts: !OPERATORS.has(v) && !g.dot && !["(", "[", "\\{"].includes(v),
		operator: OPERATORS.has(v),
		tokens: []
	};
}

/** Readings the network cannot separate, offered next to each other in the review list. */
function lookalikes(value: string): string[] {
	const lower = value.toLowerCase();
	if (MERGED_CASE.has(lower)) return [lower, lower.toUpperCase()];
	if (value === "x" || value === "X" || value === "\\times") return ["x", "X", "\\times"];
	if (value === "1" || value === "|" || value === "l") return ["1", "l", "|"];
	if (value === "0") return ["0", "o", "O"];
	return [];
}

function tokenOf(g: Glyph): InkMathToken {
	const values = g.ranked.flatMap(r => [r.value, ...lookalikes(r.value)]);
	const alternatives = [...new Set([g.value, ...lookalikes(g.value), ...values])].slice(0, 6);
	const base = (v: string) => TWINS[v] ?? (MERGED_CASE.has(v.toLowerCase()) ? v.toLowerCase() : v);
	const p = g.ranked.find(r => r.value === base(g.value))?.p ?? g.ranked[0]?.p ?? 0;
	const second = g.ranked.find(r => r.value !== base(g.value))?.p ?? 0;
	return {
		value: g.value,
		alternatives,
		strokes: g.strokes,
		confidence: Math.max(0, Math.min(1, p / Math.max(1e-6, p + second) * Math.min(1, p * 1.6))),
		// Nothing it knows, or ink the network itself calls "not one symbol".
		unknown: !g.dot && ((g.ranked[0]?.p ?? 0) < 0.08 || (g.junk > 0.6 && (g.ranked[0]?.p ?? 0) < 0.35))
	};
}

/** True when the glyph is a horizontal line: a minus, a fraction bar, an overline. */
function isBar(g: Glyph): boolean {
	return !g.dot && g.box.w > g.box.h * 2.6 && (g.value === "-" || g.ranked.slice(0, 3).some(r => r.value === "-"));
}

interface Parsed { latex: string; tokens: InkMathToken[] }

function parseGlyphs(glyphs: Glyph[], scale: number, depth = 0): Parsed {
	if (!glyphs.length) return { latex: "", tokens: [] };
	let units: Unit[] = [];
	let rest = [...glyphs];

	// Fractions, widest bar first: the main bar owns everything in its column.
	if (depth < 6) {
		const bars = rest.filter(isBar).sort((a, b) => b.box.w - a.box.w);
		for (const bar of bars) {
			if (!rest.includes(bar)) continue;
			const pad = Math.max(bar.box.w * 0.12, scale * 0.15);
			const barY = cy(bar.box);
			const inColumn = (g: Glyph) => g !== bar && cx(g.box) > bar.box.x - pad && cx(g.box) < bar.box.right + pad
				&& overlap1(g.box.x, g.box.right, bar.box.x - pad, bar.box.right + pad) > g.box.w * 0.5;
			const above = rest.filter(g => inColumn(g) && g.box.bottom < barY + scale * 0.12 && cy(g.box) < barY);
			const below = rest.filter(g => inColumn(g) && g.box.y > barY - scale * 0.12 && cy(g.box) > barY);
			if (!above.length || !below.length) continue;
			// Only the ink close to the bar: a formula written on the line above
			// is not a numerator.
			const nearAbove = clusterFrom(above, barY, -1, scale);
			const nearBelow = clusterFrom(below, barY, 1, scale);
			if (!nearAbove.length || !nearBelow.length) continue;
			const numBox = union(nearAbove.map(g => g.box)), denBox = union(nearBelow.map(g => g.box));
			if (bar.box.w < Math.max(numBox.w, denBox.w) * 0.45) continue;
			const numerator = parseGlyphs(nearAbove, scale, depth + 1);
			const denominator = parseGlyphs(nearBelow, scale, depth + 1);
			const claimed = new Set([bar, ...nearAbove, ...nearBelow]);
			rest = rest.filter(g => !claimed.has(g));
			const box = union([bar.box, numBox, denBox]);
			units.push({
				box, latex: `\\frac{${numerator.latex}}{${denominator.latex}}`,
				size: Math.max(scale, Math.min(numBox.h, denBox.h) * 1.1), axis: barY, kind: "compound",
				takesScripts: false, operator: false,
				tokens: [...numerator.tokens, ...denominator.tokens]
			});
		}
	}

	// Radicals own what their vinculum covers.
	for (const root of rest.filter(g => g.value === "\\sqrt").sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)) {
		if (!rest.includes(root)) continue;
		const b = root.box;
		const hook = Math.min(b.w * 0.35, b.h * 0.5);
		const insideGlyph = (box: Box) => cx(box) > b.x + hook * 0.6 && box.x < b.right - Math.min(box.w, scale) * 0.1
			&& cy(box) > b.y - scale * 0.1 && cy(box) < b.bottom + scale * 0.1;
		const inside = rest.filter(g => g !== root && insideGlyph(g.box));
		const insideUnits = units.filter(u => insideGlyph(u.box));
		if (!inside.length && !insideUnits.length) continue;
		// The index of a cube root sits small in the crook of the hook.
		const index = rest.filter(g => g !== root && !inside.includes(g) && Math.max(g.box.w, g.box.h) < b.h * 0.55
			&& cx(g.box) < b.x + hook * 1.1 && cx(g.box) > b.x - scale * 0.5
			&& g.box.bottom < b.y + b.h * 0.7 && g.box.bottom > b.y - scale * 0.3);
		const degree = index.length ? parseGlyphs(index, scale, depth + 1) : null;
		const body = parseMixed(inside, insideUnits, scale, depth + 1);
		rest = rest.filter(g => g !== root && !inside.includes(g) && !index.includes(g));
		units = units.filter(u => !insideUnits.includes(u));
		units.push({
			box: union([b, ...inside.map(g => g.box), ...insideUnits.map(u => u.box), ...index.map(g => g.box)]),
			latex: `\\sqrt${degree?.latex ? `[${degree.latex}]` : ""}{${body.latex}}`, size: Math.max(scale, b.h / 1.2), axis: cy(b), kind: "compound",
			takesScripts: true, operator: false, tokens: [{ ...tokenOf(root), value: "\\sqrt" }, ...(degree?.tokens ?? []), ...body.tokens]
		});
	}

	// Sums and products carry limits above and below; "lim" carries one below.
	for (const op of rest.filter(g => g.value === "\\sum" || g.value === "\\prod")) {
		if (!rest.includes(op)) continue;
		const b = op.box;
		const inWindow = (box: Box) => cx(box) > b.x - b.w * 0.35 && cx(box) < b.right + b.w * 0.35;
		const above = rest.filter(g => g !== op && inWindow(g.box) && g.box.bottom < b.y + b.h * 0.2 && b.y - g.box.bottom < b.h * 1.2);
		const below = rest.filter(g => g !== op && inWindow(g.box) && g.box.y > b.bottom - b.h * 0.2 && g.box.y - b.bottom < b.h * 1.2);
		if (!above.length && !below.length) continue;
		const up = parseGlyphs(above, scale, depth + 1), down = parseGlyphs(below, scale, depth + 1);
		rest = rest.filter(g => g !== op && !above.includes(g) && !below.includes(g));
		units.push({
			box: union([b, ...above.map(g => g.box), ...below.map(g => g.box)]),
			latex: `${op.value}${down.latex ? `_{${down.latex}}` : ""}${up.latex ? `^{${up.latex}}` : ""}`,
			size: b.h / 1.2, axis: cy(b), kind: "compound", takesScripts: false, operator: false,
			tokens: [tokenOf(op), ...down.tokens, ...up.tokens]
		});
	}
	const lim = findLim(rest, scale);
	if (lim) {
		rest = rest.filter(g => !lim.parts.includes(g) && !lim.below.includes(g));
		const down = parseGlyphs(lim.below, scale, depth + 1);
		units.push({
			box: union([lim.box, ...lim.below.map(g => g.box)]),
			latex: `\\lim${down.latex ? `_{${down.latex}}` : ""}`,
			size: lim.box.h, axis: lim.box.bottom - lim.box.h * 0.33, kind: "compound", takesScripts: false, operator: false,
			tokens: down.tokens
		});
	}
	return parseMixed(rest, units, scale, depth);
}

/** The glyphs stacked against a bar, stopping at a clear vertical gap. */
function clusterFrom(glyphs: Glyph[], barY: number, direction: -1 | 1, scale: number): Glyph[] {
	const sorted = [...glyphs].sort((a, b) => direction < 0 ? b.box.bottom - a.box.bottom : a.box.y - b.box.y);
	const out: Glyph[] = [];
	let edge = barY;
	for (const g of sorted) {
		const gap = direction < 0 ? edge - g.box.bottom : g.box.y - edge;
		if (gap > scale * 1.1) break;
		out.push(g);
		edge = direction < 0 ? Math.min(edge, g.box.y) : Math.max(edge, g.box.bottom);
	}
	return out;
}

function findLim(glyphs: Glyph[], scale: number): { parts: Glyph[]; below: Glyph[]; box: Box } | null {
	const row = [...glyphs].sort((a, b) => a.box.x - b.box.x);
	const is = (g: Glyph, letters: string[]) => g.ranked.slice(0, 3).some(r => letters.includes(r.value)) || letters.includes(g.value);
	for (let i = 0; i + 2 < row.length; i++) {
		const [l, ii, m] = [row[i], row[i + 1], row[i + 2]];
		if (!is(l, ["l", "1", "|", "I"]) || !is(ii, ["i", "l", "1", "|", "j"]) || !is(m, ["m", "n", "w"])) continue;
		const box = union([l.box, ii.box, m.box]);
		if (box.w > scale * 3.5 || Math.abs(l.box.bottom - m.box.bottom) > scale * 0.5) continue;
		const below = glyphs.filter(g => ![l, ii, m].includes(g) && g.box.y > box.bottom - scale * 0.1
			&& cx(g.box) > box.x - scale * 0.8 && cx(g.box) < box.right + scale * 0.8 && g.box.y - box.bottom < scale * 1.3);
		return { parts: [l, ii, m], below, box };
	}
	return null;
}

/** Reads loose glyphs and parsed units together along a baseline. */
function parseMixed(glyphs: Glyph[], compounds: Unit[], scale: number, depth: number): Parsed {
	const units = [...glyphs.map(g => glyphUnit(g, scale)), ...compounds].sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
	if (!units.length) return { latex: "", tokens: [] };
	return readLine(units, scale, depth);
}

type Relation = "right" | "sup" | "sub";

function relation(base: Unit, next: Unit): Relation {
	if (!base.takesScripts) return "right";
	if (next.glyph?.dot) {
		// A dot high up is a prime or a dot product; handled when emitting.
		return "right";
	}
	// Relations do not start an exponent: an = written a little high is still
	// the = of the equation. A comma hangs low without being a subscript.
	const v = next.glyph?.value ?? "";
	if (next.glyph && looksLikeComma(next.glyph, base)) return "right";
	if (next.operator && v !== "-" && v !== "+") return "right";
	// Every reading of an uncertain case has to agree before ink leaves the line.
	const bases = [{ size: base.size, axis: base.axis }, ...(base.alt ? [base.alt] : [])];
	const nexts = [{ size: next.size, axis: next.axis }, ...(next.alt ? [next.alt] : [])];
	let agreed: Relation | null = null;
	for (const b of bases) for (const n of nexts) {
		const r = relationAs(base, next, b, n);
		if (r === "right") return "right";
		if (agreed && agreed !== r) return "right";
		agreed = r;
	}
	return agreed ?? "right";
}

function relationAs(base: Unit, next: Unit, b: { size: number; axis: number }, n: { size: number; axis: number }): Relation {
	const size = b.size;
	const nextSize = next.kind === "glyph" && next.operator ? size : n.size;
	const smaller = nextSize < size * 0.86 || next.box.h < base.box.h * 0.72;
	const raise = (b.axis - n.axis) / size;
	const v = next.glyph?.value ?? "";
	// Signs only when clearly lifted (x^{-1}).
	if ((v === "-" || v === "+") && raise < 0.6) return "right";
	if (raise > 0.3 && next.box.bottom < base.box.bottom - size * 0.3 && (smaller || raise > 0.55)) return "sup";
	// A much smaller glyph needs less of a drop: the 0 of x₀ is written low,
	// but its own middle is still close to the letter's.
	// Not after a d: the x of "dx" is small next to a tall d and sits on the line.
	const tiny = next.box.h < base.box.h * 0.45 && base.kind === "glyph" && !BIG.has(base.latex) && base.latex !== "d" && base.latex !== "\\partial";
	if (raise < (tiny ? -0.17 : -0.25) && next.box.y > base.box.y + size * 0.3 && smaller && !next.operator) return "sub";
	return "right";
}

/** One piece of a line: a unit on the baseline, or the script attached to the previous one. */
interface Piece { text: string; unit?: Unit; tokens: InkMathToken[] }

function readLine(units: Unit[], scale: number, depth: number, inScript = false): Parsed {
	const pieces: Piece[] = [];
	const lineUnits: Unit[] = [];
	let i = 0;
	let base: Unit | null = null;
	while (i < units.length) {
		const unit = units[i];
		const rel: Relation = base ? relation(base, unit) : "right";
		if (rel === "right" || !base) {
			const text = emitUnit(unit, lineUnits);
			pieces.push({ text, unit, tokens: unit.glyph ? [tokenOf(unit.glyph)] : unit.tokens });
			lineUnits.push(unit);
			base = unit;
			i++;
			continue;
		}
		// Everything written in the same script region, up to the next glyph that
		// returns to the line. A subscript and then an exponent on the same base
		// (x_i^2) come out as two pieces.
		const script: Unit[] = [unit];
		let j = i + 1;
		while (j < units.length && relation(base, units[j]) === rel) script.push(units[j++]);
		// Primes: short straight ticks up by the shoulder of the letter. The
		// network reads a lone tick as "/" or "1", which is right for a tick
		// on its own and wrong in this place.
		if (rel === "sup" && script.every(u => isPrimeTick(u, base!))) {
			for (const u of script) {
				u.glyph!.value = "'";
				pieces.push({ text: "'", tokens: [tokenOf(u.glyph!)] });
			}
			i = j;
			continue;
		}
		const inner = depth < 6 ? readLine(script, scale, depth + 1, true) : { latex: script.map(u => u.latex).join(""), tokens: [] };
		pieces.push({ text: rel === "sup" ? `^{${inner.latex}}` : `_{${inner.latex}}`, tokens: inner.tokens });
		i = j;
	}
	if (inScript) preferScriptSymbols(pieces);
	contextualise(pieces, scale);
	const words = findWords(pieces);
	return { latex: joinLatex(words.map(p => p.text)), tokens: words.flatMap(p => p.tokens) };
}

/**
 * Exponents and subscripts are mostly digits and a handful of letters (n, i,
 * k, t, x…); a capital or an integral up there is rare. The small size of a
 * script makes its shape harder to read, so this prior matters most there.
 */
function preferScriptSymbols(pieces: Piece[]): void {
	for (const piece of pieces) {
		const g = piece.unit?.glyph;
		if (!g || g.dot || !g.ranked.length || g.value !== g.ranked[0].value) continue;
		// A lone exponent is a number far more often than not: x², t², 10³.
		const digit = pieces.length === 1 ? 4 : 2.2;
		const weight = (v: string) => /^[0-9]$/.test(v) ? digit : /^[ijkmnrtxyz]$/.test(v) ? 1.3 : /^[A-Z]$/.test(v) || v.startsWith("\\") ? 0.5 : 1;
		g.ranked = g.ranked.map(r => ({ value: r.value, p: r.p * weight(r.value) })).sort((a, b) => b.p - a.p);
		g.value = g.ranked[0].value;
	}
}

/**
 * A 2 and a z, a 5 and an s, a 9 and a g are the same shape in many hands.
 * Numbers are written next to numbers and letters next to letters, so when
 * the network hesitates between the two kinds, the neighbours decide.
 */
function preferNeighbours(pieces: Piece[]): void {
	const kind = (p: Piece | undefined): "digit" | "letter" | null => {
		const v = p?.unit?.glyph?.value ?? "";
		if (!p?.unit?.glyph || p.unit.glyph.dot) return null;
		return /^[0-9]$/.test(v) ? "digit" : /^[A-Za-z]$/.test(v) ? "letter" : null;
	};
	const decided = pieces.map(kind);
	pieces.forEach((piece, i) => {
		const g = piece.unit?.glyph;
		if (!g || g.dot || !decided[i]) return;
		// Only numbers are informative: "2x" puts a digit next to a letter all the
		// time, but a letter is rarely written inside a number.
		const around = [decided[i - 1], decided[i + 1]].filter(Boolean);
		if (!around.length || !around.every(k => k === "digit") || decided[i] === "digit") return;
		const want = /^[0-9]$/;
		const top = g.ranked[0]?.p ?? 0;
		const other = g.ranked.find(r => want.test(r.value));
		// Only a real hesitation: the other kind within a factor of three.
		if (other && other.p > top / 3) g.value = other.value;
	});
}

/** A prime: one short, nearly straight, upright or slanted tick. */
function isPrimeTick(u: Unit, base: Unit): boolean {
	const g = u.glyph;
	if (!g || g.strokes.length !== 1 || !["/", "1", "|", ",", "'", "l", ")", "("].includes(g.value)) return false;
	if (g.box.h > base.box.h * 0.6 || g.box.w > g.box.h * 1.1) return false;
	const pts = g.strokes[0].points;
	let length = 0;
	for (let k = 1; k < pts.length; k++) length += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
	const chord = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
	return length > 0 && chord / length > 0.85;
}

/**
 * Heights of capitals and small letters over the whole formula, for a line
 * that has nothing of its own to compare with: the C of "C = 6000/(200−2x)"
 * stands alone on its line, but the digits in the fraction say how tall a
 * capital is in this hand.
 */
let formulaReference = { tallH: 0, smallH: 0 };

const XHEIGHT = new Set([..."acemnrsuvwxz", "\\alpha", "\\epsilon", "\\omega", "\\pi", "\\sigma", "\\tau"]);

/**
 * A t and a + are the same two lines. The t is crossed near the top of a
 * stem as tall as the digits; the + is crossed in the middle and is smaller.
 */
function plusOrTee(g: Glyph, tallH: number): string {
	const boxes = g.strokes.map(s => boxOf(s.points));
	const stemIndex = boxes[0].h / Math.max(boxes[0].w, 1) > boxes[1].h / Math.max(boxes[1].w, 1) ? 0 : 1;
	const stem = boxes[stemIndex], bar = boxes[1 - stemIndex];
	const at = (cy(bar) - stem.y) / Math.max(stem.h, 1);
	// Crossed in the top third of the stem: only a t is drawn like that.
	if (at < 0.34) return "t";
	if (!tallH) return g.value;
	// Measured on MathWriting: the crossing point alone misleads (people cross
	// a t in the middle and a + off-centre); the height against the digits does not.
	if (g.box.h > tallH * 0.92 && at < 0.5) return "t";
	if (g.box.h < tallH * 0.62) return "+";
	return g.value;
}

/**
 * A ∂ is a d with its stem curled back, and a 0 or a 2 with a tail looks the
 * same. A partial derivative is always followed by what it differentiates, so
 * a ∂ before a number, an operator or nothing is one of its look-alikes, and
 * a ∂ the network nearly read as a d is the d of dx, far commoner in school.
 */
function partialOrNot(g: Glyph, next: Piece | undefined): string {
	const after = next?.unit?.glyph?.value ?? (next ? next.text : "");
	const variable = /^[A-Za-z]$|^\\(alpha|beta|gamma|theta|lambda|mu|phi|psi|rho|sigma|tau|omega)$/.test(after);
	const top = g.ranked.find(r => r.value === "\\partial")?.p ?? 0;
	const d = g.ranked.find(r => r.value === "d")?.p ?? 0;
	if (variable) return d > top / 4 ? "d" : "\\partial";
	// Unless it is unmistakable: ∂/∂x has nothing after the upper ∂.
	const other = g.ranked.find(r => r.value !== "\\partial");
	return other && other.p > top * 0.1 ? other.value : "\\partial";
}

/**
 * A + joins two things. One with nothing after it, or right before a closing
 * bracket or an =, is the t of "dt" or "f(t)" written with a centred bar.
 */
function lonePlus(pieces: Piece[], index: number): boolean {
	const g = pieces[index].unit?.glyph;
	if (!g || g.strokes.length > 2) return false;
	const next = pieces[index + 1];
	const after = next?.unit?.glyph?.value ?? next?.text ?? "";
	const before = pieces[index - 1]?.unit?.glyph?.value ?? "";
	// A + on its own is what it looks like: someone writing the sign itself.
	if (pieces.length === 1) return false;
	return !next || [")", "]", "=", "<", ">", "\\leq", "\\geq", "\\neq", ","].includes(after) || before === "d";
}

/**
 * Decisions that need the whole line: the case of c/C, s/S, x/X… (a capital
 * is as tall as the digits and clearly taller than the small letters), p
 * against P (a p hangs below the line), × against x (a × sits between two
 * numbers) and | against 1 (a bar is taller than what surrounds it).
 */
function contextualise(pieces: Piece[], scale: number): void {
	const onLine = pieces.filter(p => p.unit?.glyph && !p.unit.glyph.dot);
	const valueOf = (p: Piece | undefined) => p?.unit?.glyph?.value ?? "";
	preferNeighbours(pieces);
	const tall = onLine.filter(p => ASCENDERS.has(valueOf(p)) && !FENCES.has(valueOf(p)));
	const small = onLine.filter(p => XHEIGHT.has(valueOf(p)) && !MERGED_CASE.has(valueOf(p)));
	const tallH = tall.length ? median(tall.map(p => p.unit!.box.h)) : formulaReference.tallH;
	const smallH = small.length ? median(small.map(p => p.unit!.box.h)) : tall.length ? 0 : formulaReference.smallH;
	const bottoms = [...tall, ...small].map(p => p.unit!.box.bottom);
	const baseline = bottoms.length ? median(bottoms) : NaN;
	onLine.forEach(piece => {
		const g = piece.unit!.glyph!;
		const h = g.box.h;
		const index = pieces.indexOf(piece);
		if (MERGED_CASE.has(g.value)) {
			let upper = false;
			// A k is tall in either case, so its height says nothing.
			if (g.value === "k") upper = false;
			// x and z are variables, almost always small, and many hands
			// write them as tall as the digits. Only a clearly bigger letter than
			// the small ones next to it is a capital.
			else if ("xz".includes(g.value)) upper = !!smallH && h > smallH * 1.6;
			else if (g.value === "p" && Number.isFinite(baseline)) upper = g.box.bottom < baseline + h * 0.2;
			else if (tallH) upper = h > tallH * 0.95 && (!smallH || h > smallH * 1.45);
			else if (smallH) upper = h > smallH * 1.35;
			if (upper) g.value = g.value.toUpperCase();
		}
		if (g.value === "x" || g.value === "X") {
			const before = valueOf(pieces[index - 1]), after = valueOf(pieces[index + 1]);
			const operand = (v: string, closing: boolean) => /^[0-9]$/.test(v) || v === (closing ? ")" : "(");
			if (operand(before, true) && operand(after, false) && (!tallH || h < tallH * 0.85)) g.value = "\\times";
		}
		if (g.value === "1") {
			const reference = tallH || (smallH ? smallH / 0.62 : scale);
			if (h > reference * 1.3) g.value = "|";
		}
		if ((g.value === "+" || g.value === "t") && g.strokes.length === 2) g.value = plusOrTee(g, tallH);
		if (g.value === "\\partial") g.value = partialOrNot(g, pieces[index + 1]);
		if (g.value === "+" && lonePlus(pieces, index)) g.value = "t";
		piece.text = g.value === "\\sqrt" ? "\\sqrt{}" : g.value;
		piece.tokens = [tokenOf(g)];
	});
	// Dots, measured against the whole line: on it a decimal point, halfway up
	// a product, above the small letters a prime.
	const xh = smallH || (tallH ? tallH * 0.6 : 0);
	if (Number.isFinite(baseline) && xh) {
		for (const piece of pieces) {
			const g = piece.unit?.glyph;
			if (!g?.dot) continue;
			const y = cy(g.box);
			g.value = y > baseline - xh * 0.28 ? "." : y > baseline - xh * 0.95 ? "\\cdot" : "'";
			piece.text = g.value;
			piece.tokens = [tokenOf(g)];
		}
	}
	// |x|: two upright strokes of about the same height around something that
	// is not a number are absolute-value bars, not ones.
	const isStem = (p: Piece) => p.unit?.glyph && (p.unit.glyph.value === "1" || p.unit.glyph.value === "|");
	for (let i = 0; i < pieces.length; i++) {
		if (!isStem(pieces[i])) continue;
		for (let j = i + 2; j < pieces.length; j++) {
			if (!isStem(pieces[j])) continue;
			const a = pieces[i].unit!.box, b = pieces[j].unit!.box;
			const inner = pieces.slice(i + 1, j);
			const wordy = inner.some(p => !p.unit?.glyph || /^[A-Za-z]$|^\\[A-Za-z]+$/.test(p.unit.glyph.value));
			if (wordy && Math.min(a.h, b.h) / Math.max(a.h, b.h) > 0.7) {
				for (const p of [pieces[i], pieces[j]]) {
					p.unit!.glyph!.value = "|";
					p.text = "|";
					p.tokens = [tokenOf(p.unit!.glyph!)];
				}
			}
			break;
		}
	}
}

const COMMA_SHAPES = new Set([")", "1", "|", "/", "(", "l", "J", "j", "i", "7", "\\int", ","]);

/**
 * A comma is a short mark that starts at the line and hangs below it. A
 * subscript is just as small and just as low, but it starts higher, level
 * with the lower half of the letter it belongs to.
 */
function looksLikeComma(g: Glyph, previous: Unit): boolean {
	if (g.dot || !COMMA_SHAPES.has(g.value)) return false;
	const p = previous.box;
	const line = previous.glyph && DESCENDERS.has(previous.glyph.value) ? p.y + p.h * 0.65 : p.bottom;
	const size = previous.size;
	return g.box.h < size * 0.5 && g.box.y > line - size * 0.2 && g.box.bottom > line + size * 0.05;
}

/** Dots that are decimal points, products or primes, and commas. */
function emitUnit(unit: Unit, line: Unit[]): string {
	const g = unit.glyph;
	if (!g) return unit.latex;
	if (g.dot) {
		const neighbour = line[line.length - 1];
		if (neighbour) {
			const top = neighbour.box.y, bottom = neighbour.box.bottom;
			const y = cy(g.box);
			if (y < top + (bottom - top) * 0.25) { g.value = "'"; return "'"; }
			if (y < bottom - (bottom - top) * 0.3) { g.value = "\\cdot"; return "\\cdot"; }
		}
		g.value = ".";
		return ".";
	}
	const neighbour = line[line.length - 1];
	if (neighbour && looksLikeComma(g, neighbour)) {
		g.value = ",";
		return ",";
	}
	// A root with nothing under it yet still has to be valid LaTeX.
	if (g.value === "\\sqrt") return "\\sqrt{}";
	return g.value;
}

const WORDS: [string, string][] = [
	["sin", "\\sin"], ["cos", "\\cos"], ["tan", "\\tan"], ["log", "\\log"], ["ln", "\\ln"], ["exp", "\\exp"],
	["max", "\\max"], ["min", "\\min"], ["sen", "\\sin"], ["tg", "\\tan"], ["det", "\\det"]
];

/**
 * sin, cos, log… written letter by letter become one word. A letter fits when
 * it is the reading or one of the close alternatives: the o of "cos" is read
 * as a zero on its own, and the network is right to, until it sits between a
 * c and an s.
 */
function findWords(pieces: Piece[]): Piece[] {
	const out = [...pieces];
	const fits = (piece: Piece | undefined, letter: string) => {
		const g = piece?.unit?.glyph;
		if (!g || g.dot) return false;
		if (g.value.toLowerCase() === letter) return true;
		return g.ranked.slice(0, 4).some(r => r.p > 0.03 && (r.value.toLowerCase() === letter || (letter === "o" && r.value === "0")
			|| (letter === "l" && (r.value === "1" || r.value === "|" || r.value === "I"))));
	};
	for (const [word, command] of WORDS) {
		for (let i = 0; i + word.length <= out.length; i++) {
			let ok = true;
			for (let k = 0; k < word.length && ok; k++) ok = fits(out[i + k], word[k]);
			if (!ok) continue;
			const letters = out.slice(i, i + word.length);
			for (const [k, piece] of letters.entries()) if (piece.unit?.glyph) piece.unit.glyph.value = word[k];
			out.splice(i, word.length, {
				text: command,
				unit: undefined,
				tokens: [{ value: command, alternatives: [command], confidence: 0.9 }]
			});
		}
	}
	return out;
}

/** Joins tokens, leaving a space only where LaTeX needs one (after \alpha before a letter). */
function joinLatex(parts: string[]): string {
	let out = "";
	for (const part of parts) {
		if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z0-9]/.test(part)) out += " ";
		out += part;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Recognises the notation used in school and university notes. */
export function recognizeInkFormula(strokes: InkMathStroke[]): InkMathRecognition {
	const clean = strokes
		.map(stroke => ({ ...stroke, points: stroke.points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) }))
		.filter(stroke => stroke.points.length > 0);
	if (!clean.length) return { source: "", confidence: 0, tokens: [], unknown: 0, detail: tr("Sin tinta") };

	// The size of the handwriting: most strokes are about one symbol tall.
	const sizes = clean.map(s => { const b = boxOf(s.points); return Math.max(b.w, b.h); });
	const big = Math.max(...sizes);
	const scale = Math.max(4, median(sizes.filter(s => s > big * 0.18)) || big);

	const glyphs = segment(clean, scale);
	const normal = glyphs.filter(g => !g.dot && g.box.h > scale * 0.55);
	const heightsOf = (set: Set<string>, exclude?: Set<string>) =>
		normal.filter(g => set.has(g.value) && !exclude?.has(g.value) && !FENCES.has(g.value)).map(g => g.box.h);
	const tallAll = heightsOf(ASCENDERS), smallAll = heightsOf(XHEIGHT, MERGED_CASE);
	formulaReference = { tallH: tallAll.length ? median(tallAll) : 0, smallH: smallAll.length ? median(smallAll) : 0 };
	const lines = splitLines(glyphs, scale);
	const parsed = lines.length > 1 ? joinLines(lines.map(line => parseGlyphs(line, scale))) : parseGlyphs(glyphs, scale);
	const tokens = parsed.tokens;
	const unknown = tokens.filter(t => t.unknown).length;
	const confidence = tokens.length ? tokens.reduce((sum, t) => sum + t.confidence, 0) / tokens.length : 0;
	const uncertain = tokens.filter(t => !t.unknown && t.confidence < 0.56).length;
	const structured = /\\frac|\\sqrt|\^|_|\\sum|\\int|\\lim/.test(parsed.latex);
	const detail = unknown
		? tr("No estoy seguro de {p0} símbolo(s). Elige debajo el correcto o escríbelo otra vez.", { p0: unknown })
		: structured
			? tr("Estructura matemática detectada · {p0}%", { p0: Math.round(confidence * 100) })
			: uncertain
				? tr("{p0} símbolo(s) por revisar · {p1}%", { p0: uncertain, p1: Math.round(confidence * 100) })
				: tr("Lectura vectorial · {p0}%", { p0: Math.round(confidence * 100) });
	return { source: parsed.latex, confidence, tokens, unknown, detail };
}

/**
 * Rows of writing: a derivation written step under step. Glyphs whose
 * vertical extents overlap or nearly touch are one row; a fraction keeps its
 * numerator and denominator together because its bar sits between them.
 */
function splitLines(glyphs: Glyph[], scale: number): Glyph[][] {
	const solid = glyphs.filter(g => !g.dot).sort((a, b) => a.box.y - b.box.y);
	if (solid.length < 2) return [glyphs];
	const rows: { top: number; bottom: number; glyphs: Glyph[] }[] = [];
	for (const g of solid) {
		const row = rows[rows.length - 1];
		if (row && g.box.y <= row.bottom + scale * 0.75) {
			row.glyphs.push(g);
			row.bottom = Math.max(row.bottom, g.box.bottom);
		} else {
			rows.push({ top: g.box.y, bottom: g.box.bottom, glyphs: [g] });
		}
	}
	if (rows.length < 2) return [glyphs];
	// Dots go with the row they sit in or just under (a decimal point, an i).
	for (const g of glyphs.filter(g => g.dot)) {
		const y = cy(g.box);
		const row = rows.reduce((best, r) => {
			const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
			const bd = y < best.top ? best.top - y : y > best.bottom ? y - best.bottom : 0;
			return d < bd ? r : best;
		});
		row.glyphs.push(g);
	}
	return rows.map(r => r.glyphs);
}

/** Several rows as one aligned block, lined up at their first = when they have one. */
function joinLines(parts: Parsed[]): Parsed {
	const useful = parts.filter(p => p.latex);
	if (useful.length < 2) return useful[0] ?? { latex: "", tokens: [] };
	const relation = /^(.*?)(=|\\leq|\\geq|\\neq|\\approx|<|>|\\Rightarrow|\\Leftrightarrow)(.*)$/;
	const aligned = useful.every(p => relation.test(p.latex));
	const rows = useful.map(p => aligned ? p.latex.replace(relation, "$1&$2$3") : p.latex);
	return {
		latex: `\\begin{aligned}${rows.join("\\\\")}\\end{aligned}`,
		tokens: useful.flatMap(p => p.tokens)
	};
}

/** How the strokes were cut and read, for dev-harness/formula-bench.mjs --debug. */
/** One symbol as cut from the ink, for readers other than the formula one (ink-text.ts). */
export interface InkGlyph {
	box: Box;
	ranked: { value: string; p: number }[];
	dot: boolean;
	strokes: InkMathStroke[];
}

/**
 * The first stage alone: strokes cut into symbols, each with its readings, and
 * the size of the handwriting. Prose uses the same cut as maths — a letter is
 * written in one go just as a digit is.
 */
export function segmentInk(strokes: InkMathStroke[]): { scale: number; glyphs: InkGlyph[] } {
	const clean = strokes
		.map(stroke => ({ ...stroke, points: stroke.points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) }))
		.filter(stroke => stroke.points.length > 0);
	if (!clean.length) return { scale: 0, glyphs: [] };
	const sizes = clean.map(s => { const b = boxOf(s.points); return Math.max(b.w, b.h); });
	const big = Math.max(...sizes);
	const scale = Math.max(4, median(sizes.filter(s => s > big * 0.18)) || big);
	return {
		scale,
		glyphs: segment(clean, scale).map(g => ({ box: g.box, ranked: g.ranked, dot: !!g.dot, strokes: g.strokes }))
	};
}

/** Reads a set of strokes as one symbol, whatever the segmentation made of them. */
export function readInkGroup(strokes: InkMathStroke[], scale: number): InkGlyph {
	const g = readGroup(strokes, strokes.map((_, i) => i), scale);
	return { box: g.box, ranked: g.ranked, dot: !!g.dot, strokes: g.strokes };
}

export function inspectInkFormula(strokes: InkMathStroke[]): { scale: number; glyphs: { ids: number[]; value: string; top: string; junk: number; box: Box }[] } {
	const clean = strokes.filter(s => s.points.length);
	const sizes = clean.map(s => { const b = boxOf(s.points); return Math.max(b.w, b.h); });
	const big = Math.max(...sizes);
	const scale = Math.max(4, median(sizes.filter(s => s > big * 0.18)) || big);
	return {
		scale,
		glyphs: segment(clean, scale).map(g => ({
			ids: g.ids, value: g.value, junk: Math.round(g.junk * 100) / 100, box: g.box,
			top: g.ranked.slice(0, 4).map(r => `${r.value}:${r.p.toFixed(2)}`).join(" ")
		}))
	};
}

// ---------------------------------------------------------------------------
// Choosing between readings from different recognisers
// ---------------------------------------------------------------------------

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
