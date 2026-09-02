import { jsPDF } from "jspdf";
import { OneNoteDocument, Shape, Stroke } from "./types";

export interface SceneBounds { x: number; y: number; w: number; h: number; }

const A4_SCENE_W = 794;
const A4_SCENE_H = 1123;
const A4_W_MM = 210;
const A4_H_MM = 297;
const SCENE_TO_MM = A4_W_MM / A4_SCENE_W;

interface Rgb { r: number; g: number; b: number; }

function rgb(color: string, fallback: Rgb = { r: 15, g: 23, b: 42 }): Rgb {
	const hex = /^#([0-9a-f]{6})$/i.exec(color);
	if (hex) return {
		r: parseInt(hex[1].slice(0, 2), 16),
		g: parseInt(hex[1].slice(2, 4), 16),
		b: parseInt(hex[1].slice(4, 6), 16)
	};
	const rgba = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
	return rgba ? { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) } : fallback;
}

function blend(foreground: string, alpha: number, background: Rgb = { r: 255, g: 255, b: 255 }): Rgb {
	const fg = rgb(foreground);
	const t = Math.min(Math.max(alpha, 0), 1);
	return {
		r: Math.round(fg.r * t + background.r * (1 - t)),
		g: Math.round(fg.g * t + background.g * (1 - t)),
		b: Math.round(fg.b * t + background.b * (1 - t))
	};
}

function expand(bounds: SceneBounds, x: number, y: number, w = 0, h = 0): void {
	if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.w) || !Number.isFinite(bounds.h)) {
		bounds.x = Math.min(x, x + w);
		bounds.y = Math.min(y, y + h);
		bounds.w = Math.abs(w);
		bounds.h = Math.abs(h);
		return;
	}
	const minX = Math.min(bounds.x, x, x + w);
	const minY = Math.min(bounds.y, y, y + h);
	const maxX = Math.max(bounds.x + bounds.w, x, x + w);
	const maxY = Math.max(bounds.y + bounds.h, y, y + h);
	bounds.x = minX;
	bounds.y = minY;
	bounds.w = maxX - minX;
	bounds.h = maxY - minY;
}

/** Bounds all rendered canvas content, with the current viewport as an empty-canvas fallback. */
export function getCanvasContentBounds(doc: OneNoteDocument, fallback: SceneBounds): SceneBounds {
	const bounds: SceneBounds = { x: Infinity, y: Infinity, w: -Infinity, h: -Infinity };
	for (const stroke of doc.strokes) {
		for (const point of stroke.points) expand(bounds, point.x, point.y);
	}
	for (const shape of doc.shapes) expand(bounds, shape.x, shape.y, shape.w, shape.h);
	for (const text of doc.texts) expand(bounds, text.x, text.y, text.w ?? 240, text.h ?? text.fontSize * 1.5);
	for (const table of doc.tables) expand(bounds, table.x, table.y, table.w, table.h);
	for (const embed of doc.embeds) expand(bounds, embed.x, embed.y, embed.w, embed.h);
	for (const badge of doc.badges) expand(bounds, badge.x, badge.y, 140, 32);
	if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.w) || !Number.isFinite(bounds.h)) {
		return { ...fallback };
	}
	// A dot or a perfectly horizontal/vertical stroke still deserves its own page.
	const minimumExtent = 8;
	if (bounds.w < minimumExtent) {
		bounds.x -= (minimumExtent - bounds.w) / 2;
		bounds.w = minimumExtent;
	}
	if (bounds.h < minimumExtent) {
		bounds.y -= (minimumExtent - bounds.h) / 2;
		bounds.h = minimumExtent;
	}
	return bounds;
}

function intersects(a: SceneBounds, b: SceneBounds): boolean {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function strokeBounds(stroke: Stroke): SceneBounds | null {
	if (stroke.points.length === 0) return null;
	let minX = stroke.points[0].x;
	let minY = stroke.points[0].y;
	let maxX = minX;
	let maxY = minY;
	for (const point of stroke.points) {
		minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function pagePoint(page: SceneBounds, x: number, y: number): [number, number] {
	return [(x - page.x) * SCENE_TO_MM, (y - page.y) * SCENE_TO_MM];
}

function drawPaper(pdf: jsPDF, doc: OneNoteDocument): void {
	pdf.setFillColor(255, 255, 255);
	pdf.rect(0, 0, A4_W_MM, A4_H_MM, "F");
	if (doc.background === "lines" || doc.background === "margin") {
		pdf.setDrawColor(220, 225, 232);
		pdf.setLineWidth(0.12);
		for (let y = 26 * SCENE_TO_MM; y < A4_H_MM; y += 26 * SCENE_TO_MM) pdf.line(0, y, A4_W_MM, y);
	}
	if (doc.marginEnabled || doc.background === "margin") {
		pdf.setDrawColor(214, 51, 108);
		pdf.setLineWidth(0.36);
		pdf.line(72 * SCENE_TO_MM, 0, 72 * SCENE_TO_MM, A4_H_MM);
	}
}

function colorAlpha(color: string): number {
	const m = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/i.exec(color);
	const alpha = m ? parseFloat(m[1]) : 1;
	return Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1;
}

function drawStroke(pdf: jsPDF, page: SceneBounds, stroke: Stroke): void {
	const bound = strokeBounds(stroke);
	if (!bound || !intersects(bound, page) || stroke.points.length < 2) return;
	const c = rgb(stroke.color, { r: 31, g: 41, b: 55 });
	pdf.setDrawColor(c.r, c.g, c.b);
	pdf.setLineWidth(Math.max(0.2, stroke.width * SCENE_TO_MM));
	// Highlighter and translucent ink keep their opacity on paper too.
	const alpha = colorAlpha(stroke.color);
	if (alpha < 1) pdf.setGState(pdf.GState({ opacity: alpha, "stroke-opacity": alpha }));
	pdf.setLineCap(stroke.type === "highlighter" ? "butt" : "round");
	pdf.setLineJoin("round");
	for (let i = 1; i < stroke.points.length; i++) {
		const previous = stroke.points[i - 1];
		const point = stroke.points[i];
		const [x1, y1] = pagePoint(page, previous.x, previous.y);
		const [x2, y2] = pagePoint(page, point.x, point.y);
		pdf.line(x1, y1, x2, y2);
	}
	if (alpha < 1) pdf.setGState(pdf.GState({ opacity: 1, "stroke-opacity": 1 }));
}

function drawShape(pdf: jsPDF, page: SceneBounds, shape: Shape): void {
	const scene = { x: Math.min(shape.x, shape.x + shape.w), y: Math.min(shape.y, shape.y + shape.h), w: Math.abs(shape.w), h: Math.abs(shape.h) };
	if (!intersects(scene, page)) return;
	const [x, y] = pagePoint(page, shape.x, shape.y);
	const w = shape.w * SCENE_TO_MM;
	const h = shape.h * SCENE_TO_MM;
	const outline = rgb(shape.color);
	pdf.setDrawColor(outline.r, outline.g, outline.b);
	pdf.setLineWidth(Math.max(0.2, shape.width * SCENE_TO_MM));
	const fill = shape.fill && shape.kind !== "line" && shape.kind !== "arrow" && (shape.fillOpacity ?? 0) > 0
		? blend(shape.fill, shape.fillOpacity ?? 0)
		: null;
	if (fill) pdf.setFillColor(fill.r, fill.g, fill.b);
	const style = fill ? "FD" : "S";
	if (shape.kind === "rectangle") pdf.rect(x, y, w, h, style);
	else if (shape.kind === "rounded-rectangle" || shape.kind === "callout") {
		pdf.roundedRect(x, y, w, h, Math.min(5, Math.abs(w) / 5), Math.min(5, Math.abs(h) / 5), style);
		if (shape.kind === "callout") {
			pdf.line(x + w * 0.28, y + h, x + w * 0.36, y + h + 4);
			pdf.line(x + w * 0.36, y + h + 4, x + w * 0.44, y + h);
		}
	} else if (shape.kind === "ellipse") pdf.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), style);
	else if (shape.kind === "triangle") pdf.triangle(x + w / 2, y, x + w, y + h, x, y + h, style);
	else if (shape.kind === "diamond") {
		(pdf as any).lines([[w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2], [w / 2, -h / 2]], x + w / 2, y, [1, 1], style, true);
	} else {
		pdf.line(x, y, x + w, y + h);
		if (shape.kind === "arrow") {
			const angle = Math.atan2(h, w);
			const head = 4.5;
			pdf.line(x + w, y + h, x + w - head * Math.cos(angle - Math.PI / 6), y + h - head * Math.sin(angle - Math.PI / 6));
			pdf.line(x + w, y + h, x + w - head * Math.cos(angle + Math.PI / 6), y + h - head * Math.sin(angle + Math.PI / 6));
		}
	}
}

function drawText(pdf: jsPDF, page: SceneBounds, doc: OneNoteDocument): void {
	for (const text of doc.texts) {
		const box = { x: text.x, y: text.y, w: text.w ?? 260, h: text.h ?? text.fontSize * 1.5 };
		if (!intersects(box, page) || !text.text.trim()) continue;
		const [x, y] = pagePoint(page, text.x, text.y);
		const color = rgb(text.color, { r: 17, g: 24, b: 39 });
		if (text.stickyColor) {
			const sticky = rgb(text.stickyColor, { r: 255, g: 242, b: 168 });
			pdf.setFillColor(sticky.r, sticky.g, sticky.b);
			pdf.roundedRect(x, y, box.w * SCENE_TO_MM, box.h * SCENE_TO_MM, 1.5, 1.5, "F");
		}
		const family = text.fontFamily === "mono" || text.variant === "code" ? "courier" : text.fontFamily === "serif" ? "times" : "helvetica";
		const style = text.bold ? (text.italic ? "bolditalic" : "bold") : text.italic ? "italic" : "normal";
		pdf.setFont(family, style);
		pdf.setFontSize(Math.max(7, text.fontSize * 0.75));
		pdf.setTextColor(color.r, color.g, color.b);
		const lines = pdf.splitTextToSize(text.text, Math.max(12, box.w * SCENE_TO_MM - 3));
		pdf.text(lines, x + 1.5, y + text.fontSize * 0.28 + 1.5);
	}
}

function drawTables(pdf: jsPDF, page: SceneBounds, doc: OneNoteDocument): void {
	for (const table of doc.tables) {
		if (!intersects(table, page)) continue;
		const [x, y] = pagePoint(page, table.x, table.y);
		const w = table.w * SCENE_TO_MM;
		const h = table.h * SCENE_TO_MM;
		const cellW = w / table.cols;
		const cellH = h / table.rows;
		pdf.setDrawColor(71, 85, 105);
		pdf.setLineWidth(0.18);
		pdf.rect(x, y, w, h, "S");
		for (let row = 0; row < table.rows; row++) {
			for (let col = 0; col < table.cols; col++) {
				const cx = x + col * cellW;
				const cy = y + row * cellH;
				if (table.header && row === 0) {
					pdf.setFillColor(226, 232, 240);
					pdf.rect(cx, cy, cellW, cellH, "F");
				}
				pdf.rect(cx, cy, cellW, cellH, "S");
				const content = table.cells[row]?.[col] ?? "";
				if (content) {
					pdf.setFont("helvetica", table.header && row === 0 ? "bold" : "normal");
					pdf.setFontSize(8);
					pdf.setTextColor(30, 41, 59);
					pdf.text(pdf.splitTextToSize(content, Math.max(8, cellW - 2)), cx + 1, cy + 3.2);
				}
			}
		}
	}
}

function drawBadgesAndEmbeds(pdf: jsPDF, page: SceneBounds, doc: OneNoteDocument): void {
	for (const badge of doc.badges) {
		const box = { x: badge.x, y: badge.y, w: 140, h: 32 };
		if (!intersects(box, page)) continue;
		const [x, y] = pagePoint(page, badge.x, badge.y);
		pdf.setFillColor(239, 246, 255);
		pdf.setDrawColor(56, 189, 248);
		pdf.roundedRect(x, y, 30, 7, 2, 2, "FD");
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(8);
		pdf.setTextColor(15, 23, 42);
		pdf.text(badge.label, x + 3, y + 4.6);
	}
	for (const embed of doc.embeds) {
		const box = { x: embed.x, y: embed.y, w: embed.w, h: embed.h };
		if (!intersects(box, page)) continue;
		const [x, y] = pagePoint(page, embed.x, embed.y);
		pdf.setDrawColor(148, 163, 184);
		pdf.setFillColor(248, 250, 252);
		pdf.roundedRect(x, y, box.w * SCENE_TO_MM, box.h * SCENE_TO_MM, 1.5, 1.5, "FD");
		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(8);
		pdf.setTextColor(51, 65, 85);
		pdf.text((embed.originalUrl ?? embed.src).split("/").pop() || embed.kind, x + 2, y + 5);
	}
}

/** Generates a print-ready PDF made of A4 pages aligned to the infinite canvas. */
export function createA4Pdf(doc: OneNoteDocument, fallback: SceneBounds): ArrayBuffer {
	const content = getCanvasContentBounds(doc, fallback);
	const startX = Math.floor(content.x / A4_SCENE_W) * A4_SCENE_W;
	const startY = Math.floor(content.y / A4_SCENE_H) * A4_SCENE_H;
	const endX = Math.ceil((content.x + content.w) / A4_SCENE_W) * A4_SCENE_W;
	const endY = Math.ceil((content.y + content.h) / A4_SCENE_H) * A4_SCENE_H;
	const pages: SceneBounds[] = [];
	for (let y = startY; y < endY; y += A4_SCENE_H) {
		for (let x = startX; x < endX; x += A4_SCENE_W) pages.push({ x, y, w: A4_SCENE_W, h: A4_SCENE_H });
	}
	const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
	for (let index = 0; index < pages.length; index++) {
		if (index > 0) pdf.addPage("a4", "portrait");
		const page = pages[index];
		drawPaper(pdf, doc);
		for (const stroke of doc.strokes) if (stroke.type === "highlighter") drawStroke(pdf, page, stroke);
		for (const stroke of doc.strokes) if (stroke.type !== "highlighter") drawStroke(pdf, page, stroke);
		for (const shape of doc.shapes) drawShape(pdf, page, shape);
		drawText(pdf, page, doc);
		drawTables(pdf, page, doc);
		drawBadgesAndEmbeds(pdf, page, doc);
		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(7);
		pdf.setTextColor(100, 116, 139);
		pdf.text(`NoteLens - ${index + 1}/${pages.length}`, A4_W_MM - 29, A4_H_MM - 7);
	}
	return pdf.output("arraybuffer") as ArrayBuffer;
}
