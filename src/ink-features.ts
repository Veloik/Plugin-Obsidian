/**
 * What the symbol classifier sees of a handwritten glyph.
 *
 * The same function runs when the network is trained (dev-harness/train-ink/)
 * and when the plugin reads a formula, so a change here means retraining:
 * FEATURE_VERSION is stored with the weights and checked at load time.
 *
 * The description is the classic one for online handwriting: the ink is
 * normalised into a unit box, resampled at an even step, and every little
 * segment votes for its orientation (four undirected bins) at its position on
 * an 8×8 grid, with both votes shared bilinearly so a stroke that moves a
 * little does not jump from one cell to the next. Undirected orientations make
 * it indifferent to the direction and order of the strokes, which is how people
 * differ most. A coarse map of where strokes start and end, the aspect ratio
 * and the number of strokes complete it.
 */

export interface FeaturePoint { x: number; y: number }

export const FEATURE_VERSION = 1;
const GRID = 8;
const ORIENTATIONS = 4;
const END_GRID = 3;
/** 4×8×8 orientation maps + 8×8 ink + 3×3 ends + aspect + 4 stroke-count bins + spread. */
export const FEATURE_SIZE = ORIENTATIONS * GRID * GRID + GRID * GRID + END_GRID * END_GRID + 1 + 4 + 2;

function bounds(strokes: FeaturePoint[][]) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const stroke of strokes) for (const p of stroke) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Adds a vote to a GRID×GRID map at (u, v) in 0..1, shared with the neighbours. */
function splat(map: Float32Array, offset: number, u: number, v: number, weight: number): void {
	const gx = Math.min(GRID - 1.0001, Math.max(0, u * GRID - 0.5));
	const gy = Math.min(GRID - 1.0001, Math.max(0, v * GRID - 0.5));
	const x0 = Math.floor(gx), y0 = Math.floor(gy);
	const fx = gx - x0, fy = gy - y0;
	map[offset + y0 * GRID + x0] += weight * (1 - fx) * (1 - fy);
	map[offset + y0 * GRID + x0 + 1] += weight * fx * (1 - fy);
	map[offset + (y0 + 1) * GRID + x0] += weight * (1 - fx) * fy;
	map[offset + (y0 + 1) * GRID + x0 + 1] += weight * fx * fy;
}

/**
 * The feature vector of one glyph. Coordinates can be in any unit and any
 * orientation of y (down is positive, as on screen).
 */
export function glyphFeatures(strokes: FeaturePoint[][]): Float32Array {
	const out = new Float32Array(FEATURE_SIZE);
	const live = strokes.filter(stroke => stroke.length > 0);
	if (!live.length) return out;
	const b = bounds(live);
	const size = Math.max(b.w, b.h, 1e-6);
	// Centre the glyph in a unit box, keeping its proportions: a "-" stays a
	// thin line across the middle and a "1" a thin line down it.
	const ox = b.x - (size - b.w) / 2;
	const oy = b.y - (size - b.h) / 2;
	const norm = (p: FeaturePoint) => ({ x: (p.x - ox) / size, y: (p.y - oy) / size });

	const orientBase = 0;
	const inkBase = ORIENTATIONS * GRID * GRID;
	const endBase = inkBase + GRID * GRID;
	const step = 1 / 48;
	let totalLength = 0;
	let sx = 0, sy = 0, sxx = 0, syy = 0, count = 0;

	for (const raw of live) {
		const stroke = raw.map(norm);
		// Ends: where the pen went down and came up.
		for (const end of [stroke[0], stroke[stroke.length - 1]]) {
			const ex = Math.min(END_GRID - 1, Math.floor(end.x * END_GRID));
			const ey = Math.min(END_GRID - 1, Math.floor(end.y * END_GRID));
			out[endBase + ey * END_GRID + ex] += 1;
		}
		if (stroke.length === 1) {
			splat(out, inkBase, stroke[0].x, stroke[0].y, 0.05);
			totalLength += 0.05;
			continue;
		}
		for (let i = 1; i < stroke.length; i++) {
			const a = stroke[i - 1], c = stroke[i];
			const dx = c.x - a.x, dy = c.y - a.y;
			const length = Math.hypot(dx, dy);
			if (length < 1e-9) continue;
			totalLength += length;
			// Orientation in [0, π): undirected.
			let angle = Math.atan2(dy, dx);
			if (angle < 0) angle += Math.PI;
			if (angle >= Math.PI) angle -= Math.PI;
			const bin = angle / (Math.PI / ORIENTATIONS);
			const b0 = Math.floor(bin) % ORIENTATIONS;
			const b1 = (b0 + 1) % ORIENTATIONS;
			const f = bin - Math.floor(bin);
			// Long segments are cut into pieces so their votes land along them.
			const pieces = Math.max(1, Math.ceil(length / step));
			const w = length / pieces;
			for (let k = 0; k < pieces; k++) {
				const t = (k + 0.5) / pieces;
				const u = a.x + dx * t, v = a.y + dy * t;
				splat(out, orientBase + b0 * GRID * GRID, u, v, w * (1 - f));
				splat(out, orientBase + b1 * GRID * GRID, u, v, w * f);
				splat(out, inkBase, u, v, w);
				sx += u * w; sy += v * w; sxx += u * u * w; syy += v * v * w; count += w;
			}
		}
	}
	// Scale-free: votes are fractions of all the ink, then square-rooted, which
	// keeps a faint feature from being drowned by the dominant one.
	const inkTotal = Math.max(totalLength, 1e-6);
	for (let i = 0; i < endBase; i++) out[i] = Math.sqrt(out[i] / inkTotal);
	const ends = live.length * 2;
	for (let i = endBase; i < endBase + END_GRID * END_GRID; i++) out[i] = Math.sqrt(out[i] / ends);
	let at = endBase + END_GRID * END_GRID;
	out[at++] = Math.max(-3, Math.min(3, Math.log((b.h + size * 0.02) / (b.w + size * 0.02)))) / 3;
	const strokesBin = Math.min(4, live.length) - 1;
	out[at + strokesBin] = 1;
	at += 4;
	if (count > 0) {
		const mx = sx / count, my = sy / count;
		out[at++] = Math.sqrt(Math.max(0, sxx / count - mx * mx)) * 2;
		out[at++] = Math.sqrt(Math.max(0, syy / count - my * my)) * 2;
	}
	return out;
}
