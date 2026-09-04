import { PenStyle, Shape, Stroke, StrokePoint, ViewTransform } from "./types";

const nibOf = (stroke: Stroke): PenStyle => stroke.type === "highlighter" ? "marker" : (stroke.style ?? "ballpoint");
/** Deterministic pseudo-random in [-0.5, 0.5) so pencil grain never flickers between redraws. */
const grain = (i: number, k: number): number => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v) - 0.5; };

/** Alpha channel of an rgba() color; hex and rgb() count as opaque. */
function colorAlpha(color: string): number {
	const m = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/i.exec(color);
	if (!m) return 1;
	const alpha = parseFloat(m[1]);
	return Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1;
}

/** Same color with the alpha channel removed. */
function opaqueColor(color: string): string {
	const m = /rgba?\(([^)]+)\)/i.exec(color);
	if (!m) return color;
	const [r, g, b] = m[1].split(",").map(s => s.trim());
	return `rgb(${r}, ${g}, ${b})`;
}

/**
 * A felt tip is cut flat, so the two ends of a stroke come out slanted at the
 * angle the pen is held. Everything between them is one even band: a real
 * highlighter does not get thinner because you moved sideways.
 */
const HIGHLIGHTER_NIB = -Math.PI * 0.36;

/** Points too close together to change the shape of a fat nib are dropped before inking. */
function simplifyPath(pts: StrokePoint[], tolerance: number): StrokePoint[] {
	if (pts.length < 3) return pts;
	const out: StrokePoint[] = [pts[0]];
	for (let i = 1; i < pts.length - 1; i++) {
		const last = out[out.length - 1];
		if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) >= tolerance) out.push(pts[i]);
	}
	out.push(pts[pts.length - 1]);
	return out;
}

/** One pass of Chaikin: takes the corners off a shaky centreline before it is inked. */
function smoothCenterline(pts: StrokePoint[]): StrokePoint[] {
	if (pts.length < 3) return pts;
	const out: StrokePoint[] = [pts[0]];
	for (let i = 0; i < pts.length - 1; i++) {
		const a = pts[i], b = pts[i + 1];
		out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, p: a.p });
		out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, p: b.p });
	}
	out.push(pts[pts.length - 1]);
	return out;
}

/**
 * Adds a piece of the band, always wound the same way round. The band is filled
 * in one go with the nonzero rule, and a piece turned the other way would punch
 * a hole in the stroke wherever two of them overlap.
 */
function addPolygon(path: Path2D, corners: [number, number][]): void {
	let area = 0;
	for (let i = 0; i < corners.length; i++) {
		const a = corners[i], b = corners[(i + 1) % corners.length];
		area += a[0] * b[1] - b[0] * a[1];
	}
	const ring = area > 0 ? corners.slice().reverse() : corners;
	path.moveTo(ring[0][0], ring[0][1]);
	for (let i = 1; i < ring.length; i++) path.lineTo(ring[i][0], ring[i][1]);
	path.closePath();
}

/**
 * How far the two corners of an end slide apart so that the edge between them
 * lies along the nib. Clamped, or a stroke drawn straight down the nib would
 * end in a long spike instead of a flat tip.
 */
function capSlide(dx: number, dy: number, nx: number, ny: number, half: number): number {
	const ux = Math.cos(HIGHLIGHTER_NIB), uy = Math.sin(HIGHLIGHTER_NIB);
	const along = dx * uy - dy * ux;
	if (Math.abs(along) < 1e-3) return 0;
	return Math.max(-half * 1.2, Math.min(half * 1.2, -(nx * uy - ny * ux) / along));
}

/**
 * The band a highlighter leaves: even width the whole way, round where it turns
 * so corners never notch, and slanted at both ends the way a flat tip prints.
 */
function bandPath(pts: StrokePoint[], width: number): Path2D {
	const half = width / 2;
	const path = new Path2D();
	if (pts.length === 1) {
		// A single dab: the tip set down and lifted without moving.
		const ux = Math.cos(HIGHLIGHTER_NIB) * half, uy = Math.sin(HIGHLIGHTER_NIB) * half;
		const vx = -uy * 0.3, vy = ux * 0.3;
		const { x, y } = pts[0];
		addPolygon(path, [[x + ux + vx, y + uy + vy], [x - ux + vx, y - uy + vy], [x - ux - vx, y - uy - vy], [x + ux - vx, y + uy - vy]]);
		return path;
	}
	for (let i = 0; i < pts.length - 1; i++) {
		const p = pts[i], q = pts[i + 1];
		const dx = q.x - p.x, dy = q.y - p.y;
		const len = Math.hypot(dx, dy);
		if (len < 1e-4) continue;
		const ex = dx / len, ey = dy / len;
		const nx = -ey * half, ny = ex * half;
		const head = i === 0 ? capSlide(ex, ey, nx, ny, half) : 0;
		const tail = i === pts.length - 2 ? capSlide(ex, ey, nx, ny, half) : 0;
		addPolygon(path, [
			[p.x + nx + ex * head, p.y + ny + ey * head],
			[q.x + nx + ex * tail, q.y + ny + ey * tail],
			[q.x - nx - ex * tail, q.y - ny - ey * tail],
			[p.x - nx - ex * head, p.y - ny - ey * head]
		]);
		// A disc at the joint: without it every turn shows a notch on its outside.
		if (i > 0) path.arc(p.x, p.y, half, 0, Math.PI * 2, true);
	}
	return path;
}

/**
 * DPR-aware stroke renderer. The canvas always matches the viewport size
 * (× devicePixelRatio) and the view transform is applied via ctx.setTransform,
 * so ink stays vector-crisp at any zoom level — no CSS upscaling blur.
 */
export class CanvasRenderer {
	readonly canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private dpr = 1;
	/** Snapshot of every finished stroke, used while a whole-path stroke is drawn live. */
	private liveBase: HTMLCanvasElement | null = null;
	/** Marker bands, kept per stroke so panning never rebuilds them. */
	private markerBands = new WeakMap<Stroke, { count: number; width: number; band: Path2D }>();

	constructor(parent: HTMLElement) {
		this.canvas = parent.createEl("canvas", { cls: "onenote-canvas" });
		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("NoteLens: Canvas 2D context unavailable");
		this.ctx = ctx;
	}

	resize(viewportW: number, viewportH: number): void {
		// Hidden panes and keyboard transitions can briefly report zero. Keep the
		// last usable bitmap until layout settles instead of discarding the ink.
		if (!Number.isFinite(viewportW) || !Number.isFinite(viewportH) || viewportW <= 0 || viewportH <= 0) return;
		// Bound both dimensions and total memory (including the live snapshot).
		this.dpr = Math.min(window.devicePixelRatio || 1, 4096 / viewportW, 4096 / viewportH, Math.sqrt(8_000_000 / (viewportW * viewportH)));
		const width = Math.max(1, Math.floor(viewportW * this.dpr));
		const height = Math.max(1, Math.floor(viewportH * this.dpr));
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.liveBase = null;
			if (this.canvas.width !== width) this.canvas.width = width;
			if (this.canvas.height !== height) this.canvas.height = height;
		}
		this.canvas.style.width = `${viewportW}px`;
		this.canvas.style.height = `${viewportH}px`;
	}

	private applyViewTransform(vt: ViewTransform): void {
		this.ctx.setTransform(this.dpr * vt.scale, 0, 0, this.dpr * vt.scale, this.dpr * vt.x, this.dpr * vt.y);
	}

	private clearDevice(): void {
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
	}

	renderAll(strokes: Stroke[], shapes: Shape[], vt: ViewTransform): void {
		this.liveBase = null;
		this.clearDevice();
		this.applyViewTransform(vt);
		for (const shape of shapes) this.drawShape(shape);
		for (const stroke of strokes) if (stroke.type === "highlighter") this.drawStroke(stroke);
		for (const stroke of strokes) if (stroke.type !== "highlighter") this.drawStroke(stroke);
	}

	drawStroke(stroke: Stroke): void {
		const pts = stroke.points;
		if (stroke.type === "highlighter") {
			this.drawHighlighter(stroke);
			return;
		}
		if (pts.length === 1) {
			this.drawDot(stroke, pts[0]);
			return;
		}
		if (pts.length < 2) return;
		if (this.usesWholePath(stroke)) {
			this.drawWholeStroke(stroke);
			return;
		}
		for (let i = 0; i < pts.length - 1; i++) {
			this.drawSegment(stroke, pts, i);
		}
	}

	/**
	 * Translucent ink is composited once as a single path. Stroking it segment
	 * by segment doubles the alpha wherever neighbouring segments overlap, so
	 * the ink looked blotchy and almost opaque no matter the opacity chosen.
	 * Width follows the average pressure of the whole stroke. The highlighter
	 * answers true as well: it has its own ribbon, but it is drawn the same way
	 * — all at once, never live segment by segment.
	 */
	private usesWholePath(stroke: Stroke): boolean {
		return stroke.type === "highlighter" || colorAlpha(stroke.color) < 1 || nibOf(stroke) === "pencil";
	}

	/**
	 * Highlighter ink: one even band, laid down in a single pass at the chosen
	 * opacity so the stroke never darkens against itself, and multiplied so two
	 * strokes that cross deepen instead of washing each other out.
	 */
	private drawHighlighter(stroke: Stroke): void {
		if (!stroke.points.length) return;
		this.ctx.save();
		this.ctx.globalCompositeOperation = "multiply";
		this.ctx.globalAlpha = colorAlpha(stroke.color);
		this.ctx.fillStyle = opaqueColor(stroke.color);
		this.ctx.fill(this.markerBand(stroke));
		this.ctx.restore();
	}

	/**
	 * The band of a marker stroke, in board coordinates. It only depends on the
	 * points and the width, so it is built once and reused on every pan, zoom and
	 * redraw.
	 */
	private markerBand(stroke: Stroke): Path2D {
		const cached = this.markerBands.get(stroke);
		if (cached && cached.count === stroke.points.length && cached.width === stroke.width) return cached.band;
		const width = Math.max(2, stroke.width);
		const band = bandPath(smoothCenterline(simplifyPath(stroke.points, Math.max(1.5, width * 0.25))), width);
		this.markerBands.set(stroke, { count: stroke.points.length, width: stroke.width, band });
		return band;
	}

	private drawWholeStroke(stroke: Stroke): void {
		if (nibOf(stroke) === "pencil" && stroke.type !== "highlighter") {
			this.drawPencil(stroke);
			return;
		}
		const pts = stroke.points;
		let pressure = 0;
		for (const p of pts) pressure += p.p;
		pressure /= pts.length;

		this.ctx.save();
		this.configureStyle(stroke, this.nibWidth(stroke, pressure, pts, -1));
		this.ctx.globalAlpha = colorAlpha(stroke.color);
		this.ctx.strokeStyle = opaqueColor(stroke.color);
		this.tracePath(pts, 0, 0, 0);
		this.ctx.stroke();
		this.ctx.restore();
	}

	/**
	 * Graphite look: three translucent passes of slightly different width,
	 * each nudged sideways by a deterministic grain, so the line reads as
	 * soft pencil instead of flat ink. Never flickers: the grain is a pure
	 * function of the point index.
	 */
	private drawPencil(stroke: Stroke): void {
		const pts = stroke.points;
		const alpha = colorAlpha(stroke.color);
		const color = opaqueColor(stroke.color);
		let pressure = 0;
		for (const p of pts) pressure += p.p;
		pressure /= pts.length;
		const w = stroke.width * (0.55 + 0.6 * pressure);
		const passes: [number, number, number, number][] = [
			[0.85, 0.5, 0, 0],
			[0.45, 0.42, 0.32, 1],
			[0.3, 0.36, -0.28, 2]
		];
		this.ctx.save();
		this.ctx.lineJoin = "round";
		this.ctx.lineCap = "round";
		this.ctx.strokeStyle = color;
		for (const [widthFactor, alphaFactor, offset, seed] of passes) {
			this.ctx.globalAlpha = alpha * alphaFactor;
			this.ctx.lineWidth = Math.max(0.6, w * widthFactor);
			this.tracePath(pts, offset * w, w * 0.35, seed);
			this.ctx.stroke();
		}
		this.ctx.restore();
	}

	/** Smoothed path through the points, optionally offset sideways and grained. */
	private tracePath(pts: StrokePoint[], offset: number, jitter: number, seed: number): void {
		const at = (i: number) => {
			const p = pts[i];
			if (!offset && !jitter) return p;
			const prev = pts[Math.max(0, i - 1)];
			const next = pts[Math.min(pts.length - 1, i + 1)];
			const dx = next.x - prev.x, dy = next.y - prev.y;
			const len = Math.hypot(dx, dy) || 1;
			const nx = -dy / len, ny = dx / len;
			const shift = offset + jitter * grain(i, seed);
			return { x: p.x + nx * shift + jitter * 0.5 * grain(i, seed + 7), y: p.y + ny * shift, p: p.p };
		};
		this.ctx.beginPath();
		let cur = at(0);
		this.ctx.moveTo(cur.x, cur.y);
		for (let i = 0; i < pts.length - 1; i++) {
			const nxt = at(i + 1);
			this.ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + nxt.x) / 2, (cur.y + nxt.y) / 2);
			cur = nxt;
		}
		this.ctx.lineTo(cur.x, cur.y);
	}

	/**
	 * Incremental live inking only works for opaque pen ink. Whole-path strokes
	 * must be redrawn entirely on every move so their segments never stack.
	 */
	supportsIncrementalInk(stroke: Stroke): boolean {
		return !this.usesWholePath(stroke);
	}

	/**
	 * Live drawing for whole-path strokes: the first call snapshots the canvas
	 * (everything but the stroke in progress); later calls restore that
	 * snapshot and draw the current stroke on top. This keeps a translucent
	 * highlighter smooth without re-rendering the whole document per move.
	 */
	drawLiveWholeStroke(stroke: Stroke, vt: ViewTransform): void {
		if (!this.liveBase || this.liveBase.width !== this.canvas.width || this.liveBase.height !== this.canvas.height) {
			const base = createEl("canvas");
			base.width = this.canvas.width;
			base.height = this.canvas.height;
			base.getContext("2d")?.drawImage(this.canvas, 0, 0);
			this.liveBase = base;
		}
		this.clearDevice();
		this.ctx.drawImage(this.liveBase, 0, 0);
		this.applyViewTransform(vt);
		this.drawStroke(stroke);
	}

	/** Drops the live snapshot once the stroke in progress is finished or cancelled. */
	endLive(): void {
		this.liveBase = null;
	}

	private drawShape(shape: Shape): void {
		const { x, y, w, h } = shape;
		this.ctx.save();
		if (shape.rotation) {
			const cx = x + w / 2, cy = y + h / 2;
			this.ctx.translate(cx, cy);
			this.ctx.rotate(shape.rotation * Math.PI / 180);
			this.ctx.translate(-cx, -cy);
		}
		this.ctx.globalCompositeOperation = "source-over";
		this.ctx.strokeStyle = shape.color;
		this.ctx.lineWidth = shape.width;
		this.ctx.lineCap = "round";
		this.ctx.lineJoin = "round";
		this.ctx.beginPath();

		if (shape.kind === "rectangle") {
			this.ctx.rect(x, y, w, h);
		} else if (shape.kind === "rounded-rectangle") {
			this.roundRect(x, y, w, h, Math.min(18, Math.abs(w) / 5, Math.abs(h) / 5));
		} else if (shape.kind === "ellipse") {
			this.ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
		} else if (shape.kind === "diamond") {
			this.ctx.moveTo(x + w / 2, y);
			this.ctx.lineTo(x + w, y + h / 2);
			this.ctx.lineTo(x + w / 2, y + h);
			this.ctx.lineTo(x, y + h / 2);
			this.ctx.closePath();
		} else if (shape.kind === "triangle") {
			this.ctx.moveTo(x + w / 2, y);
			this.ctx.lineTo(x + w, y + h);
			this.ctx.lineTo(x, y + h);
			this.ctx.closePath();
		} else if (shape.kind === "callout") {
			const radius = Math.min(18, Math.abs(w) / 5, Math.abs(h) / 5);
			this.roundRect(x, y, w, h, radius);
			const tailX = x + w * 0.28;
			const tailY = y + h;
			this.ctx.moveTo(tailX, tailY);
			this.ctx.lineTo(tailX + Math.sign(w || 1) * 18, tailY + Math.sign(h || 1) * 16);
			this.ctx.lineTo(tailX + Math.sign(w || 1) * 36, tailY);
		} else {
			this.ctx.moveTo(x, y);
			this.ctx.lineTo(x + w, y + h);
		}
		if (shape.fill && this.isFillable(shape.kind) && (shape.fillOpacity ?? 0) > 0) {
			this.ctx.save();
			this.ctx.globalAlpha = Math.min(Math.max(shape.fillOpacity ?? 0, 0), 1);
			this.ctx.fillStyle = shape.fill;
			this.ctx.fill();
			this.ctx.restore();
		}
		this.ctx.stroke();

		if (shape.kind === "arrow") {
			const endX = x + w;
			const endY = y + h;
			const angle = Math.atan2(h, w);
			const head = Math.max(10, Math.min(22, 7 + shape.width * 2));
			this.ctx.beginPath();
			this.ctx.moveTo(endX, endY);
			this.ctx.lineTo(endX - head * Math.cos(angle - Math.PI / 6), endY - head * Math.sin(angle - Math.PI / 6));
			this.ctx.moveTo(endX, endY);
			this.ctx.lineTo(endX - head * Math.cos(angle + Math.PI / 6), endY - head * Math.sin(angle + Math.PI / 6));
			this.ctx.stroke();
		}
		this.ctx.restore();
	}

	private roundRect(x: number, y: number, w: number, h: number, radius: number): void {
		const r = Math.max(0, radius);
		if (typeof this.ctx.roundRect === "function") {
			this.ctx.roundRect(x, y, w, h, r);
			return;
		}
		this.ctx.rect(x, y, w, h);
	}

	private isFillable(kind: Shape["kind"]): boolean {
		return kind !== "line" && kind !== "arrow";
	}

	/** Re-apply the view transform before incremental live-ink drawing. */
	prepareLive(vt: ViewTransform): void {
		this.applyViewTransform(vt);
	}

	/**
	 * Incremental draw for live inking: renders only the newest segments of
	 * the stroke currently being drawn. Call with the full stroke and the
	 * number of points already rendered.
	 */
	drawStrokeFrom(stroke: Stroke, fromIndex: number): void {
		const pts = stroke.points;
		if (pts.length < 2) return;
		const start = Math.max(0, fromIndex - 1);
		for (let i = start; i < pts.length - 1; i++) {
			this.drawSegment(stroke, pts, i);
		}
	}

	private drawDot(stroke: Stroke, p: StrokePoint): void {
		this.ctx.save();
		this.configureStyle(stroke, this.nibWidth(stroke, p.p, [p], 0));
		this.ctx.globalAlpha = colorAlpha(stroke.color);
		this.ctx.beginPath();
		this.ctx.arc(p.x, p.y, this.ctx.lineWidth / 2, 0, Math.PI * 2);
		this.ctx.fillStyle = opaqueColor(stroke.color);
		this.ctx.fill();
		this.ctx.restore();
	}

	/**
	 * Line width for one segment (or the whole stroke when i is -1):
	 * - ballpoint: pressure scales 35%..100%;
	 * - pencil: soft, slightly thinner than the nib;
	 * - fountain: slow strokes swell, fast ones thin out, like a real nib;
	 * - marker: constant width, ignores pressure;
	 * - brush: pressure dominates and the ends taper.
	 */
	private nibWidth(stroke: Stroke, pressure: number, pts: StrokePoint[], i: number): number {
		const w = stroke.width;
		switch (nibOf(stroke)) {
			case "marker":
				return w * 1.5;
			case "pencil":
				return w * (0.55 + 0.6 * pressure);
			case "fountain": {
				// A broad nib held at 45°: strokes drawn along the nib are hairlines,
				// strokes across it are full width. Speed thins the line a little too.
				let angleFactor = 1, speed = 1;
				if (i >= 0 && pts.length > 1) {
					const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
					const dx = b.x - a.x, dy = b.y - a.y;
					const dist = Math.hypot(dx, dy) / 2;
					if (dist > 0.01) {
						const nib = -Math.PI / 4;
						angleFactor = 0.3 + 0.7 * Math.abs(Math.sin(Math.atan2(dy, dx) - nib));
					}
					speed = Math.min(1.15, Math.max(0.6, 1.15 - dist / (w * 8 + 12)));
				}
				return Math.max(0.6, w * (0.6 + 0.8 * pressure) * angleFactor * speed);
			}
			case "brush": {
				// Pressure swells the hair; both ends taper over the first and last points,
				// and quick flicks come out thinner than slow, loaded strokes.
				let taper = 1, speed = 1;
				if (i >= 0 && pts.length > 2) {
					const span = Math.max(3, Math.min(10, Math.round(pts.length * 0.18)));
					const fromEnd = Math.min(i, pts.length - 2 - i);
					taper = Math.min(1, (fromEnd + 1) / span);
					const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
					const dist = Math.hypot(b.x - a.x, b.y - a.y) / 2;
					speed = Math.min(1.25, Math.max(0.55, 1.25 - dist / (w * 6 + 10)));
				}
				return Math.max(0.5, w * (0.25 + 1.7 * pressure) * (0.15 + 0.85 * Math.sqrt(taper)) * speed);
			}
			default:
				return w * (0.35 + 0.65 * pressure);
		}
	}

	private configureStyle(stroke: Stroke, width: number): void {
		this.ctx.lineJoin = "round";
		this.ctx.strokeStyle = stroke.color;
		this.ctx.globalCompositeOperation = "source-over";
		this.ctx.lineCap = "round";
		this.ctx.lineWidth = width;
	}

	/**
	 * One smoothed segment: quadratic curve anchored at the midpoint before
	 * p[i] and ending at the midpoint between p[i] and p[i+1]. Width follows
	 * the average pressure of the segment.
	 */
	private drawSegment(stroke: Stroke, pts: StrokePoint[], i: number): void {
		const p0 = pts[i];
		const p1 = pts[i + 1];
		const prev = i > 0 ? pts[i - 1] : p0;
		const startX = (prev.x + p0.x) / 2;
		const startY = (prev.y + p0.y) / 2;
		const endX = (p0.x + p1.x) / 2;
		const endY = (p0.y + p1.y) / 2;

		this.ctx.save();
		this.configureStyle(stroke, this.nibWidth(stroke, (p0.p + p1.p) / 2, pts, i));
		this.ctx.beginPath();
		this.ctx.moveTo(startX, startY);
		this.ctx.quadraticCurveTo(p0.x, p0.y, endX, endY);
		this.ctx.stroke();
		this.ctx.restore();
	}
}
