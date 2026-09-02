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
	return d1 * d2 <= 0 && d3 * d4 <= 0;
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

	// A dot above a narrow body is i or j, not a separate decimal point.
	const smallA = a.bounds.w < scale * 0.24 && a.bounds.h < scale * 0.24;
	const smallB = b.bounds.w < scale * 0.24 && b.bounds.h < scale * 0.24;
	if ((smallA || smallB) && xOverlap > 0 && Math.abs(centre(a.bounds).x - centre(b.bounds).x) < scale * 0.2) {
		const gap = Math.max(0, Math.max(a.bounds.y, b.bounds.y) - Math.min(a.bounds.bottom, b.bounds.bottom));
		if (gap < scale * 0.42) return true;
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
	const fit = document.createElement("canvas");
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
	const canvas = document.createElement("canvas");
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
		const canvas = document.createElement("canvas");
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
	if (infos.length === 2 && infos.every(info => info.straightness > 0.88) && lineIntersection(infos[0], infos[1])) {
		const angles = infos.map(info => info.angle);
		const axisAligned = angles.some(angle => angle < 20) && angles.some(angle => angle > 70);
		return axisAligned
			? { value: "+", alternatives: ["+", "t", "4"], confidence: 0.96 }
			: { value: "x", alternatives: ["x", "*", "+"], confidence: 0.82 };
	}
	if (infos.length === 1) {
		const info = infos[0];
		const first = info.stroke.points[0], last = info.stroke.points[info.stroke.points.length - 1];
		const points = info.stroke.points;
		if (points.length >= 5 && first && last) {
			const earlyEnd = Math.max(1, points.length - 2);
			let maxXIndex = 0;
			for (let index = 1; index <= earlyEnd; index++) if (points[index].x > points[maxXIndex].x) maxXIndex = index;
			const lowerLeftIndex = points.reduce((best, point, index) => index > maxXIndex && point.x < points[best].x ? index : best, Math.min(points.length - 1, maxXIndex + 1));
			const upperTurn = points[maxXIndex], lowerTurn = points[lowerLeftIndex];
			const looksLikeTwo = maxXIndex < points.length * 0.7
				&& lowerLeftIndex > maxXIndex
				&& upperTurn.y < b.y + b.h * 0.58
				&& lowerTurn.y > b.y + b.h * 0.48
				&& last.x > b.x + b.w * 0.68
				&& last.y > b.y + b.h * 0.68;
			if (looksLikeTwo) return { value: "2", alternatives: ["2", "z", "sqrt"], confidence: 0.82 };
		}
		if (first && last && pointDistance(first, last) < Math.max(6, info.length * 0.13) && info.length > (b.w + b.h) * 1.35) {
			return { value: "0", alternatives: ["0", "o", "6", "9"], confidence: 0.72 };
		}
	}
	return null;
}

function classifyGlyph(group: GlyphGroup): GlyphResult {
	const hard = hardGeometry(group);
	if (hard && hard.confidence >= 0.8) return { ...hard, bounds: group.bounds };
	const input = maskForStrokes(group.strokes);
	const scores = new Map<string, number>();
	for (const candidate of GLYPHS) {
		const score = Math.min(...templateMasks(candidate.glyph).map(mask => maskDistance(input, mask)));
		const previous = scores.get(candidate.value);
		if (previous === undefined || score < previous) scores.set(candidate.value, score);
	}
	if (hard) scores.set(hard.value, Math.min(scores.get(hard.value) ?? Infinity, 0.045 + (1 - hard.confidence) * 0.18));
	const ranked = [...scores.entries()].sort((a, b) => a[1] - b[1]);
	const best = ranked[0] ?? ["?", 1] as [string, number];
	const second = ranked[1]?.[1] ?? best[1] + 0.2;
	const confidence = clamp01(0.28 + (second - best[1]) * 2.8 + (0.24 - best[1]) * 1.6);
	return { value: best[0], alternatives: ranked.slice(0, 5).map(entry => entry[0]), confidence, bounds: group.bounds };
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
		source: useful.map(part => part.source).join(" ").replace(/\s+([,.)\]])/g, "$1").replace(/([(\[])\s+/g, "$1"),
		tokens: useful.flatMap(part => part.tokens),
		confidence: useful.reduce((sum, part) => sum + part.confidence, 0) / useful.length,
		structured: useful.some(part => part.structured)
	};
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
	return serializeGlyphs(groupGlyphs(strokes).map(classifyGlyph));
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
	const valid = value.match(/[A-Za-z0-9+\-=/*^_().,<>\[\]{}|!\\]/g)?.length ?? 0;
	score += valid / value.length * 12;
	score += (value.match(/[=+\-/*^_]|\\(?:frac|sqrt|sum|int)/g) ?? []).length * 1.7;
	if (/\\frac\{[^{}]+\}\{[^{}]+\}/.test(value)) score += 7;
	if (/\^(?:\([^()]+\)|\{[^{}]+\}|[0-9])/.test(value)) score += 3;
	if (/[?]{2,}|[_^]\s*$|[+\-=/*]{3,}/.test(value)) score -= 8;
	if (/\b[A-Za-z]{7,}\b/.test(value)) score -= 3;
	const opens = (value.match(/[({\[]/g) ?? []).length;
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
