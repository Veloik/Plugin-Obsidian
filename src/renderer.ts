import { Shape, Stroke, StrokePoint, ViewTransform } from "./types";

/** Alpha channel of an rgba() color; hex and rgb() count as opaque. */
function colorAlpha(color: string): number {
	const m = /rgba(s*[d.]+s*,s*[d.]+s*,s*[d.]+s*,s*([d.]+)s*)/i.exec(color);
	if (!m) return 1;
	const alpha = parseFloat(m[1]);
	return Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1;
}

/** Same color with the alpha channel removed. */
function opaqueColor(color: string): string {
	const m = /rgba?(([^)]+))/i.exec(color);
	if (!m) return color;
	const [r, g, b] = m[1].split(",").map(s => s.trim());
	return `rgb(${r}, ${g}, ${b})`;
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

	constructor(parent: HTMLElement) {
		this.canvas = parent.createEl("canvas", { cls: "onenote-canvas" });
		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("NoteLens: Canvas 2D context unavailable");
		this.ctx = ctx;
	}

	resize(viewportW: number, viewportH: number): void {
		this.dpr = window.devicePixelRatio || 1;
		this.canvas.width = Math.max(1, Math.round(viewportW * this.dpr));
		this.canvas.height = Math.max(1, Math.round(viewportH * this.dpr));
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
	 * Highlighter ink and any translucent ink are composited once as a single
	 * path. Stroking them segment by segment doubles the alpha wherever
	 * neighbouring segments overlap, so the ink looked blotchy and almost
	 * opaque no matter the opacity chosen. Width follows the average pressure
	 * of the whole stroke (the highlighter ignores pressure altogether).
	 */
	private usesWholePath(stroke: Stroke): boolean {
		return stroke.type === "highlighter" || colorAlpha(stroke.color) < 1;
	}

	private drawWholeStroke(stroke: Stroke): void {
		const pts = stroke.points;
		let pressure = 0;
		for (const p of pts) pressure += p.p;
		pressure /= pts.length;

		this.ctx.save();
		this.configureStyle(stroke, pressure);
		this.ctx.globalAlpha = colorAlpha(stroke.color);
		this.ctx.strokeStyle = opaqueColor(stroke.color);
		this.ctx.beginPath();
		this.ctx.moveTo(pts[0].x, pts[0].y);
		for (let i = 0; i < pts.length - 1; i++) {
			const p0 = pts[i];
			const p1 = pts[i + 1];
			this.ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
		}
		const last = pts[pts.length - 1];
		this.ctx.lineTo(last.x, last.y);
		this.ctx.stroke();
		this.ctx.restore();
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
			const base = document.createElement("canvas");
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
		this.configureStyle(stroke, p.p);
		this.ctx.beginPath();
		this.ctx.arc(p.x, p.y, this.ctx.lineWidth / 2, 0, Math.PI * 2);
		this.ctx.fillStyle = stroke.color;
		this.ctx.fill();
		this.ctx.restore();
	}

	private configureStyle(stroke: Stroke, pressure: number): void {
		this.ctx.lineJoin = "round";
		this.ctx.strokeStyle = stroke.color;
		if (stroke.type === "highlighter") {
			// A real marker: flat ends and constant width. It is painted under
			// the pen ink (see renderAll), so normal blending keeps every ink
			// color readable on light and dark pages alike.
			this.ctx.globalCompositeOperation = "source-over";
			this.ctx.lineCap = "butt";
			this.ctx.lineWidth = stroke.width;
			return;
		}
		this.ctx.globalCompositeOperation = "source-over";
		this.ctx.lineCap = "round";
		// Pressure maps to 35%..100% of the configured width.
		this.ctx.lineWidth = stroke.width * (0.35 + 0.65 * pressure);
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
		this.configureStyle(stroke, (p0.p + p1.p) / 2);
		this.ctx.beginPath();
		this.ctx.moveTo(startX, startY);
		this.ctx.quadraticCurveTo(p0.x, p0.y, endX, endY);
		this.ctx.stroke();
		this.ctx.restore();
	}
}
