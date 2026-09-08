import { tr } from "./i18n";

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
	const firstPage = createDocumentPage(tr("Página {p0}", { p0: 1 }), defaults, "page_1");
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

/** What a badge is called when the stored document never said. */
const DEFAULT_BADGE_LABEL = "⭐️ Importante";

/** A JSON object whose fields have not been checked yet. */
type RawObject = Record<string, unknown>;

/** The object at `value` — an array does not count — or null. */
function asObject(value: unknown): RawObject | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RawObject : null;
}

/** The array at `value`, or an empty one, so callers can just iterate. */
function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

/** `value` when it is one of `allowed`, undefined otherwise. */
function asOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : undefined;
}

/** A `#rrggbb` colour, or undefined. */
function asHexColor(value: unknown): string | undefined {
	const text = asString(value);
	return text !== undefined && /^#[0-9a-f]{6}$/i.test(text) ? text : undefined;
}

/**
 * Text for a field a document may have stored as anything. A number or a
 * boolean reads back the way it was written; an object or an array falls back,
 * because "[object Object]" is not a label anybody wants to see on a board.
 */
function asText(value: unknown, fallback: string): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return fallback;
}

/** A list of positive numbers exactly `length` long, or undefined. */
function asSizes(value: unknown, length: number): number[] | undefined {
	if (!Array.isArray(value) || value.length !== length) return undefined;
	return value.every(v => typeof v === "number" && v > 0) ? value as number[] : undefined;
}

/**
 * Normalizes any parsed JSON (including legacy documents) into a valid
 * OneNoteDocument v10. Never throws: unknown/extra fields are dropped.
 *
 * Everything arrives as `unknown` and is read through the accessors above, so
 * a corrupt board can only ever produce defaults, never a crash mid-migration.
 */
export function migrateDocument(raw: unknown): OneNoteDocument {
	const doc = createEmptyDocument();
	const root = asObject(raw);
	if (!root) return doc;

	const rawPages = asArray(root.pages);
	if (rawPages.length > 0) {
		const pages: DocumentPage[] = [];
		for (let index = 0; index < rawPages.length; index++) {
			const source = asObject(rawPages[index]);
			if (!source) continue;
			const title = asString(source.title);
			const sourceId = asString(source.id);
			const page = createDocumentPage(
				title && title.trim() ? title.trim().slice(0, 80) : tr("Página {p0}", { p0: index + 1 }),
				{},
				sourceId ? sourceId : genId("page")
			);
			const view = asObject(source.viewTransform);
			const vx = asNumber(view?.x), vy = asNumber(view?.y), vscale = asNumber(view?.scale);
			if (vx !== undefined && vy !== undefined && vscale !== undefined) {
				page.viewTransform = { x: vx, y: vy, scale: Math.min(Math.max(vscale, 0.15), 4) };
			}
			const legacyMargin = source.background === "margin";
			const background = asOneOf(source.background, ["dots", "grid", "lines", "margin", "blank"] as const);
			if (background) page.background = legacyMargin ? "lines" : background;
			page.marginEnabled = source.marginEnabled === true || legacyMargin;
			page.backgroundColor = asHexColor(source.backgroundColor) ?? page.backgroundColor;
			page.lineColor = asHexColor(source.lineColor) ?? page.lineColor;
			page.gridSize = asOneOf(source.gridSize, ["small", "medium", "large"] as const) ?? page.gridSize;
			page.a4Guides = source.a4Guides === true;
			pages.push(page);
		}
		if (pages.length) doc.pages = pages;
	}
	const activeId = asString(root.activePageId);
	doc.activePageId = activeId !== undefined && doc.pages.some(page => page.id === activeId) ? activeId : doc.pages[0].id;
	const pageIds = new Set(doc.pages.map(page => page.id));
	const pageIdOf = (value: unknown): string => typeof value === "string" && pageIds.has(value) ? value : doc.activePageId;

	for (const entry of asArray(root.strokes)) {
		const s = asObject(entry);
		if (!s || !Array.isArray(s.points)) continue;
		const points: StrokePoint[] = [];
		for (const rawPoint of s.points) {
			const p = asObject(rawPoint);
			const x = asNumber(p?.x), y = asNumber(p?.y);
			if (x === undefined || y === undefined) continue;
			points.push({ x, y, p: asNumber(p?.p) ?? 0.5 });
		}
		if (points.length < 1) continue;
		doc.strokes.push({
			id: asString(s.id) ?? genId("stroke"),
			pageId: pageIdOf(s.pageId),
			type: s.type === "highlighter" ? "highlighter" : "pen",
			color: asString(s.color) ?? "#f8fafc",
			width: asNumber(s.width) ?? 2.5,
			style: asOneOf(s.style, ["ballpoint", "pencil", "fountain", "marker", "brush"] as const),
			points
		});
	}

	for (const entry of asArray(root.shapes)) {
		const s = asObject(entry);
		if (!s) continue;
		const x = asNumber(s.x), y = asNumber(s.y), w = asNumber(s.w), h = asNumber(s.h);
		if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
		const kind = asOneOf(s.kind, ["line", "arrow", "rectangle", "rounded-rectangle", "ellipse", "diamond", "triangle", "callout"] as const);
		if (!kind) continue;
		const width = asNumber(s.width);
		const fillOpacity = asNumber(s.fillOpacity);
		doc.shapes.push({
			id: asString(s.id) ?? genId("shape"),
			pageId: pageIdOf(s.pageId),
			kind,
			x,
			y,
			w,
			h,
			color: asString(s.color) ?? "#e5e7eb",
			width: width !== undefined ? Math.min(Math.max(width, 1), 24) : 2.5,
			rotation: asNumber(s.rotation),
			fill: asHexColor(s.fill),
			fillOpacity: fillOpacity !== undefined ? Math.min(Math.max(fillOpacity, 0), 1) : 0
		});
	}

	for (const entry of asArray(root.badges)) {
		const b = asObject(entry);
		const bx = asNumber(b?.x), by = asNumber(b?.y);
		if (!b || bx === undefined || by === undefined) continue;
		const images: BadgeImage[] = [];
		const checklist: BadgeChecklistItem[] = [];
		for (const rawItem of asArray(b.checklist).slice(0, 100)) {
			const item = asObject(rawItem);
			const text = asString(item?.text)?.trim().slice(0, 500) ?? "";
			const rawSketch = asString(item?.sketch);
			const sketch = rawSketch?.startsWith("data:image/") ? rawSketch : undefined;
			if (!text && !sketch) continue;
			const itemId = asString(item?.id);
			checklist.push({
				id: itemId ? itemId : genId("task_item"),
				text,
				sketch,
				done: item?.done === true
			});
		}
		for (const rawImage of asArray(b.images)) {
			const image = asObject(rawImage);
			const src = asString(image?.src);
			if (!image || src === undefined || !src.startsWith("data:image/")) continue;
			const rawW = asNumber(image.w), rawH = asNumber(image.h);
			const w = rawW !== undefined ? Math.min(Math.max(rawW, 40), 560) : 220;
			const h = rawH !== undefined ? Math.min(Math.max(rawH, 40), 320) : 140;
			const ix = asNumber(image.x), iy = asNumber(image.y);
			images.push({
				id: asString(image.id) ?? genId("badge_image"),
				name: asString(image.name)?.slice(0, 160) ?? "Imagen",
				src,
				x: ix !== undefined ? Math.min(Math.max(ix, 0), Math.max(0, 560 - w)) : 24,
				y: iy !== undefined ? Math.min(Math.max(iy, 0), Math.max(0, 320 - h)) : 24,
				w,
				h
			});
		}
		const scale = asNumber(b.scale);
		const title = asString(b.title);
		const sketch = asString(b.sketch);
		doc.badges.push({
			id: asString(b.id) ?? genId("badge"),
			pageId: pageIdOf(b.pageId),
			x: bx,
			y: by,
			scale: scale !== undefined ? Math.min(Math.max(scale, 0.5), 3) : 1,
			tagId: asText(b.tagId, "tag_star"),
			label: asText(b.label, DEFAULT_BADGE_LABEL),
			title: title && title.trim() ? title.trim().slice(0, 120) : undefined,
			tooltip: asString(b.tooltip),
			sketch: sketch?.startsWith("data:image/") ? sketch : undefined,
			images: images.length ? images : undefined,
			checklist: checklist.length ? checklist : undefined,
			done: checklist.length ? checklist.every(item => item.done) : b.done === true
		});
	}

	for (const entry of asArray(root.texts)) {
		const t = asObject(entry);
		const tx = asNumber(t?.x), ty = asNumber(t?.y);
		if (!t || tx === undefined || ty === undefined) continue;
		const w = asNumber(t.w), h = asNumber(t.h);
		doc.texts.push({
			id: asString(t.id) ?? genId("text"),
			pageId: pageIdOf(t.pageId),
			x: tx,
			y: ty,
			text: asText(t.text, ""),
			fontSize: asNumber(t.fontSize) ?? 18,
			color: asString(t.color) ?? "#f8fafc",
			bold: t.bold === true,
			italic: t.italic === true,
			underline: t.underline === true,
			strike: t.strike === true,
			highlight: asString(t.highlight),
			runs: Array.isArray(t.runs) ? sanitizeRuns(t.runs) : undefined,
			align: t.align === "center" || t.align === "right" ? t.align : "left",
			stickyColor: asString(t.stickyColor),
			w: w !== undefined ? Math.min(Math.max(w, 120), 900) : undefined,
			h: h !== undefined ? Math.min(Math.max(h, 34), 900) : undefined,
			fontFamily: isCanvasFont(t.fontFamily) ? t.fontFamily : "sans",
			autoWidth: t.autoWidth === true,
			rotation: asNumber(t.rotation),
			variant: t.variant === "code" || t.variant === "math" ? t.variant : "text",
			language: asString(t.language)?.slice(0, 32)
		});
	}

	for (const entry of asArray(root.tables)) {
		const table = asObject(entry);
		const tx = asNumber(table?.x), ty = asNumber(table?.y);
		if (!table || tx === undefined || ty === undefined) continue;
		const rawRows = asNumber(table.rows), rawCols = asNumber(table.cols);
		const rows = rawRows !== undefined ? Math.min(Math.max(Math.round(rawRows), 1), 30) : 3;
		const cols = rawCols !== undefined ? Math.min(Math.max(Math.round(rawCols), 1), 20) : 3;
		const sourceCells = asArray(table.cells);
		const cells = Array.from({ length: rows }, (_, row) => {
			const sourceRow = asArray(sourceCells[row]);
			return Array.from({ length: cols }, (_, col) => asText(sourceRow[col], ""));
		});
		const w = asNumber(table.w), h = asNumber(table.h);
		doc.tables.push({
			id: asString(table.id) ?? genId("table"),
			pageId: pageIdOf(table.pageId),
			x: tx, y: ty,
			w: w !== undefined ? Math.min(Math.max(w, 220), 1400) : 520,
			h: h !== undefined ? Math.min(Math.max(h, 120), 1200) : 220,
			rows, cols, cells, header: table.header === true, headerColumn: table.headerColumn === true,
			title: asString(table.title)?.trim().slice(0, 80),
			rotation: asNumber(table.rotation),
			colWidths: asSizes(table.colWidths, cols),
			rowHeights: asSizes(table.rowHeights, rows)
		});
	}

	for (const entry of asArray(root.bookmarks)) {
		const bookmark = asObject(entry);
		const bx = asNumber(bookmark?.x), by = asNumber(bookmark?.y);
		if (!bookmark || bx === undefined || by === undefined) continue;
		const scale = asNumber(bookmark.scale);
		doc.bookmarks.push({
			id: asString(bookmark.id) ?? genId("bookmark"),
			pageId: pageIdOf(bookmark.pageId),
			label: asString(bookmark.label)?.slice(0, 80) ?? "Sección",
			x: bx,
			y: by,
			scale: scale !== undefined ? Math.min(Math.max(scale, 0.15), 4) : 1
		});
	}

	doc.a4Guides = root.a4Guides === true;

	for (const entry of asArray(root.embeds)) {
		const e = asObject(entry);
		const ex = asNumber(e?.x), ey = asNumber(e?.y), src = asString(e?.src);
		if (!e || ex === undefined || ey === undefined || src === undefined) continue;
		const kind: EmbedKind = asOneOf(e.kind,
			["youtube", "web-video", "video", "audio", "epub", "image", "file", "note", "board", "chart"] as const) ?? "pdf";
		const provider = asOneOf(e.provider,
			["youtube", "tiktok", "instagram", "x", "vimeo", "dailymotion", "streamable", "loom", "facebook"] as const);
		const chart = asObject(e.chart);
		const chartData = asString(chart?.data);
		doc.embeds.push({
			id: asString(e.id) ?? genId("embed"),
			pageId: pageIdOf(e.pageId),
			kind,
			src,
			originalUrl: asString(e.originalUrl) ?? (kind === "youtube" ? src : undefined),
			provider: provider ?? (kind === "youtube" ? "youtube" : undefined),
			x: ex,
			y: ey,
			w: asNumber(e.w) ?? 640,
			h: asNumber(e.h) ?? 480,
			rotation: asNumber(e.rotation),
			chart: chart && chartData !== undefined
				? { ...chart, data: chartData, type: asOneOf(chart.type, ["bar", "line", "area", "pie", "scatter", "function"] as const) ?? "bar" }
				: undefined,
			page: asNumber(e.page),
			pdfMode: e.pdfMode === "pages" || e.pdfMode === "scroll" ? "pages" : "viewer",
			pages: asNumber(e.pages),
			captionSrc: asString(e.captionSrc)
		});
	}

	const vt = asObject(root.viewTransform);
	const vx = asNumber(vt?.x), vy = asNumber(vt?.y), vscale = asNumber(vt?.scale);
	if (vx !== undefined && vy !== undefined && vscale !== undefined) {
		doc.viewTransform = { x: vx, y: vy, scale: Math.min(Math.max(0.15, vscale), 4) };
	}

	const legacyMargin = root.background === "margin";
	const background = asOneOf(root.background, ["grid", "lines", "blank"] as const);
	if (background) doc.background = background;
	else if (legacyMargin) doc.background = "lines";

	doc.backgroundColor = asHexColor(root.backgroundColor) ?? doc.backgroundColor;
	doc.lineColor = asHexColor(root.lineColor) ?? doc.lineColor;
	doc.gridSize = asOneOf(root.gridSize, ["small", "medium", "large"] as const) ?? doc.gridSize;

	const activePage = doc.pages.find(page => page.id === doc.activePageId) ?? doc.pages[0];
	doc.marginEnabled = legacyMargin || (typeof root.marginEnabled === "boolean"
		? root.marginEnabled
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
