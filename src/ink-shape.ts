/**
 * Ink to shape: a hand-drawn line, arrow, circle, triangle, rectangle or
 * diamond read as the clean shape it was meant to be, as OneNote's "Ink to
 * Shape" and the draw-and-hold of note apps do.
 *
 * Only geometry is used, and the reader errs towards saying no: a stroke that
 * fits no shape well — a letter, a doodle — is left as ink. Everything is in
 * board units; the caller decides how big a stroke must be to be considered.
 */
import type { ShapeKind } from "./types";

export interface InkPoint { x: number; y: number }

export interface ShapeGuess {
	kind: ShapeKind;
	x: number;
	y: number;
	w: number;
	h: number;
	/** Degrees around the centre, as Shape.rotation. */
	rotation?: number;
}

const dist = (a: InkPoint, b: InkPoint) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(pts: InkPoint[]): number {
	let length = 0;
	for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);
	return length;
}

/** `n` points evenly spaced along the path, so fast and slow parts weigh the same. */
function resample(pts: InkPoint[], n: number): InkPoint[] {
	const total = pathLength(pts);
	if (!total) return [pts[0]];
	const step = total / (n - 1);
	const out = [pts[0]];
	let carried = 0;
	for (let i = 1; i < pts.length; i++) {
		let a = pts[i - 1];
		const b = pts[i];
		let d = dist(a, b);
		while (carried + d >= step && out.length < n) {
			const t = (step - carried) / d;
			a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
			out.push(a);
			d = dist(a, b);
			carried = 0;
		}
		carried += d;
	}
	while (out.length < n) out.push(pts[pts.length - 1]);
	return out;
}

function segmentDistance(p: InkPoint, a: InkPoint, b: InkPoint): number {
	const dx = b.x - a.x, dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
	return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Douglas–Peucker: the corners that matter at tolerance `eps`. */
function simplify(pts: InkPoint[], eps: number): InkPoint[] {
	if (pts.length < 3) return pts;
	let worst = 0, at = 0;
	for (let i = 1; i < pts.length - 1; i++) {
		const d = segmentDistance(pts[i], pts[0], pts[pts.length - 1]);
		if (d > worst) { worst = d; at = i; }
	}
	if (worst <= eps) return [pts[0], pts[pts.length - 1]];
	return [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)];
}

/** Mean distance from the ink to a closed polygon, relative to the shape's size. */
function polygonFit(pts: InkPoint[], corners: InkPoint[], size: number): number {
	let sum = 0;
	for (const p of pts) {
		let best = Infinity;
		for (let i = 0; i < corners.length; i++) best = Math.min(best, segmentDistance(p, corners[i], corners[(i + 1) % corners.length]));
		sum += best;
	}
	return sum / pts.length / size;
}

const degrees = (rad: number) => rad * 180 / Math.PI;
/** An angle folded into (−45°, 45°]: how far a side leans from the nearest axis. */
function axisLean(a: InkPoint, b: InkPoint): number {
	let angle = degrees(Math.atan2(b.y - a.y, b.x - a.x)) % 90;
	if (angle > 45) angle -= 90;
	if (angle <= -45) angle += 90;
	return angle;
}

export function recognizeShape(points: InkPoint[]): ShapeGuess | null {
	if (points.length < 4) return null;
	const pts = resample(points, 64);
	const length = pathLength(pts);
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
	const w = maxX - minX, h = maxY - minY;
	const size = Math.hypot(w, h);
	if (!size || !length) return null;
	const start = pts[0], end = pts[pts.length - 1];

	// A line: the ink hardly strays from the chord between its ends.
	if (dist(start, end) / length > 0.95) return { kind: "line", x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y };

	// An arrow in one stroke: a straight shaft to the tip, then the head drawn
	// back from it. The tip is the point farthest from where the pen started.
	// The pen passes the tip twice when the head goes back through it, so the
	// first time it gets that far is the one that counts.
	const reach = Math.max(...pts.map(p => dist(p, start)));
	const tipAt = pts.findIndex(p => dist(p, start) >= reach * 0.97);
	const shaft = pts.slice(0, tipAt + 1), head = pts.slice(tipAt);
	if (tipAt > 8 && head.length > 4) {
		const shaftLength = pathLength(shaft), headLength = pathLength(head);
		const tip = pts[tipAt];
		const straightShaft = dist(start, tip) / shaftLength > 0.95;
		const headReach = Math.max(...head.map(p => dist(p, tip)));
		if (straightShaft && headLength > shaftLength * 0.12 && headLength < shaftLength * 0.9 && headReach < dist(start, tip) * 0.45) {
			return { kind: "arrow", x: start.x, y: start.y, w: tip.x - start.x, h: tip.y - start.y };
		}
	}

	// Everything else must be closed: the pen comes back near where it began.
	if (dist(start, end) > Math.max(length * 0.14, size * 0.2)) return null;
	const loop = pts.slice(0, -1);

	// Corners, found on the loop opened at the point farthest from the centre
	// (always a corner if there are any), with a tolerance of a few percent.
	const cx = loop.reduce((s, p) => s + p.x, 0) / loop.length, cy = loop.reduce((s, p) => s + p.y, 0) / loop.length;
	let far = 0;
	loop.forEach((p, i) => { if (dist(p, { x: cx, y: cy }) > dist(loop[far], { x: cx, y: cy })) far = i; });
	const opened = [...loop.slice(far), ...loop.slice(0, far), loop[far]];
	let corners = simplify(opened, size * 0.07).slice(0, -1);
	// Two corners closer than a sixth of the shape are one corner drawn twice.
	corners = corners.filter((c, i) => i === 0 || dist(c, corners[i - 1]) > size * 0.16);
	if (corners.length > 1 && dist(corners[0], corners[corners.length - 1]) < size * 0.16) corners.pop();

	const polygonOk = corners.length >= 3 && corners.length <= 4 && polygonFit(loop, corners, size) < 0.035;

	if (polygonOk && corners.length === 3) {
		// Our triangle stands on its base with the apex centred above it: the
		// apex is the corner farthest from the line through the other two.
		let apex = 0, best = -1;
		for (let i = 0; i < 3; i++) {
			const d = segmentDistance(corners[i], corners[(i + 1) % 3], corners[(i + 2) % 3]);
			if (d > best) { best = d; apex = i; }
		}
		const a = corners[apex], b1 = corners[(apex + 1) % 3], b2 = corners[(apex + 2) % 3];
		const base = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
		const tw = dist(b1, b2), th = best;
		const centre = { x: (a.x + base.x) / 2, y: (a.y + base.y) / 2 };
		// Rotation that turns "apex up" (−y) into the direction base → apex.
		let rotation = degrees(Math.atan2(a.x - base.x, -(a.y - base.y)));
		if (Math.abs(rotation) < 8) rotation = 0;
		return { kind: "triangle", x: centre.x - tw / 2, y: centre.y - th / 2, w: tw, h: th, ...(rotation ? { rotation } : {}) };
	}

	if (polygonOk && corners.length === 4) {
		const leans = corners.map((c, i) => axisLean(c, corners[(i + 1) % 4]));
		const meanLean = leans.reduce((s, v) => s + v, 0) / 4;
		// Sides near 45°: a diamond, its corners at the middles of its box.
		const diagonalSides = leans.every(l => Math.abs(Math.abs(l) - 45) < 18);
		if (diagonalSides) return { kind: "diamond", x: minX, y: minY, w, h };
		const side = (i: number) => dist(corners[i], corners[(i + 1) % 4]);
		if (Math.abs(meanLean) < 10) return { kind: "rectangle", x: minX, y: minY, w, h };
		// A rectangle drawn at an angle keeps its angle.
		const rw = (side(0) + side(2)) / 2, rh = (side(1) + side(3)) / 2;
		const rotation = degrees(Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x));
		return { kind: "rectangle", x: cx - rw / 2, y: cy - rh / 2, w: rw, h: rh, rotation };
	}

	// An ellipse: every point about as far from the centre as the ellipse with
	// the loop's own proportions says it should be. Measured along the loop's
	// principal axes, so a tilted oval is recognised too.
	let sxx = 0, syy = 0, sxy = 0;
	for (const p of loop) { sxx += (p.x - cx) ** 2; syy += (p.y - cy) ** 2; sxy += (p.x - cx) * (p.y - cy); }
	const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
	const cos = Math.cos(theta), sin = Math.sin(theta);
	const along = loop.map(p => ({ u: (p.x - cx) * cos + (p.y - cy) * sin, v: -(p.x - cx) * sin + (p.y - cy) * cos }));
	const a = (Math.max(...along.map(q => q.u)) - Math.min(...along.map(q => q.u))) / 2;
	const b = (Math.max(...along.map(q => q.v)) - Math.min(...along.map(q => q.v))) / 2;
	if (a <= 0 || b <= 0) return null;
	const error = along.reduce((s, q) => s + Math.abs(Math.hypot(q.u / a, q.v / b) - 1), 0) / along.length;
	// A closed loop with corners the polygon test did not accept is not an ellipse either.
	if (error > 0.09 || (corners.length >= 3 && corners.length <= 4 && polygonFit(loop, corners, size) < 0.02)) return null;
	let rotation = degrees(theta);
	// Near-round, or nearly upright: no rotation at all.
	if (Math.min(a, b) / Math.max(a, b) > 0.85 || Math.abs(axisLean({ x: 0, y: 0 }, { x: cos, y: sin })) < 10) {
		return { kind: "ellipse", x: minX, y: minY, w, h };
	}
	if (rotation > 90) rotation -= 180;
	return { kind: "ellipse", x: cx - a, y: cy - b, w: a * 2, h: b * 2, rotation };
}
