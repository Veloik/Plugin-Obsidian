export interface ViewTransform {
	x: number;
	y: number;
	scale: number;
}

export interface StrokePoint {
	x: number;
	y: number;
	/** Stylus pressure 0..1 (0.5 when the device reports no pressure). */
	p: number;
}

export interface Stroke {
	id: string;
	type: "pen" | "highlighter";
	color: string;
	width: number;
	points: StrokePoint[];
}

export type ShapeKind = "line" | "arrow" | "rectangle" | "rounded-rectangle" | "ellipse" | "diamond" | "triangle" | "callout";

/** A vector shape kept independent from ink so it can be selected and moved. */
export interface Shape {
	id: string;
	kind: ShapeKind;
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
	width: number;
	/** Optional fill for closed shapes; lines and arrows ignore it. */
	fill?: string;
	/** Fill opacity from 0 (transparent) to 1 (opaque). */
	fillOpacity?: number;
}

export interface Badge {
	id: string;
	x: number;
	y: number;
	/** Scale applied by the universal selection resizer. */
	scale?: number;
	tagId: string;
	label: string;
	tooltip?: string;
	/** Tasks and questions can be ticked off; the tag summary lists what is still pending. */
	done?: boolean;
}

export interface TextBox {
	id: string;
	x: number;
	y: number;
	text: string;
	fontSize: number;
	color: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	/** Paragraph alignment of the whole box. */
	align?: "left" | "center" | "right";
	/** Present only on note cards created with the sticky-note command. */
	stickyColor?: string;
	/** Scene-space dimensions. Legacy notes fall back to natural sizing. */
	w?: number;
	h?: number;
	/** Visual family selected from the text panel. */
	fontFamily?: CanvasFont;
	/** Plain boxes grow with their longest line until the user resizes them. */
	autoWidth?: boolean;
	/** A code block keeps text editing but gets its own readable treatment; a math box renders its text as LaTeX. */
	variant?: "text" | "code" | "math";
	language?: string;
}

export type CanvasFont = "sans" | "serif" | "rounded" | "mono";

/** A resizable editable table stored directly on the canvas. */
export interface CanvasTable {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rows: number;
	cols: number;
	cells: string[][];
	header?: boolean;
	/** First column styled as row headers. */
	headerColumn?: boolean;
	/** Column widths and row heights in scene px; missing entries share the space evenly. */
	colWidths?: number[];
	rowHeights?: number[];
}

/** Saved camera position for jumping between areas of an infinite canvas. */
export interface ViewportBookmark {
	id: string;
	label: string;
	x: number;
	y: number;
	scale: number;
}

export type EmbedKind = "pdf" | "youtube" | "web-video" | "video" | "audio" | "epub" | "image" | "file" | "note" | "board" | "chart";

/** Chart definition stored with a "chart" embed. */
export interface ChartData {
	type: "bar" | "line" | "area" | "pie" | "scatter" | "function";
	title?: string;
	data: string;
	functions?: string;
	xMin?: number;
	xMax?: number;
	yMin?: number;
	yMax?: number;
	showLegend?: boolean;
	showGrid?: boolean;
}
export type RemoteVideoProvider = "youtube" | "tiktok" | "instagram" | "x" | "vimeo" | "dailymotion" | "streamable" | "loom" | "facebook";

export interface Embed {
	id: string;
	kind: EmbedKind;
	/** Vault-relative path for attachments, or an iframe URL for remote video. */
	src: string;
	/** Original public URL for a remote provider, preserved for sharing and opening externally. */
	originalUrl?: string;
	provider?: RemoteVideoProvider;
	x: number;
	y: number;
	w: number;
	h: number;
	/** Chart definition, only for kind "chart". */
	chart?: ChartData;
	/** Last viewed page (PDF viewer mode). */
	page?: number;
	/** PDF presentation: floating viewer or loose pages stacked on the canvas. */
	pdfMode?: "viewer" | "pages";
	/** Cached page count for pdfMode "pages" (fast re-open). */
	pages?: number;
	/** Vault-relative WebVTT track associated with a local video. */
	captionSrc?: string;
}

export type BackgroundPattern = "dots" | "grid" | "lines" | "margin" | "blank";
/** Spacing of the dots, lines or grid cells of the page. */
export type GridSize = "small" | "medium" | "large";

export interface OneNoteDocument {
	version: number;
	strokes: Stroke[];
	shapes: Shape[];
	badges: Badge[];
	texts: TextBox[];
	tables: CanvasTable[];
	embeds: Embed[];
	bookmarks: ViewportBookmark[];
	a4Guides: boolean;
	viewTransform: ViewTransform;
	background: BackgroundPattern;
	backgroundColor: string;
	lineColor: string;
	gridSize: GridSize;
}

/** Per-vault defaults a new board starts from (see the settings tab). */
export type DocumentDefaults = Partial<Pick<OneNoteDocument, "background" | "backgroundColor" | "lineColor" | "gridSize">>;

export const DOC_VERSION = 6;
export const DEFAULT_BG_COLOR = "#0b0e14";
export const DEFAULT_LINE_COLOR = "#64748b";

export function createEmptyDocument(defaults: DocumentDefaults = {}): OneNoteDocument {
	return {
		version: DOC_VERSION,
		strokes: [],
		shapes: [],
		badges: [],
		texts: [],
		tables: [],
		embeds: [],
		bookmarks: [],
		a4Guides: false,
		viewTransform: { x: 0, y: 0, scale: 1 },
		background: "dots",
		backgroundColor: DEFAULT_BG_COLOR,
		lineColor: DEFAULT_LINE_COLOR,
		gridSize: "medium",
		...defaults
	};
}

let idCounter = 0;
export function genId(prefix: string): string {
	return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

/**
 * Normalizes any parsed JSON (including legacy documents) into a valid
	 * OneNoteDocument v5. Never throws: unknown/extra fields are dropped.
 */
export function migrateDocument(raw: any): OneNoteDocument {
	const doc = createEmptyDocument();
	if (!raw || typeof raw !== "object") return doc;

	if (Array.isArray(raw.strokes)) {
		for (const s of raw.strokes) {
			if (!s || !Array.isArray(s.points)) continue;
			const points: StrokePoint[] = [];
			for (const p of s.points) {
				if (typeof p?.x !== "number" || typeof p?.y !== "number") continue;
				points.push({ x: p.x, y: p.y, p: typeof p.p === "number" ? p.p : 0.5 });
			}
			if (points.length < 1) continue;
			doc.strokes.push({
				id: typeof s.id === "string" ? s.id : genId("stroke"),
				type: s.type === "highlighter" ? "highlighter" : "pen",
				color: typeof s.color === "string" ? s.color : "#f8fafc",
				width: typeof s.width === "number" ? s.width : 2.5,
				points
			});
		}
	}

	if (Array.isArray(raw.shapes)) {
		for (const s of raw.shapes) {
			if (!s || typeof s.x !== "number" || typeof s.y !== "number") continue;
			if (typeof s.w !== "number" || typeof s.h !== "number") continue;
			if (!(["line", "arrow", "rectangle", "rounded-rectangle", "ellipse", "diamond", "triangle", "callout"] as string[]).includes(s.kind)) continue;
			doc.shapes.push({
				id: typeof s.id === "string" ? s.id : genId("shape"),
				kind: s.kind,
				x: s.x,
				y: s.y,
				w: s.w,
				h: s.h,
				color: typeof s.color === "string" ? s.color : "#e5e7eb",
				width: typeof s.width === "number" ? Math.min(Math.max(s.width, 1), 24) : 2.5,
				fill: typeof s.fill === "string" && /^#[0-9a-f]{6}$/i.test(s.fill) ? s.fill : undefined,
				fillOpacity: typeof s.fillOpacity === "number" ? Math.min(Math.max(s.fillOpacity, 0), 1) : 0
			});
		}
	}

	if (Array.isArray(raw.badges)) {
		for (const b of raw.badges) {
			if (typeof b?.x !== "number" || typeof b?.y !== "number") continue;
			doc.badges.push({
				id: typeof b.id === "string" ? b.id : genId("badge"),
				x: b.x,
				y: b.y,
				scale: typeof b.scale === "number" ? Math.min(Math.max(b.scale, 0.5), 3) : 1,
				tagId: String(b.tagId ?? "tag_star"),
				label: String(b.label ?? "⭐️ Importante"),
				tooltip: typeof b.tooltip === "string" ? b.tooltip : undefined
			});
		}
	}

	if (Array.isArray(raw.texts)) {
		for (const t of raw.texts) {
			if (typeof t?.x !== "number" || typeof t?.y !== "number") continue;
			doc.texts.push({
				id: typeof t.id === "string" ? t.id : genId("text"),
				x: t.x,
				y: t.y,
				text: String(t.text ?? ""),
				fontSize: typeof t.fontSize === "number" ? t.fontSize : 18,
				color: typeof t.color === "string" ? t.color : "#f8fafc",
				bold: t.bold === true,
				italic: t.italic === true,
				underline: t.underline === true,
				stickyColor: typeof t.stickyColor === "string" ? t.stickyColor : undefined,
				w: typeof t.w === "number" ? Math.min(Math.max(t.w, 120), 900) : undefined,
				h: typeof t.h === "number" ? Math.min(Math.max(t.h, 34), 900) : undefined,
				fontFamily: t.fontFamily === "serif" || t.fontFamily === "rounded" || t.fontFamily === "mono" ? t.fontFamily : "sans",
				variant: t.variant === "code" ? "code" : "text",
				language: typeof t.language === "string" ? t.language.slice(0, 32) : undefined
			});
		}
	}

	if (Array.isArray(raw.tables)) {
		for (const table of raw.tables) {
			if (typeof table?.x !== "number" || typeof table?.y !== "number") continue;
			const rows = typeof table.rows === "number" ? Math.min(Math.max(Math.round(table.rows), 1), 30) : 3;
			const cols = typeof table.cols === "number" ? Math.min(Math.max(Math.round(table.cols), 1), 20) : 3;
			const cells = Array.from({ length: rows }, (_, row) =>
				Array.from({ length: cols }, (_, col) => String(table.cells?.[row]?.[col] ?? ""))
			);
			doc.tables.push({
				id: typeof table.id === "string" ? table.id : genId("table"),
				x: table.x, y: table.y,
				w: typeof table.w === "number" ? Math.min(Math.max(table.w, 220), 1400) : 520,
				h: typeof table.h === "number" ? Math.min(Math.max(table.h, 120), 1200) : 220,
				rows, cols, cells, header: table.header === true, headerColumn: table.headerColumn === true,
				colWidths: Array.isArray(table.colWidths) && table.colWidths.length === cols && table.colWidths.every((v: unknown) => typeof v === "number" && v > 0) ? table.colWidths : undefined,
				rowHeights: Array.isArray(table.rowHeights) && table.rowHeights.length === rows && table.rowHeights.every((v: unknown) => typeof v === "number" && v > 0) ? table.rowHeights : undefined
			});
		}
	}

	if (Array.isArray(raw.bookmarks)) {
		for (const bookmark of raw.bookmarks) {
			if (typeof bookmark?.x !== "number" || typeof bookmark?.y !== "number") continue;
			doc.bookmarks.push({
				id: typeof bookmark.id === "string" ? bookmark.id : genId("bookmark"),
				label: typeof bookmark.label === "string" ? bookmark.label.slice(0, 80) : "Sección",
				x: bookmark.x,
				y: bookmark.y,
				scale: typeof bookmark.scale === "number" ? Math.min(Math.max(bookmark.scale, 0.15), 4) : 1
			});
		}
	}

	doc.a4Guides = raw.a4Guides === true;

	if (Array.isArray(raw.embeds)) {
		for (const e of raw.embeds) {
			if (typeof e?.x !== "number" || typeof e?.y !== "number" || typeof e?.src !== "string") continue;
			const kind: EmbedKind =
				e.kind === "youtube" || e.kind === "web-video" || e.kind === "video" || e.kind === "audio" || e.kind === "epub" || e.kind === "image" || e.kind === "file" || e.kind === "note" || e.kind === "board" || e.kind === "chart"
					? e.kind
					: "pdf";
			doc.embeds.push({
				id: typeof e.id === "string" ? e.id : genId("embed"),
				kind,
				src: e.src,
				originalUrl: typeof e.originalUrl === "string" ? e.originalUrl : kind === "youtube" ? e.src : undefined,
				provider: (["youtube", "tiktok", "instagram", "x", "vimeo", "dailymotion", "streamable", "loom", "facebook"] as string[]).includes(e.provider)
					? e.provider as RemoteVideoProvider
					: kind === "youtube" ? "youtube" : undefined,
				x: e.x,
				y: e.y,
				w: typeof e.w === "number" ? e.w : 640,
				h: typeof e.h === "number" ? e.h : 480,
				chart: kind === "chart" && e.chart && typeof e.chart === "object" && typeof e.chart.data === "string"
					? { ...e.chart, type: ["bar", "line", "area", "pie", "scatter", "function"].includes(e.chart.type) ? e.chart.type : "bar" }
					: undefined,
				page: typeof e.page === "number" ? e.page : undefined,
				pdfMode: e.pdfMode === "pages" || e.pdfMode === "scroll" ? "pages" : "viewer",
				pages: typeof e.pages === "number" ? e.pages : undefined,
				captionSrc: typeof e.captionSrc === "string" ? e.captionSrc : undefined
			});
		}
	}

	const vt = raw.viewTransform;
	if (vt && typeof vt.x === "number" && typeof vt.y === "number" && typeof vt.scale === "number") {
		doc.viewTransform = { x: vt.x, y: vt.y, scale: Math.min(Math.max(0.15, vt.scale), 4) };
	}

	if (raw.background === "grid" || raw.background === "lines" || raw.background === "blank" || raw.background === "margin") {
		doc.background = raw.background;
	}

	if (typeof raw.backgroundColor === "string" && /^#[0-9a-f]{6}$/i.test(raw.backgroundColor)) {
		doc.backgroundColor = raw.backgroundColor;
	}

	if (typeof raw.lineColor === "string" && /^#[0-9a-f]{6}$/i.test(raw.lineColor)) {
		doc.lineColor = raw.lineColor;
	}
	if (raw.gridSize === "small" || raw.gridSize === "medium" || raw.gridSize === "large") {
		doc.gridSize = raw.gridSize;
	}

	return doc;
}
