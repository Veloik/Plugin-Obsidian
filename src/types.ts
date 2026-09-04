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

/** How pen ink is rendered: each nib has its own width and texture rules. */
export type PenStyle = "ballpoint" | "pencil" | "fountain" | "marker" | "brush";

export interface Stroke {
	id: string;
	/** Notebook page that owns this stroke. */
	pageId?: string;
	type: "pen" | "highlighter";
	color: string;
	width: number;
	points: StrokePoint[];
	/** Pen nib; missing on old documents, which means ballpoint. */
	style?: PenStyle;
}

export type ShapeKind = "line" | "arrow" | "rectangle" | "rounded-rectangle" | "ellipse" | "diamond" | "triangle" | "callout";

/** A vector shape kept independent from ink so it can be selected and moved. */
export interface Shape {
	id: string;
	/** Notebook page that owns this shape. */
	pageId?: string;
	kind: ShapeKind;
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
	width: number;
	/** Optional fill for closed shapes; lines and arrows ignore it. */
	fill?: string;
	/** Rotation around the shape centre, in degrees. */
	rotation?: number;
	/** Fill opacity from 0 (transparent) to 1 (opaque). */
	fillOpacity?: number;
}

export interface Badge {
	id: string;
	/** Notebook page that owns this tag. */
	pageId?: string;
	x: number;
	y: number;
	/** Scale applied by the universal selection resizer. */
	scale?: number;
	tagId: string;
	label: string;
	/** User-facing title shown on the placed tag and its hover card. */
	title?: string;
	tooltip?: string;
	/** Drawn note (PNG data URL) shown in the hover card, alone or under the text. */
	sketch?: string;
	/** Images pinned to the badge's small whiteboard. */
	images?: BadgeImage[];
	/** Individual steps stored by task badges. */
	checklist?: BadgeChecklistItem[];
	/** Tasks and questions can be ticked off; the tag summary lists what is still pending. */
	done?: boolean;
}

export interface BadgeChecklistItem {
	id: string;
	text: string;
	/** Handwritten step (PNG data URL) for pen-only use; replaces the text when set. */
	sketch?: string;
	done: boolean;
}

export interface BadgeImage {
	id: string;
	name: string;
	/** Self-contained image data so notes survive vault moves and shared-board exports. */
	src: string;
	/** Position and size in the 560 x 320 badge whiteboard. */
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * A stretch of text with its own look inside a box. Runs are what the rich
 * editor writes; `TextBox.text` stays a plain copy of the same words so search,
 * export and the older boxes that only ever had marks keep working.
 */
export interface TextRun {
	text: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	/** Inline code; drawn in a monospaced chip. */
	code?: boolean;
	/** Ink for this fragment. Absent means the colour of the box. */
	color?: string;
	/** Highlight tint behind this fragment. */
	mark?: string;
}

export interface TextBox {
	id: string;
	/** Notebook page that owns this text box. */
	pageId?: string;
	x: number;
	y: number;
	text: string;
	fontSize: number;
	color: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	/** Tint used by the `==resaltado==` marks inside this box. */
	highlight?: string;
	/** What the rich editor wrote: every fragment with its own style. */
	runs?: TextRun[];
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
	/** Rotation around the box centre, in degrees. */
	rotation?: number;
	/** A code block keeps text editing but gets its own readable treatment; a math box renders its text as LaTeX. */
	variant?: "text" | "code" | "math";
	language?: string;
}

/** Runs read back from disk: text is kept, everything else is a flag or a colour. */
function sanitizeRuns(raw: unknown[]): TextRun[] | undefined {
	const runs: TextRun[] = [];
	for (const item of raw) {
		const r = item as Record<string, unknown>;
		const text = typeof r?.text === "string" ? r.text : "";
		if (!text) continue;
		runs.push({
			text,
			bold: r.bold === true || undefined,
			italic: r.italic === true || undefined,
			underline: r.underline === true || undefined,
			strike: r.strike === true || undefined,
			code: r.code === true || undefined,
			color: typeof r.color === "string" ? r.color : undefined,
			mark: typeof r.mark === "string" ? r.mark : undefined
		});
	}
	return runs.length ? runs : undefined;
}

export type CanvasFont =
	| "sans" | "serif" | "rounded" | "mono"
	| "handwriting" | "marker" | "elegant" | "slab" | "condensed" | "typewriter" | "display";

const CANVAS_FONT_IDS: CanvasFont[] = [
	"sans", "serif", "rounded", "mono", "handwriting", "marker", "elegant", "slab", "condensed", "typewriter", "display"
];

/** True for a family this build can draw; anything else falls back to "sans". */
export const isCanvasFont = (value: unknown): value is CanvasFont =>
	typeof value === "string" && (CANVAS_FONT_IDS as string[]).includes(value);

/** A resizable editable table stored directly on the canvas. */
export interface CanvasTable {
	id: string;
	/** Notebook page that owns this table. */
	pageId?: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rows: number;
	cols: number;
	cells: string[][];
	header?: boolean;
	/** Name shown in the table header; defaults to "Tabla". */
	title?: string;
	/** Rotation around the table centre, in degrees. */
	rotation?: number;
	/** First column styled as row headers. */
	headerColumn?: boolean;
	/** Column widths and row heights in scene px; missing entries share the space evenly. */
	colWidths?: number[];
	rowHeights?: number[];
}

/** Saved camera position for jumping between areas of an infinite canvas. */
export interface ViewportBookmark {
	id: string;
	/** Page to open before restoring the saved camera position. */
	pageId?: string;
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
	/** Notebook page that owns this embedded object. */
	pageId?: string;
	kind: EmbedKind;
	/** Vault-relative path for attachments, or an iframe URL for remote video. */
	src: string;
	/** Original public URL for a remote provider, preserved for sharing and opening externally. */
	originalUrl?: string;
	/** Rotation around the frame centre, in degrees. */
	rotation?: number;
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

/** A page keeps its own camera and paper settings; canvas objects carry its id. */
export interface DocumentPage {
	id: string;
	title: string;
	viewTransform: ViewTransform;
	background: BackgroundPattern;
	/** Left paper guide; independent from dots, grid, lines or a blank page. */
	marginEnabled: boolean;
	backgroundColor: string;
	lineColor: string;
	gridSize: GridSize;
	a4Guides: boolean;
}

export interface OneNoteDocument {
	version: number;
	pages: DocumentPage[];
	activePageId: string;
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
	marginEnabled: boolean;
	backgroundColor: string;
	lineColor: string;
	gridSize: GridSize;
}

/** Per-vault defaults a new board starts from (see the settings tab). */
export type DocumentDefaults = Partial<Pick<OneNoteDocument, "background" | "marginEnabled" | "backgroundColor" | "lineColor" | "gridSize">>;

export const DOC_VERSION = 10;
export const DEFAULT_BG_COLOR = "#0b0e14";
export const DEFAULT_LINE_COLOR = "#64748b";

export function createDocumentPage(title: string, defaults: DocumentDefaults = {}, id = genId("page")): DocumentPage {
	const legacyMargin = defaults.background === "margin";
	return {
		id,
		title,
		viewTransform: { x: 0, y: 0, scale: 1 },
		background: legacyMargin ? "lines" : defaults.background ?? "dots",
		marginEnabled: defaults.marginEnabled ?? legacyMargin,
		backgroundColor: defaults.backgroundColor ?? DEFAULT_BG_COLOR,
		lineColor: defaults.lineColor ?? DEFAULT_LINE_COLOR,
		gridSize: defaults.gridSize ?? "medium",
		a4Guides: false
	};
}

export function createEmptyDocument(defaults: DocumentDefaults = {}): OneNoteDocument {
	const firstPage = createDocumentPage("Página 1", defaults, "page_1");
	return {
		version: DOC_VERSION,
		pages: [firstPage],
		activePageId: firstPage.id,
		strokes: [],
		shapes: [],
		badges: [],
		texts: [],
		tables: [],
		embeds: [],
		bookmarks: [],
		a4Guides: firstPage.a4Guides,
		viewTransform: { ...firstPage.viewTransform },
		background: firstPage.background,
		marginEnabled: firstPage.marginEnabled,
		backgroundColor: firstPage.backgroundColor,
		lineColor: firstPage.lineColor,
		gridSize: firstPage.gridSize
	};
}

let idCounter = 0;
export function genId(prefix: string): string {
	return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

/**
 * Normalizes any parsed JSON (including legacy documents) into a valid
 * OneNoteDocument v10. Never throws: unknown/extra fields are dropped.
 */
export function migrateDocument(raw: any): OneNoteDocument {
	const doc = createEmptyDocument();
	if (!raw || typeof raw !== "object") return doc;

	if (Array.isArray(raw.pages) && raw.pages.length > 0) {
		const pages: DocumentPage[] = [];
		for (let index = 0; index < raw.pages.length; index++) {
			const source = raw.pages[index];
			if (!source || typeof source !== "object") continue;
			const page = createDocumentPage(
				typeof source.title === "string" && source.title.trim() ? source.title.trim().slice(0, 80) : `Página ${index + 1}`,
				{},
				typeof source.id === "string" && source.id ? source.id : genId("page")
			);
			const view = source.viewTransform;
			if (view && typeof view.x === "number" && typeof view.y === "number" && typeof view.scale === "number") {
				page.viewTransform = { x: view.x, y: view.y, scale: Math.min(Math.max(view.scale, 0.15), 4) };
			}
			const legacyMargin = source.background === "margin";
			if (["dots", "grid", "lines", "margin", "blank"].includes(source.background)) page.background = legacyMargin ? "lines" : source.background;
			page.marginEnabled = source.marginEnabled === true || legacyMargin;
			if (typeof source.backgroundColor === "string" && /^#[0-9a-f]{6}$/i.test(source.backgroundColor)) page.backgroundColor = source.backgroundColor;
			if (typeof source.lineColor === "string" && /^#[0-9a-f]{6}$/i.test(source.lineColor)) page.lineColor = source.lineColor;
			if (["small", "medium", "large"].includes(source.gridSize)) page.gridSize = source.gridSize;
			page.a4Guides = source.a4Guides === true;
			pages.push(page);
		}
		if (pages.length) doc.pages = pages;
	}
	doc.activePageId = doc.pages.some(page => page.id === raw.activePageId) ? raw.activePageId : doc.pages[0].id;
	const pageIds = new Set(doc.pages.map(page => page.id));
	const pageIdOf = (value: unknown): string => typeof value === "string" && pageIds.has(value) ? value : doc.activePageId;

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
				pageId: pageIdOf(s.pageId),
				type: s.type === "highlighter" ? "highlighter" : "pen",
				color: typeof s.color === "string" ? s.color : "#f8fafc",
				width: typeof s.width === "number" ? s.width : 2.5,
				style: (["ballpoint", "pencil", "fountain", "marker", "brush"] as string[]).includes(s.style) ? s.style : undefined,
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
				pageId: pageIdOf(s.pageId),
				kind: s.kind,
				x: s.x,
				y: s.y,
				w: s.w,
				h: s.h,
				color: typeof s.color === "string" ? s.color : "#e5e7eb",
				width: typeof s.width === "number" ? Math.min(Math.max(s.width, 1), 24) : 2.5,
				rotation: typeof s.rotation === "number" ? s.rotation : undefined,
				fill: typeof s.fill === "string" && /^#[0-9a-f]{6}$/i.test(s.fill) ? s.fill : undefined,
				fillOpacity: typeof s.fillOpacity === "number" ? Math.min(Math.max(s.fillOpacity, 0), 1) : 0
			});
		}
	}

	if (Array.isArray(raw.badges)) {
		for (const b of raw.badges) {
			if (typeof b?.x !== "number" || typeof b?.y !== "number") continue;
			const images: BadgeImage[] = [];
			const checklist: BadgeChecklistItem[] = [];
			if (Array.isArray(b.checklist)) {
				for (const item of b.checklist.slice(0, 100)) {
					const text = typeof item?.text === "string" ? item.text.trim().slice(0, 500) : "";
					const sketch = typeof item?.sketch === "string" && item.sketch.startsWith("data:image/") ? item.sketch : undefined;
					if (!text && !sketch) continue;
					checklist.push({
						id: typeof item.id === "string" && item.id ? item.id : genId("task_item"),
						text,
						sketch,
						done: item.done === true
					});
				}
			}
			if (Array.isArray(b.images)) {
				for (const image of b.images) {
					if (!image || typeof image.src !== "string" || !image.src.startsWith("data:image/")) continue;
					const w = typeof image.w === "number" ? Math.min(Math.max(image.w, 40), 560) : 220;
					const h = typeof image.h === "number" ? Math.min(Math.max(image.h, 40), 320) : 140;
					images.push({
						id: typeof image.id === "string" ? image.id : genId("badge_image"),
						name: typeof image.name === "string" ? image.name.slice(0, 160) : "Imagen",
						src: image.src,
						x: typeof image.x === "number" ? Math.min(Math.max(image.x, 0), Math.max(0, 560 - w)) : 24,
						y: typeof image.y === "number" ? Math.min(Math.max(image.y, 0), Math.max(0, 320 - h)) : 24,
						w,
						h
					});
				}
			}
			doc.badges.push({
				id: typeof b.id === "string" ? b.id : genId("badge"),
				pageId: pageIdOf(b.pageId),
				x: b.x,
				y: b.y,
				scale: typeof b.scale === "number" ? Math.min(Math.max(b.scale, 0.5), 3) : 1,
				tagId: String(b.tagId ?? "tag_star"),
				label: String(b.label ?? "⭐️ Importante"),
				title: typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : undefined,
				tooltip: typeof b.tooltip === "string" ? b.tooltip : undefined,
				sketch: typeof b.sketch === "string" && b.sketch.startsWith("data:image/") ? b.sketch : undefined,
				images: images.length ? images : undefined,
				checklist: checklist.length ? checklist : undefined,
				done: checklist.length ? checklist.every(item => item.done) : b.done === true
			});
		}
	}

	if (Array.isArray(raw.texts)) {
		for (const t of raw.texts) {
			if (typeof t?.x !== "number" || typeof t?.y !== "number") continue;
			doc.texts.push({
				id: typeof t.id === "string" ? t.id : genId("text"),
				pageId: pageIdOf(t.pageId),
				x: t.x,
				y: t.y,
				text: String(t.text ?? ""),
				fontSize: typeof t.fontSize === "number" ? t.fontSize : 18,
				color: typeof t.color === "string" ? t.color : "#f8fafc",
				bold: t.bold === true,
				italic: t.italic === true,
				underline: t.underline === true,
				strike: t.strike === true,
				highlight: typeof t.highlight === "string" ? t.highlight : undefined,
				runs: Array.isArray(t.runs) ? sanitizeRuns(t.runs) : undefined,
				align: t.align === "center" || t.align === "right" ? t.align : "left",
				stickyColor: typeof t.stickyColor === "string" ? t.stickyColor : undefined,
				w: typeof t.w === "number" ? Math.min(Math.max(t.w, 120), 900) : undefined,
				h: typeof t.h === "number" ? Math.min(Math.max(t.h, 34), 900) : undefined,
				fontFamily: isCanvasFont(t.fontFamily) ? t.fontFamily : "sans",
				autoWidth: t.autoWidth === true,
				rotation: typeof t.rotation === "number" ? t.rotation : undefined,
				variant: t.variant === "code" || t.variant === "math" ? t.variant : "text",
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
				pageId: pageIdOf(table.pageId),
				x: table.x, y: table.y,
				w: typeof table.w === "number" ? Math.min(Math.max(table.w, 220), 1400) : 520,
				h: typeof table.h === "number" ? Math.min(Math.max(table.h, 120), 1200) : 220,
				rows, cols, cells, header: table.header === true, headerColumn: table.headerColumn === true,
				title: typeof table.title === "string" ? table.title.trim().slice(0, 80) : undefined,
				rotation: typeof table.rotation === "number" ? table.rotation : undefined,
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
				pageId: pageIdOf(bookmark.pageId),
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
				pageId: pageIdOf(e.pageId),
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
				rotation: typeof e.rotation === "number" ? e.rotation : undefined,
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

	const legacyMargin = raw.background === "margin";
	if (raw.background === "grid" || raw.background === "lines" || raw.background === "blank" || legacyMargin) {
		doc.background = legacyMargin ? "lines" : raw.background;
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

	const activePage = doc.pages.find(page => page.id === doc.activePageId) ?? doc.pages[0];
	doc.marginEnabled = legacyMargin || (typeof raw.marginEnabled === "boolean"
		? raw.marginEnabled
		: activePage.marginEnabled);
	activePage.viewTransform = { ...doc.viewTransform };
	activePage.background = doc.background;
	activePage.marginEnabled = doc.marginEnabled;
	activePage.backgroundColor = doc.backgroundColor;
	activePage.lineColor = doc.lineColor;
	activePage.gridSize = doc.gridSize;
	activePage.a4Guides = doc.a4Guides;
	doc.version = DOC_VERSION;

	return doc;
}
