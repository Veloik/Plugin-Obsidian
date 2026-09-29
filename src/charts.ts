import { App, Modal, Setting, setIcon } from "obsidian";
import { evaluate } from "./calculator";
import type { CanvasTable, Embed } from "./types";
import { tr } from "./i18n";

/**
 * Charts drawn on the board: data charts (bar, line, area, pie, scatter) from
 * a small text table, and function plots y = f(x) evaluated with the
 * calculator engine. Everything renders locally on a canvas.
 */

export type ChartType = "bar" | "line" | "area" | "pie" | "scatter" | "function";

export interface ChartSpec {
	type: ChartType;
	title?: string;
	/** One row per line: "etiqueta; valor; valor…". A first line starting with # names the series. */
	data: string;
	/** Function plots: one expression in x per line, e.g. "sin(x)" or "x^2 - 1". */
	functions?: string;
	xMin?: number;
	xMax?: number;
	yMin?: number;
	yMax?: number;
	showLegend?: boolean;
	showGrid?: boolean;
}

export const CHART_TYPES: [ChartType, string][] = [
	["bar", "Barras"], ["line", "Líneas"], ["area", "Área"], ["pie", "Circular"], ["scatter", "Dispersión (x, y)"], ["function", "Función y = f(x)"]
];

export const DEFAULT_CHART: ChartSpec = {
	type: "bar",
	title: "",
	data: "# Serie A; Serie B\nLunes; 4; 2\nMartes; 6; 3\nMiércoles; 5; 5\nJueves; 8; 4\nViernes; 7; 6",
	functions: "sin(x)\nx^2/10 - 1",
	xMin: -10,
	xMax: 10,
	showLegend: true,
	showGrid: true
};

const PALETTE = ["#5b8def", "#f472b6", "#fbbf24", "#34d399", "#a78bfa", "#fb923c", "#22d3ee", "#f87171", "#a3e635", "#e879f9"];

interface Dataset {
	labels: string[];
	series: { name: string; values: number[] }[];
}

function toNumber(raw: string): number {
	const cleaned = raw.trim().replace(/\s/g, "");
	// "3,5" is a decimal comma when there is no dot.
	const normalized = cleaned.includes(",") && !cleaned.includes(".") ? cleaned.replace(",", ".") : cleaned;
	const n = parseFloat(normalized);
	return Number.isFinite(n) ? n : NaN;
}

/** Parses the data text into labels and numeric series. */
export function parseChartData(text: string): Dataset {
	const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
	const separator = lines.some(l => l.includes(";")) ? ";" : lines.some(l => l.includes("\t")) ? "\t" : ",";
	let names: string[] | null = null;
	const rows: { label: string; values: number[] }[] = [];
	for (const line of lines) {
		if (line.startsWith("#")) { names = line.slice(1).split(separator).map(s => s.trim()).filter(Boolean); continue; }
		const cells = line.split(separator).map(s => s.trim());
		const values = cells.slice(1).map(toNumber);
		if (cells.length >= 2 && values.every(v => Number.isNaN(v)) && !names) {
			// A first line of non-numbers is a header: "Mes; Ventas; Gastos".
			names = cells.slice(1);
			continue;
		}
		rows.push({ label: cells[0], values: values.map(v => Number.isNaN(v) ? 0 : v) });
	}
	const count = Math.max(0, ...rows.map(r => r.values.length));
	const series = Array.from({ length: count }, (_, i) => ({
		name: names?.[i] ?? `Serie ${i + 1}`,
		values: rows.map(r => r.values[i] ?? 0)
	}));
	return { labels: rows.map(r => r.label), series };
}

/** Builds a chart spec out of a board table: first column labels, other columns series. */
export function specFromTable(table: CanvasTable): ChartSpec {
	const rows = table.cells.map(r => r.map(c => c.replace(/;/g, ",").trim()));
	const body = table.header ? rows.slice(1) : rows;
	const lines: string[] = [];
	if (table.header && rows[0]) lines.push("# " + rows[0].slice(1).join("; "));
	for (const row of body) if (row.some(c => c)) lines.push(row.join("; "));
	return { ...DEFAULT_CHART, type: "bar", title: table.header && rows[0]?.[0] ? rows[0][0] : "", data: lines.join("\n") };
}

function niceStep(range: number, target: number): number {
	const rough = range / Math.max(1, target);
	const power = Math.pow(10, Math.floor(Math.log10(rough)));
	const candidates = [1, 2, 2.5, 5, 10].map(c => c * power);
	return candidates.find(c => c >= rough) ?? candidates[candidates.length - 1];
}

function formatTick(v: number): string {
	if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0)) return v.toExponential(1);
	return parseFloat(v.toPrecision(6)).toString();
}

/** Lightens (positive) or darkens (negative) a #rrggbb colour. */
function shade(hex: string, amount: number): string {
	const n = parseInt(hex.slice(1), 16);
	const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
	return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

const INK = "#e8eefc";
const MUTED = "#8b9bb4";
const FONT = "-apple-system, 'Segoe UI', sans-serif";
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Renders the chart at device resolution into the canvas element. `progress` (0 to 1) grows it in. */
export function drawChart(canvas: HTMLCanvasElement, spec: ChartSpec, cssWidth: number, cssHeight: number, progress = 1): void {
	const dpr = Math.min(3, window.devicePixelRatio || 1) * 1.5;
	canvas.width = Math.max(1, Math.round(cssWidth * dpr));
	canvas.height = Math.max(1, Math.round(cssHeight * dpr));
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, cssWidth, cssHeight);
	const back = ctx.createLinearGradient(0, 0, 0, cssHeight);
	back.addColorStop(0, "#131d36");
	back.addColorStop(1, "#0b1222");
	ctx.fillStyle = back;
	ctx.fillRect(0, 0, cssWidth, cssHeight);
	ctx.font = `12px ${FONT}`;
	ctx.textBaseline = "middle";

	let top = 14;
	if (spec.title) {
		ctx.fillStyle = INK;
		ctx.font = `650 15px ${FONT}`;
		ctx.textAlign = "center";
		ctx.fillText(spec.title, cssWidth / 2, 20);
		ctx.font = `12px ${FONT}`;
		top = 40;
	}
	const p = easeOut(Math.max(0, Math.min(1, progress)));
	if (spec.type === "pie") { drawPie(ctx, spec, cssWidth, cssHeight, top, p); return; }
	if (spec.type === "function") { drawFunctions(ctx, spec, cssWidth, cssHeight, top, p); return; }
	if (spec.type === "scatter") { drawScatter(ctx, spec, cssWidth, cssHeight, top, p); return; }
	drawSeries(ctx, spec, cssWidth, cssHeight, top, p);
}

interface Plot { x0: number; y0: number; x1: number; y1: number; xMin: number; xMax: number; yMin: number; yMax: number }

function frame(ctx: CanvasRenderingContext2D, w: number, h: number, top: number, xMin: number, xMax: number, yMin: number, yMax: number, legendRows: number, xGrid = false): Plot {
	const plot: Plot = { x0: 48, y0: top + 10, x1: w - 20, y1: h - 32 - legendRows * 20, xMin, xMax, yMin, yMax };
	ctx.lineWidth = 1;
	ctx.setLineDash([2, 5]);
	ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
	if (xGrid) {
		const xStep = niceStep(xMax - xMin, 6);
		for (let v = Math.ceil(xMin / xStep) * xStep; v <= xMax + 1e-9; v += xStep) {
			const x = plot.x0 + (v - xMin) / (xMax - xMin) * (plot.x1 - plot.x0);
			ctx.beginPath(); ctx.moveTo(x, plot.y0); ctx.lineTo(x, plot.y1); ctx.stroke();
		}
	}
	ctx.fillStyle = MUTED;
	ctx.textAlign = "right";
	const yStep = niceStep(yMax - yMin, 5);
	for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) {
		const y = plot.y1 - (v - yMin) / (yMax - yMin) * (plot.y1 - plot.y0);
		ctx.beginPath(); ctx.moveTo(plot.x0, y); ctx.lineTo(plot.x1, y); ctx.stroke();
		ctx.fillText(formatTick(v), plot.x0 - 8, y);
	}
	ctx.setLineDash([]);
	ctx.strokeStyle = "rgba(203, 213, 225, 0.4)";
	ctx.beginPath(); ctx.moveTo(plot.x0, plot.y1); ctx.lineTo(plot.x1, plot.y1); ctx.stroke();
	return plot;
}

/** One round swatch and a name per series, wrapping onto new rows. */
function legend(ctx: CanvasRenderingContext2D, names: string[], w: number, h: number): void {
	ctx.textAlign = "left";
	ctx.font = `12px ${FONT}`;
	let x = 48;
	let y = h - 14;
	for (let i = 0; i < names.length; i++) {
		const width = ctx.measureText(names[i]).width + 24;
		if (x + width > w - 8) { x = 48; y -= 20; }
		ctx.fillStyle = PALETTE[i % PALETTE.length];
		ctx.beginPath(); ctx.arc(x + 5, y, 5, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = "#dbe4f5";
		ctx.fillText(names[i], x + 16, y);
		x += width + 10;
	}
}

/** A curve through the points that never overshoots between them. */
function smoothPath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
	if (!pts.length) return;
	ctx.moveTo(pts[0].x, pts[0].y);
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
		const lo = Math.min(p1.y, p2.y), hi = Math.max(p1.y, p2.y);
		const c1y = Math.max(lo, Math.min(hi, p1.y + (p2.y - p0.y) / 6));
		const c2y = Math.max(lo, Math.min(hi, p2.y - (p3.y - p1.y) / 6));
		ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, c1y, p2.x - (p3.x - p1.x) / 6, c2y, p2.x, p2.y);
	}
}

function drawSeries(ctx: CanvasRenderingContext2D, spec: ChartSpec, w: number, h: number, top: number, progress: number): void {
	const data = parseChartData(spec.data);
	if (!data.labels.length || !data.series.length) { empty(ctx, w, h, "Escribe filas como «Lunes; 4; 2»"); return; }
	const all = data.series.flatMap(s => s.values);
	let yMin = Math.min(0, ...all);
	let yMax = Math.max(0, ...all);
	if (yMax === yMin) yMax = yMin + 1;
	const pad = (yMax - yMin) * 0.1;
	yMin = spec.yMin ?? (yMin < 0 ? yMin - pad : yMin);
	yMax = spec.yMax ?? yMax + pad;
	const showLegend = spec.showLegend !== false && data.series.length > 1;
	const plot = frame(ctx, w, h, top, 0, data.labels.length, yMin, yMax, showLegend ? 1 : 0);
	const slot = (plot.x1 - plot.x0) / data.labels.length;
	const yOf = (v: number) => plot.y1 - (v - yMin) / (yMax - yMin) * (plot.y1 - plot.y0);
	const zero = yOf(Math.max(yMin, Math.min(yMax, 0)));

	ctx.fillStyle = "#c3cfe6";
	ctx.textAlign = "center";
	data.labels.forEach((label, i) => ctx.fillText(label.length > 12 ? label.slice(0, 11) + "…" : label, plot.x0 + slot * (i + 0.5), plot.y1 + 14));

	if (spec.type === "bar") {
		const group = slot * 0.7;
		const bar = group / data.series.length;
		const labelled = bar >= 22 && data.labels.length * data.series.length <= 36;
		data.series.forEach((s, si) => {
			const base = PALETTE[si % PALETTE.length];
			s.values.forEach((v, i) => {
				const x = plot.x0 + slot * i + (slot - group) / 2 + bar * si + 1;
				const full = yOf(v) - zero;
				const y = zero + full * progress;
				const height = Math.max(1, Math.abs(zero - y));
				const gradient = ctx.createLinearGradient(0, Math.min(y, zero), 0, Math.max(y, zero));
				gradient.addColorStop(0, v >= 0 ? shade(base, 0.22) : shade(base, -0.25));
				gradient.addColorStop(1, v >= 0 ? shade(base, -0.25) : shade(base, 0.22));
				ctx.fillStyle = gradient;
				const radius = Math.min(7, (bar - 2) / 2.5, height);
				ctx.beginPath();
				ctx.roundRect(x, Math.min(y, zero), Math.max(1, bar - 2), height, v >= 0 ? [radius, radius, 0, 0] : [0, 0, radius, radius]);
				ctx.fill();
				if (labelled && progress > 0.75) {
					ctx.fillStyle = INK;
					ctx.font = `600 11px ${FONT}`;
					ctx.textAlign = "center";
					ctx.fillText(formatTick(v), x + (bar - 2) / 2, v >= 0 ? y - 8 : y + height + 9);
					ctx.font = `12px ${FONT}`;
				}
			});
		});
	} else {
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, plot.x0 + (plot.x1 - plot.x0) * progress + 8, h);
		ctx.clip();
		data.series.forEach((s, si) => {
			const color = PALETTE[si % PALETTE.length];
			const pts = s.values.map((v, i) => ({ x: plot.x0 + slot * (i + 0.5), y: yOf(v) }));
			if (spec.type === "area" && pts.length) {
				const fill = ctx.createLinearGradient(0, plot.y0, 0, plot.y1);
				fill.addColorStop(0, color + "88");
				fill.addColorStop(1, color + "05");
				ctx.beginPath();
				smoothPath(ctx, pts);
				ctx.lineTo(pts[pts.length - 1].x, zero);
				ctx.lineTo(pts[0].x, zero);
				ctx.closePath();
				ctx.fillStyle = fill;
				ctx.fill();
			}
			ctx.beginPath();
			smoothPath(ctx, pts);
			ctx.strokeStyle = color;
			ctx.lineWidth = 2.8;
			ctx.lineJoin = "round";
			ctx.lineCap = "round";
			ctx.shadowColor = color;
			ctx.shadowBlur = 8;
			ctx.stroke();
			ctx.shadowBlur = 0;
			if (slot > 22 || pts.length <= 12) {
				for (const pt of pts) {
					ctx.beginPath(); ctx.arc(pt.x, pt.y, 4.6, 0, Math.PI * 2);
					ctx.fillStyle = "#0b1222"; ctx.fill();
					ctx.lineWidth = 2.4; ctx.strokeStyle = color; ctx.stroke();
				}
			}
		});
		ctx.restore();
	}
	if (showLegend) legend(ctx, data.series.map(s => s.name), w, h);
}

function drawScatter(ctx: CanvasRenderingContext2D, spec: ChartSpec, w: number, h: number, top: number, progress: number): void {
	const points = spec.data.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => {
		const parts = l.split(/[;\t]|,(?=\s*-?\d)/).map(toNumber);
		return parts.length >= 2 && parts.slice(0, 2).every(Number.isFinite) ? { x: parts[0], y: parts[1] } : null;
	}).filter((p): p is { x: number; y: number } => !!p);
	if (!points.length) { empty(ctx, w, h, "Escribe pares «x; y» en cada línea"); return; }
	const xs = points.map(p => p.x), ys = points.map(p => p.y);
	const xMin = spec.xMin ?? Math.min(...xs), xMax = spec.xMax ?? Math.max(...xs);
	const yMin = spec.yMin ?? Math.min(...ys), yMax = spec.yMax ?? Math.max(...ys);
	const plot = frame(ctx, w, h, top, xMin, xMax === xMin ? xMin + 1 : xMax, yMin, yMax === yMin ? yMin + 1 : yMax, 0, true);
	xAxisTicks(ctx, plot);
	const xOf = (x: number) => plot.x0 + (x - plot.xMin) / (plot.xMax - plot.xMin) * (plot.x1 - plot.x0);
	const yOf = (y: number) => plot.y1 - (y - plot.yMin) / (plot.yMax - plot.yMin) * (plot.y1 - plot.y0);
	// The straight line that fits the points best, and how well it fits.
	if (points.length >= 3) {
		const n = points.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
		const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0), syy = ys.reduce((a, y) => a + (y - my) ** 2, 0);
		const sxy = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
		if (sxx > 0) {
			const slope = sxy / sxx, intercept = my - slope * mx;
			const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1;
			ctx.save();
			ctx.beginPath(); ctx.rect(plot.x0, plot.y0, (plot.x1 - plot.x0) * progress, plot.y1 - plot.y0); ctx.clip();
			ctx.setLineDash([7, 5]);
			ctx.strokeStyle = PALETTE[1];
			ctx.lineWidth = 2;
			ctx.beginPath(); ctx.moveTo(xOf(plot.xMin), yOf(slope * plot.xMin + intercept)); ctx.lineTo(xOf(plot.xMax), yOf(slope * plot.xMax + intercept)); ctx.stroke();
			ctx.restore();
			ctx.setLineDash([]);
			if (progress > 0.6) {
				const label = `R² = ${r2.toFixed(2)}`;
				ctx.font = `600 11px ${FONT}`;
				const width = ctx.measureText(label).width + 16;
				ctx.fillStyle = "rgba(244, 114, 182, 0.16)";
				ctx.beginPath(); ctx.roundRect(plot.x1 - width, plot.y0, width, 20, 10); ctx.fill();
				ctx.fillStyle = "#f9a8d4";
				ctx.textAlign = "center";
				ctx.fillText(label, plot.x1 - width / 2, plot.y0 + 10);
				ctx.font = `12px ${FONT}`;
			}
		}
	}
	ctx.shadowColor = PALETTE[0];
	ctx.shadowBlur = 10;
	points.forEach((p, i) => {
		const reveal = Math.max(0, Math.min(1, progress * 1.4 - (i / points.length) * 0.4));
		ctx.fillStyle = "rgba(91, 141, 239, 0.9)";
		ctx.beginPath(); ctx.arc(xOf(p.x), yOf(p.y), 5 * reveal, 0, Math.PI * 2); ctx.fill();
	});
	ctx.shadowBlur = 0;
}

function xAxisTicks(ctx: CanvasRenderingContext2D, plot: Plot): void {
	ctx.fillStyle = MUTED;
	ctx.textAlign = "center";
	const step = niceStep(plot.xMax - plot.xMin, 6);
	for (let v = Math.ceil(plot.xMin / step) * step; v <= plot.xMax + 1e-9; v += step) {
		const x = plot.x0 + (v - plot.xMin) / (plot.xMax - plot.xMin) * (plot.x1 - plot.x0);
		ctx.fillText(formatTick(v), x, plot.y1 + 14);
	}
}

function drawFunctions(ctx: CanvasRenderingContext2D, spec: ChartSpec, w: number, h: number, top: number, progress: number): void {
	const expressions = (spec.functions ?? "").split(/\r?\n/).map(l => l.trim().replace(/^y\s*=\s*/i, "")).filter(Boolean);
	if (!expressions.length) { empty(ctx, w, h, "Escribe una función por línea, p. ej. sin(x)"); return; }
	const xMin = spec.xMin ?? -10;
	const xMax = spec.xMax ?? 10;
	const samples = 400;
	const curves = expressions.map(expr => {
		const pts: (number | null)[] = [];
		for (let i = 0; i <= samples; i++) {
			const x = xMin + (xMax - xMin) * i / samples;
			try {
				const y = evaluate(expr, "rad", 0, { x });
				pts.push(Number.isFinite(y) && Math.abs(y) < 1e6 ? y : null);
			} catch { pts.push(null); }
		}
		return pts;
	});
	const finite = curves.flat().filter((v): v is number => v !== null);
	let yMin = spec.yMin ?? (finite.length ? Math.min(...finite) : -1);
	let yMax = spec.yMax ?? (finite.length ? Math.max(...finite) : 1);
	if (spec.yMin === undefined && spec.yMax === undefined) {
		// Ignore extreme spikes (asymptotes) when choosing the range.
		const sorted = [...finite].sort((a, b) => a - b);
		if (sorted.length > 20) { yMin = sorted[Math.floor(sorted.length * 0.02)]; yMax = sorted[Math.ceil(sorted.length * 0.98) - 1]; }
		const pad = (yMax - yMin || 2) * 0.1;
		yMin -= pad; yMax += pad;
	}
	if (yMax === yMin) yMax = yMin + 1;
	const plot = frame(ctx, w, h, top, xMin, xMax, yMin, yMax, expressions.length > 1 ? 1 : 0, true);
	xAxisTicks(ctx, plot);
	const xOf = (x: number) => plot.x0 + (x - xMin) / (xMax - xMin) * (plot.x1 - plot.x0);
	const yOf = (y: number) => plot.y1 - (y - yMin) / (yMax - yMin) * (plot.y1 - plot.y0);
	// Axes through the origin when it is in view.
	ctx.strokeStyle = "rgba(226, 232, 240, 0.55)";
	ctx.lineWidth = 1.2;
	if (yMin < 0 && yMax > 0) { ctx.beginPath(); ctx.moveTo(plot.x0, yOf(0)); ctx.lineTo(plot.x1, yOf(0)); ctx.stroke(); }
	if (xMin < 0 && xMax > 0) { ctx.beginPath(); ctx.moveTo(xOf(0), plot.y0); ctx.lineTo(xOf(0), plot.y1); ctx.stroke(); }
	ctx.save();
	ctx.beginPath(); ctx.rect(plot.x0, plot.y0, (plot.x1 - plot.x0) * progress, plot.y1 - plot.y0); ctx.clip();
	curves.forEach((pts, ci) => {
		const color = PALETTE[ci % PALETTE.length];
		ctx.strokeStyle = color;
		ctx.lineWidth = 2.6;
		ctx.lineJoin = "round";
		ctx.shadowColor = color;
		ctx.shadowBlur = 8;
		ctx.beginPath();
		let pen = false;
		pts.forEach((y, i) => {
			const x = xMin + (xMax - xMin) * i / samples;
			if (y === null || y < yMin - (yMax - yMin) || y > yMax + (yMax - yMin)) { pen = false; return; }
			if (!pen) { ctx.moveTo(xOf(x), yOf(y)); pen = true; } else ctx.lineTo(xOf(x), yOf(y));
		});
		ctx.stroke();
	});
	ctx.shadowBlur = 0;
	ctx.restore();
	if (expressions.length > 1) legend(ctx, expressions.map(e => `y = ${e}`), w, h);
}

/** A ring with the total in its middle and every share named beside it. */
function drawPie(ctx: CanvasRenderingContext2D, spec: ChartSpec, w: number, h: number, top: number, progress: number): void {
	const data = parseChartData(spec.data);
	const values = data.labels.map((label, i) => ({ label, value: Math.max(0, data.series[0]?.values[i] ?? 0) })).filter(v => v.value > 0);
	const total = values.reduce((n, v) => n + v.value, 0);
	if (!total) { empty(ctx, w, h, "Escribe filas como «Teoría; 40»"); return; }
	const cx = w * 0.34;
	const cy = top + (h - top) / 2;
	const r = Math.min(w * 0.28, (h - top) / 2 - 12);
	const inner = r * 0.56;
	const gap = values.length > 1 ? 0.03 : 0;
	let angle = -Math.PI / 2;
	ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
	ctx.shadowBlur = 14;
	ctx.shadowOffsetY = 4;
	values.forEach((v, i) => {
		const sweep = v.value / total * Math.PI * 2 * progress;
		const from = angle + gap / 2, to = angle + sweep - gap / 2;
		if (to > from) {
			const color = PALETTE[i % PALETTE.length];
			const fill = ctx.createRadialGradient(cx, cy, inner, cx, cy, r);
			fill.addColorStop(0, shade(color, -0.2));
			fill.addColorStop(1, shade(color, 0.12));
			ctx.beginPath();
			ctx.arc(cx, cy, r, from, to);
			ctx.arc(cx, cy, inner, to, from, true);
			ctx.closePath();
			ctx.fillStyle = fill;
			ctx.fill();
		}
		angle += v.value / total * Math.PI * 2 * progress;
	});
	ctx.shadowBlur = 0;
	ctx.shadowOffsetY = 0;
	angle = -Math.PI / 2;
	ctx.textAlign = "center";
	values.forEach((v) => {
		const sweep = v.value / total * Math.PI * 2 * progress;
		if (sweep > 0.3 && progress > 0.6) {
			const mid = angle + sweep / 2, mid_r = (r + inner) / 2;
			ctx.fillStyle = "#ffffff";
			ctx.font = `700 11.5px ${FONT}`;
			ctx.fillText(`${Math.round(v.value / total * 100)}%`, cx + Math.cos(mid) * mid_r, cy + Math.sin(mid) * mid_r);
		}
		angle += sweep;
	});
	ctx.fillStyle = INK;
	ctx.font = `700 ${Math.max(14, Math.round(inner * 0.5))}px ${FONT}`;
	ctx.fillText(formatTick(total * progress), cx, cy - 6);
	ctx.fillStyle = MUTED;
	ctx.font = `11px ${FONT}`;
	ctx.fillText("total", cx, cy + Math.max(10, inner * 0.3));
	ctx.font = `12px ${FONT}`;
	ctx.textAlign = "left";
	let y = top + 18;
	values.forEach((v, i) => {
		if (y > h - 8) return;
		ctx.fillStyle = PALETTE[i % PALETTE.length];
		ctx.beginPath(); ctx.arc(w * 0.7 + 5, y, 5, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = "#dbe4f5";
		ctx.fillText(v.label, w * 0.7 + 16, y);
		ctx.fillStyle = MUTED;
		ctx.fillText(`${formatTick(v.value)} · ${Math.round(v.value / total * 100)}%`, w * 0.7 + 16 + ctx.measureText(v.label).width + 8, y);
		y += 20;
	});
}

function empty(ctx: CanvasRenderingContext2D, w: number, h: number, message: string): void {
	ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
	ctx.setLineDash([6, 5]);
	ctx.beginPath(); ctx.roundRect(24, 24, w - 48, h - 48, 12); ctx.stroke();
	ctx.setLineDash([]);
	ctx.fillStyle = MUTED;
	ctx.textAlign = "center";
	ctx.fillText(message, w / 2, h / 2);
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export class ChartEditorModal extends Modal {
	private spec: ChartSpec;

	constructor(app: App, initial: ChartSpec, private onSave: (spec: ChartSpec) => void) {
		super(app);
		this.spec = { ...DEFAULT_CHART, ...initial };
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("notelens-chart-editor");
		contentEl.createEl("h3", { text: tr("Gráfico") });

		const preview = contentEl.createEl("canvas", { cls: "notelens-chart-preview" });
		const redraw = () => drawChart(preview, this.spec, 520, 240);

		let dataSetting: Setting;
		let functionSetting: Setting;
		const syncVisibility = () => {
			// Obsidian has no global "hidden" class, so toggle the display directly.
			const fn = this.spec.type === "function";
			dataSetting.settingEl.style.display = fn ? "none" : "";
			functionSetting.settingEl.style.display = fn ? "" : "none";
		};

		new Setting(contentEl).setName(tr("Tipo")).addDropdown(d => {
			for (const [id, label] of CHART_TYPES) d.addOption(id, label);
			d.setValue(this.spec.type).onChange(v => { this.spec.type = v as ChartType; syncVisibility(); redraw(); });
		});
		new Setting(contentEl).setName(tr("Título")).addText(t => t.setValue(this.spec.title ?? "").onChange(v => { this.spec.title = v; redraw(); }));

		dataSetting = new Setting(contentEl)
			.setName(tr("Datos"))
			.setDesc(tr("Una fila por línea: etiqueta; valor; valor… La primera línea puede nombrar las series empezando por #. Para dispersión: x; y."))
			.addTextArea(t => {
				t.setValue(this.spec.data).onChange(v => { this.spec.data = v; redraw(); });
				t.inputEl.rows = 7;
				t.inputEl.addClass("notelens-chart-data");
			});
		functionSetting = new Setting(contentEl)
			.setName(tr("Funciones"))
			.setDesc(tr("Una por línea, en x: sin(x), x^2 - 3x + 2, e^(-x^2), abs(x)… Misma sintaxis que la calculadora."))
			.addTextArea(t => {
				t.setValue(this.spec.functions ?? "").onChange(v => { this.spec.functions = v; redraw(); });
				t.inputEl.rows = 4;
				t.inputEl.addClass("notelens-chart-data");
			});
		const numberField = (setting: Setting, key: "xMin" | "xMax" | "yMin" | "yMax", placeholder: string) => setting.addText(t => {
			t.setPlaceholder(placeholder).setValue(this.spec[key] === undefined ? "" : String(this.spec[key])).onChange(v => {
				const n = parseFloat(v.replace(",", "."));
				this.spec[key] = v.trim() === "" || !Number.isFinite(n) ? undefined : n;
				redraw();
			});
			t.inputEl.setCssStyles({ width: "80px" });
		});
		numberField(numberField(new Setting(contentEl).setName(tr("Rango x (funciones y dispersión)")), "xMin", "mín"), "xMax", "máx");
		numberField(numberField(new Setting(contentEl).setName(tr("Rango y (vacío = automático)")), "yMin", "mín"), "yMax", "máx");
		new Setting(contentEl).setName(tr("Leyenda")).addToggle(t => t.setValue(this.spec.showLegend !== false).onChange(v => { this.spec.showLegend = v; redraw(); }));

		new Setting(contentEl)
			.addButton(b => b.setButtonText(tr("Guardar en la pizarra")).setCta().onClick(() => { this.close(); this.onSave({ ...this.spec }); }))
			.addButton(b => b.setButtonText(tr("Cancelar")).onClick(() => this.close()));
		syncVisibility();
		redraw();
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------
// Board frame
// ---------------------------------------------------------------------------

export interface ChartHost {
	startEmbedDrag(e: PointerEvent, el: HTMLElement, embed: Embed, force?: boolean): boolean;
	onEmbedDeleted(embed: Embed): void;
	selectEmbed(embed: Embed): void;
	editChart(embed: Embed): void;
}

export function mountChartFrame(host: ChartHost, layer: HTMLElement, embed: Embed): HTMLElement {
	const spec = embed.chart ?? DEFAULT_CHART;
	const frame = layer.createDiv({ cls: "notelens-embed notelens-chart-frame" });
	frame.setAttr("data-id", embed.id);
	frame.style.left = `${embed.x}px`;
	frame.style.top = `${embed.y}px`;
	frame.style.width = `${embed.w}px`;
	frame.style.height = `${embed.h}px`;
	frame.style.transform = embed.rotation ? `rotate(${embed.rotation}deg)` : "";

	const header = frame.createDiv({ cls: "notelens-embed-header" });
	setIcon(header.createSpan({ cls: "notelens-embed-icon" }), spec.type === "function" ? "function-square" : spec.type === "pie" ? "pie-chart" : spec.type === "line" || spec.type === "area" ? "line-chart" : "bar-chart-3");
	header.createSpan({ cls: "notelens-embed-title", text: spec.title || CHART_TYPES.find(([id]) => id === spec.type)?.[1] || tr("Gráfico") });
	const edit = header.createEl("button", { cls: "notelens-embed-open" });
	setIcon(edit, "pencil");
	edit.title = tr("Editar datos del gráfico");
	edit.onclick = (e) => { e.stopPropagation(); host.editChart(embed); };
	const remove = header.createEl("button", { cls: "notelens-embed-close notelens-object-close" });
	setIcon(remove, "x");
	remove.title = tr("Eliminar gráfico");
	remove.setAttr("aria-label", tr("Eliminar gráfico"));
	remove.addEventListener("pointerdown", (e) => e.stopPropagation());
	remove.onclick = (e) => { e.stopPropagation(); frame.remove(); host.onEmbedDeleted(embed); };

	const body = frame.createDiv({ cls: "notelens-embed-body notelens-chart-body" });
	const canvas = body.createEl("canvas", { cls: "notelens-chart-canvas" });
	const size = () => ({ w: Math.max(120, frame.clientWidth || embed.w), h: Math.max(80, (frame.clientHeight || embed.h) - 32) });
	// The chart grows in the first time it is drawn, unless the person asked for less motion.
	let growing = false;
	const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
	if (still) drawChart(canvas, spec, size().w, size().h);
	else {
		growing = true;
		const start = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / 700);
			drawChart(canvas, spec, size().w, size().h, t);
			if (t < 1 && frame.isConnected) window.requestAnimationFrame(step); else growing = false;
		};
		window.requestAnimationFrame(step);
	}
	// Repaint crisply after the selection resizer changes the frame.
	const observer = new ResizeObserver(() => {
		if (!frame.isConnected) { observer.disconnect(); return; }
		if (!growing) drawChart(canvas, spec, size().w, size().h);
	});
	observer.observe(frame);

	frame.addEventListener("pointerdown", (e) => host.startEmbedDrag(e, frame, embed));
	frame.addEventListener("dblclick", (e) => { e.stopPropagation(); host.editChart(embed); });
	return frame;
}
