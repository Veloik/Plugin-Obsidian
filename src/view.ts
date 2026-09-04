import { FileView, Menu, Notice, Platform, TFile, WorkspaceLeaf, finishRenderMath, loadMathJax, loadPrism, renderMath, setIcon } from "obsidian";
import { AngleUnit, createCalculatorPanel } from "./calculator";
import { createRecorderPanel } from "./recorder";
import { toRenderableLatex } from "./asciimath";
import { MATH_GROUPS, insertMathSnippet } from "./math-palette";
import { buildSharePackage, importSharePackage as importShareArchive } from "./exchange";
import { TranslationSource, createTranslatorPanel } from "./translator";
import { createA4Pdf, getCanvasContentBounds } from "./pdf-export";
import { RasterImage, rasterizeMath } from "./dom-raster";
import type OneNotePlugin from "./main";
import { CanvasRenderer } from "./renderer";
import { CANVAS_FONTS, fontStack } from "./fonts";
import { LIST_MARK, LIST_PREFIX, ListKind, listKindOf, parseInline, planListToggle, runsFromInline, runsToMarked, runsToPlain } from "./rich-text";
import { BaseStyle, editableText, readRuns, renderRuns, selectOffsets, selectionOffsets, surroundSelection, unwrapCode } from "./rich-editor";
import { HistoryManager } from "./history";
import { PersistenceManager } from "./persistence";
import {
	Badge, CanvasFont, CanvasTable, DocumentPage, Embed, EmbedKind, OneNoteDocument, PenStyle, Shape, ShapeKind, Stroke, TextBox, ViewportBookmark,
	ChartData, createDocumentPage, createEmptyDocument, genId, migrateDocument
} from "./types";
import { clamp, cutStrokeAround, hexToRgba, hitTestStrokes, isLightColor, setColorAlpha } from "./tools";
import { EmbedHost, ImagePickModal, NoteOrBoardPickModal, PdfModeModal, PdfPickModal, VaultFilePickModal, VideoInsertModal, renderEmbedFrame } from "./embeds";
import { createNavigatorPanel, isBoardFile } from "./navigator";
import { recognizeFormula, recognizeImage } from "./ocr";
import { pickFormulaCandidate, recognizeInkFormula } from "./ink-math";
import { ChartEditorModal, DEFAULT_CHART, specFromTable } from "./charts";
import { HOVER_NOTE_BOARD_HEIGHT, HOVER_NOTE_BOARD_WIDTH, HoverNoteContent, HoverNoteModal } from "./hover-note";
import { InkEquationModal } from "./ink-equation";
import { AssistantAction, BoardUtility, createAssistantPet } from "./assistant";
import { EXPERIMENTAL } from "./features";
import { EraserMode, QUICK_TAGS, QuickTag, SelectionMode, ToolId, ToolbarHost, setEraserIcon, createBookmarksControl, createFocusModeControl, createNavigationControls, createPagesControl, createPanelSearch, createQuickTagsBar, createSettingsPanel, createToolbar, matchesPanelSearch, quickTagById } from "./ui";
import { BackgroundPattern, DEFAULT_BG_COLOR, DEFAULT_LINE_COLOR, GridSize } from "./types";
import { Locale, getLocale, tr } from "./i18n";

export const VIEW_TYPE_ONENOTE = "onenote-canvas-view";

const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const GRID_CELLS: Record<GridSize, number> = { small: 18, medium: 26, large: 40 };
const A4_SCENE_W = 794;
const A4_SCENE_H = 1123;
const TEXT_COLORS = ["#f8fafc", "#111827", "#38bdf8", "#ef4444", "#22c55e", "#a855f7", "#eab308"];
/** Tints for `==resaltado==` inside a text box: the same felt colours as the marker. */
const TEXT_HIGHLIGHTS = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#ddd6fe", "#a7f3d0", "#fed7aa"];
const DEFAULT_TEXT_HIGHLIGHT = TEXT_HIGHLIGHTS[0];

// ---------------------------------------------------------------------------
// Syntax highlighting without markup
// ---------------------------------------------------------------------------

/** One node of Prism's token tree: a literal run, or a typed span holding more. */
type PrismToken = string | { type: string; alias?: string | string[]; content: PrismToken | PrismToken[] };

/** Paints Prism's tokens as elements, so highlighted code never travels as HTML. */
function paintPrismTokens(parent: HTMLElement, tokens: PrismToken | PrismToken[]): void {
	for (const token of Array.isArray(tokens) ? tokens : [tokens]) {
		if (typeof token === "string") {
			parent.appendText(token);
			continue;
		}
		const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
		const span = parent.createSpan({ cls: ["token", token.type, ...aliases].filter(Boolean).join(" ") });
		paintPrismTokens(span, token.content);
	}
}

/** Enter inside a list item starts the next item; Enter on an empty item ends the list. Returns false when the line is not a list. */
function continueList(editor: HTMLTextAreaElement): boolean {
	const value = editor.value;
	const start = editor.selectionStart;
	const lineStart = value.lastIndexOf("\n", start - 1) + 1;
	const line = value.slice(lineStart, start);
	const kind = listKindOf(line);
	if (!kind) return false;
	const indent = /^\s*/.exec(line)?.[0] ?? "";
	const body = line.replace(LIST_PREFIX, "").trim();
	if (!body) {
		// Empty item: leave the list.
		editor.setRangeText("", lineStart, start, "end");
		return true;
	}
	let mark = LIST_MARK[kind];
	if (kind === "number") {
		const n = parseInt(/\d+/.exec(line)?.[0] ?? "0", 10);
		mark = `${n + 1}. `;
	}
	editor.setRangeText("\n" + indent + mark, start, editor.selectionEnd, "end");
	return true;
}

/** Board objects travel through the clipboard as text with this prefix, so they paste into any board. */
const CLIP_PREFIX = "notelens-clip:";
/** Remembers that this vault is used with a stylus, so fingers stop drawing. */
const PEN_SEEN_KEY = "notelens-pen-seen";
interface ClipboardPayload {
	notelens: 1;
	strokes: Stroke[];
	shapes: Shape[];
	badges: Badge[];
	texts: TextBox[];
	tables: CanvasTable[];
	embeds: Embed[];
}

/** Languages offered for code blocks: Prism id and label. */
const CODE_LANGUAGES: [string, string][] = [
	["plaintext", "Texto"], ["javascript", "JavaScript"], ["typescript", "TypeScript"], ["python", "Python"],
	["java", "Java"], ["c", "C"], ["cpp", "C++"], ["csharp", "C#"], ["go", "Go"], ["rust", "Rust"],
	["kotlin", "Kotlin"], ["swift", "Swift"], ["php", "PHP"], ["ruby", "Ruby"], ["sql", "SQL"],
	["bash", "Bash"], ["powershell", "PowerShell"], ["markup", "HTML / XML"], ["css", "CSS"], ["json", "JSON"],
	["yaml", "YAML"], ["markdown", "Markdown"], ["latex", "LaTeX"], ["matlab", "MATLAB"], ["r", "R"]
];

const LANGUAGE_ALIASES: Record<string, string> = {
	js: "javascript", jsx: "javascript", mjs: "javascript", ts: "typescript", tsx: "typescript", py: "python", py3: "python",
	sh: "bash", shell: "bash", zsh: "bash", "c++": "cpp", cc: "cpp", "c#": "csharp", cs: "csharp", yml: "yaml",
	tex: "latex", html: "markup", xml: "markup", svg: "markup", md: "markdown", ps1: "powershell", rb: "ruby",
	kt: "kotlin", rs: "rust", golang: "go", octave: "matlab", text: "plaintext", txt: "plaintext"
};

/** Maps user-written or fenced language names to a Prism id. */
function normalizeLanguage(raw: string | undefined): string {
	const key = (raw ?? "").trim().toLowerCase();
	if (!key) return "plaintext";
	return LANGUAGE_ALIASES[key] ?? key;
}

type RulerMode = "ruler" | "protractor";

interface SelectionResizeSnapshot {
	bounds: { x: number; y: number; w: number; h: number };
	strokes: Map<string, { points: { x: number; y: number }[]; width: number }>;
	shapes: Map<string, { x: number; y: number; w: number; h: number; width: number }>;
	badges: Map<string, { x: number; y: number; scale: number }>;
	texts: Map<string, { x: number; y: number; w: number; h: number }>;
	tables: Map<string, { x: number; y: number; w: number; h: number }>;
	embeds: Map<string, { x: number; y: number; w: number; h: number }>;
}

export class OneNoteCanvasView extends FileView implements ToolbarHost, EmbedHost {
	plugin: OneNotePlugin;
	override allowNoFile = false;
	data: OneNoteDocument = createEmptyDocument();

	private renderer!: CanvasRenderer;
	private history!: HistoryManager;
	private saver!: PersistenceManager;

	workspaceEl!: HTMLElement;
	stageEl!: HTMLElement;
	domLayerEl!: HTMLElement;

	// --- Tool state (ToolbarHost) ---
	currentTool: ToolId = "pen";
	shapeKind: ShapeKind = "rectangle";
	strokeColor = "#e5e7eb";
	highlighterColor = hexToRgba("#facc15", 0.5);
	strokeWidth = 2.5;
	strokeIntensity = 1;
	penStyle: PenStyle = "ballpoint";
	highlighterColorHex = "#facc15";
	highlighterWidth = 24;
	highlighterIntensity = 0.5;
	eraserSize = 10;
	eraserMode: EraserMode = "stroke";
	selectionMode: SelectionMode = "rect";
	private lassoPoints: { x: number; y: number }[] = [];
	private lassoEl: SVGSVGElement | null = null;
	private searchEl: HTMLElement | null = null;
	private searchHits: { id: string; x: number; y: number }[] = [];
	private searchIndex = -1;
	/** Last copied objects, so pasting works even when the system clipboard refuses text. */
	private clipboardPayload: ClipboardPayload | null = null;
	private lastPointerClient: { x: number; y: number } | null = null;
	private pasteCount = 0;
	textSize = 20;
	textColor = "#f8fafc";
	textFont: CanvasFont = "sans";
	shapeFillColor = "#38bdf8";
	shapeFillOpacity = 0.18;
	shapeFillEnabled = true;
	penColorHex = "#e5e7eb";
	/** Until the user picks a color, ink and text follow the page tone. */
	private penColorChosen = false;
	private textColorChosen = false;
	recentColors: string[] = [];
	activeBadgeTag: QuickTag | null = null;

	get background(): BackgroundPattern { return this.data.background; }
	get marginEnabled(): boolean { return this.data.marginEnabled || this.data.background === "margin"; }
	get backgroundColor(): string { return this.data.backgroundColor; }
	get lineColor(): string { return this.data.lineColor; }
	get gridSize(): GridSize { return this.data.gridSize ?? "medium"; }

	private belongsToActivePage(item: { pageId?: string }): boolean {
		return (item.pageId ?? this.data.activePageId) === this.data.activePageId;
	}

	private get pageStrokes(): Stroke[] { return this.data.strokes.filter(item => this.belongsToActivePage(item)); }
	private get pageShapes(): Shape[] { return this.data.shapes.filter(item => this.belongsToActivePage(item)); }
	private get pageBadges(): Badge[] { return this.data.badges.filter(item => this.belongsToActivePage(item)); }
	private get pageTexts(): TextBox[] { return this.data.texts.filter(item => this.belongsToActivePage(item)); }
	private get pageTables(): CanvasTable[] { return this.data.tables.filter(item => this.belongsToActivePage(item)); }
	private get pageEmbeds(): Embed[] { return this.data.embeds.filter(item => this.belongsToActivePage(item)); }

	/** A filtered document view used by bounds, minimap and single-page PDF export. */
	private activePageDocument(): OneNoteDocument {
		return {
			...this.data,
			strokes: this.pageStrokes,
			shapes: this.pageShapes,
			badges: this.pageBadges,
			texts: this.pageTexts,
			tables: this.pageTables,
			embeds: this.pageEmbeds,
			bookmarks: this.data.bookmarks.filter(item => this.belongsToActivePage(item))
		};
	}

	private syncActivePageMeta(): void {
		const page = this.data.pages.find(item => item.id === this.data.activePageId);
		if (!page) return;
		page.viewTransform = { ...this.data.viewTransform };
		page.background = this.data.background;
		page.marginEnabled = this.marginEnabled;
		page.backgroundColor = this.data.backgroundColor;
		page.lineColor = this.data.lineColor;
		page.gridSize = this.data.gridSize;
		page.a4Guides = this.data.a4Guides;
	}

	private applyPageMeta(page: DocumentPage): void {
		this.data.activePageId = page.id;
		this.data.viewTransform = { ...page.viewTransform };
		this.data.background = page.background === "margin" ? "lines" : page.background;
		this.data.marginEnabled = page.marginEnabled || page.background === "margin";
		this.data.backgroundColor = page.backgroundColor;
		this.data.lineColor = page.lineColor;
		this.data.gridSize = page.gridSize;
		this.data.a4Guides = page.a4Guides;
	}
	calculatorUnit: AngleUnit = "deg";
	private calculator: { toggle: () => void; isOpen: () => boolean } | null = null;
	private recorder: { toggle: () => void; isOpen: () => boolean } | null = null;
	private translator: { open: () => void; toggle: () => void; isOpen: () => boolean } | null = null;
	private navigator: { toggle: () => void; isOpen: () => boolean } | null = null;
	get currentPath(): string | null { return this.file?.path ?? null; }
	get translateFrom(): string { return this.plugin.settings.translateFrom; }
	get translateTo(): string { return this.plugin.settings.translateTo; }
	private mathPreviewEl: HTMLElement | null = null;

	get pluginDir(): string { return this.plugin.manifest.dir ?? "notelens"; }

	// --- Gesture state ---
	private pointers = new Map<number, { x: number; y: number }>();
	private isPanning = false;
	/** Set when a stylus barrel press started a pan, so its context menu is dropped. */
	private swallowNextCanvasMenu = false;
	/** The stylus currently on the glass, so a resting hand can be ignored. */
	private penPointerId: number | null = null;
	/** Whether a stylus has ever been used here; decides what a finger does. */
	private penEverSeen = false;
	private panStart = { x: 0, y: 0 };
	private pinchStart: { d: number; cx: number; cy: number; vt: { x: number; y: number; scale: number } } | null = null;
	private isDrawing = false;
	private currentStroke: Stroke | null = null;
	private renderedPoints = 0;
	private isShaping = false;
	private currentShape: Shape | null = null;
	private isErasing = false;
	/** Erasing with the back of the stylus, whatever tool is selected. */
	private tipErasing = false;
	private erasedAny = false;
	private eraseHistoryPushed = false;
	private assistant: { toggle: () => void; isOpen: () => boolean; destroy: () => void; refresh: () => void } | null = null;
	private hoverTooltipEl: HTMLElement | null = null;
	private hoverTooltipBadgeId: string | null = null;
	private hoverTooltipHideTimer: number | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private marginEl: HTMLElement | null = null;
	private textPlacementHintEl: HTMLElement | null = null;
	private eraserCursorEl: HTMLElement | null = null;
	private textMeasurer: CanvasRenderingContext2D | null = null;
	/** Obsidian's Prism instance once loaded; code blocks repaint when it arrives. */
	private prism: { tokenize: (code: string, grammar: unknown) => PrismToken[]; languages: Record<string, unknown> } | null = null;
	private focusModeEnabled = false;
	private activeTextEditor: HTMLTextAreaElement | HTMLElement | null = null;
	private activeTextSourceEl: HTMLElement | null = null;
	private a4GuidesEl: HTMLElement | null = null;
	private miniMapEl: HTMLElement | null = null;
	private miniMapVisible = false;
	private miniMapCanvas: HTMLCanvasElement | null = null;
	private miniMapBounds: { x: number; y: number; w: number; h: number } | null = null;
	private rulerEl: HTMLElement | null = null;
	private rulerState = { visible: false, x: 180, y: 260, length: 520, angle: 0, mode: "ruler" as RulerMode };

	// --- Selection state (runtime only, not persisted) ---
	private selStrokes = new Set<string>();
	private selShapes = new Set<string>();
	private selBadges = new Set<string>();
	private selTexts = new Set<string>();
	private selEmbeds = new Set<string>();
	private selTables = new Set<string>();
	private selectionBoxEl: HTMLElement | null = null;
	private rubberEl: HTMLElement | null = null;
	private rubberStart: { x: number; y: number } | null = null;
	private isSelecting = false;

	constructor(leaf: WorkspaceLeaf, plugin: OneNotePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	override getViewType(): string { return VIEW_TYPE_ONENOTE; }
	override getDisplayText(): string { return this.file ? this.file.basename : tr("Pizarra NoteLens"); }
	override getIcon(): string { return "pencil"; }

	// ------------------------------------------------------------------
	// Lifecycle
	// ------------------------------------------------------------------

	override async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("onenote-workspace-host");

		this.workspaceEl = container.createDiv({ cls: "onenote-workspace" });
		this.workspaceEl.setAttr("data-bg", this.data.background);
		try {
			this.penEverSeen = this.app.loadLocalStorage(PEN_SEEN_KEY) === true;
		} catch { this.penEverSeen = false; }
		this.syncToolCursor();

		// DOM layer first, ink canvas on top: ink draws OVER pdf pages, images
		// and text boxes — like writing on paper (OneNote behavior).
		this.stageEl = this.workspaceEl.createDiv({ cls: "onenote-stage" });
		this.domLayerEl = this.stageEl.createDiv({ cls: "onenote-dom-layer" });

		this.renderer = new CanvasRenderer(this.workspaceEl);

		this.history = new HistoryManager(
			() => this.data,
			(doc) => {
				this.data = doc;
				this.clearSelection(false);
				this.renderAll();
				this.updateBackground();
				(this.workspaceEl as any).__refreshPages?.();
				(this.workspaceEl as any).__refreshBookmarks?.();
				this.refreshTagSummary();
				this.save();
			},
			() => this.saver?.currentPayload() ?? null
		);
		this.saver = new PersistenceManager(this.app, () => this.file);
		this.applySettings();
		this.plugin.openBoards.add(this);

		this.buildChrome();
		void loadMathJax();
		void loadPrism().then(prism => {
			this.prism = prism;
			for (const tb of this.pageTexts) {
				if (tb.variant !== "code") continue;
				const el = this.domLayerEl.querySelector(`[data-id="${tb.id}"]`) as HTMLElement | null;
				if (el && el !== this.activeTextSourceEl) {
					this.paintTextContent(el, tb);
					this.syncFittedSize(el, tb);
					this.attachBoxChrome(el, tb);
				}
			}
		}).catch(() => { /* highlighting is optional */ });
		this.setupEvents();
		this.registerDomEvent(document, "visibilitychange", () => {
			if (document.visibilityState === "hidden") {
				this.syncActivePageMeta();
				void this.saver?.flush(this.data);
			}
		});
		this.registerDomEvent(window, "pagehide", () => {
			this.syncActivePageMeta();
			void this.saver?.flush(this.data);
		});
		this.registerDomEvent(document, "fullscreenchange", () => {
			this.workspaceEl.toggleClass("is-fullscreen", this.isFullscreen());
			this.handleResize();
			this.syncToolbar();
		});

		this.resizeObserver = new ResizeObserver(() => this.handleResize());
		this.resizeObserver.observe(this.workspaceEl);

		this.handleResize();
		this.renderAll();
		this.updateBackground();
		this.renderMiniMap();
	}

	override async onClose(): Promise<void> {
		this.plugin.openBoards.delete(this);
		this.commitTextEditor();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.syncActivePageMeta();
		if (this.saver) await this.saver.flush(this.data);
	}

	override async onLoadFile(file: TFile): Promise<void> {
		await super.onLoadFile(file);
		this.file = file;
		try {
			const content = await this.app.vault.read(file);
			if (content && content.trim().startsWith("{")) {
				this.data = migrateDocument(JSON.parse(content));
			} else {
				this.data = createEmptyDocument(this.plugin.documentDefaults());
			}
		} catch (e) {
			console.error("NoteLens: error loading file", e);
			this.data = createEmptyDocument();
		}
		this.history?.clear();
		if (this.renderer) {
			this.renderAll();
			this.updateBackground();
			(this.workspaceEl as any).__refreshPages?.();
			(this.workspaceEl as any).__refreshBookmarks?.();
			this.refreshTagSummary();
		}
	}

	override async onUnloadFile(file: TFile): Promise<void> {
		if (this.file?.path === file.path && this.saver) {
			this.syncActivePageMeta();
			await this.saver.flush(this.data);
		}
		await super.onUnloadFile(file);
	}

	/**
	 * On a phone, Obsidian floats its own navigation bar over the bottom of the
	 * view and the system keeps a home indicator under it. Everything the board
	 * anchors to its bottom edge reads this, so nothing ends up underneath. The
	 * bar is measured when it is there and assumed otherwise, because a plugin
	 * cannot count on the class names of the app around it.
	 */
	private updateSafeInsets(): void {
		if (!this.workspaceEl) return;
		const host = this.workspaceEl.parentElement ?? this.workspaceEl;
		if (!Platform.isMobile) {
			host.style.removeProperty("--nl-safe-bottom");
			return;
		}
		const navbar = document.querySelector(".mobile-navbar") as HTMLElement | null;
		const measured = navbar?.offsetHeight ?? 0;
		// A tablet with no bar underneath keeps every pixel of its board.
		const reserved = measured > 0 ? measured + 10 : (Platform.isPhone ? 68 : 0);
		host.style.setProperty("--nl-safe-bottom", `calc(${reserved}px + env(safe-area-inset-bottom, 0px))`);
	}

	private handleResize(): void {
		if (!this.workspaceEl || !this.renderer) return;
		this.updateSafeInsets();
		const rect = this.workspaceEl.getBoundingClientRect();
		this.renderer.resize(rect.width, rect.height);
		this.applyStageTransform();
		this.renderInk();
		this.updateMarginLinePosition();
		// Shrinking to a phone-sized pane with several panels open: keep the one used last.
		if (rect.width <= 700 && this.lastOpenedPanel) this.closeOtherPanelsIfNarrow(this.lastOpenedPanel);
	}

	// ------------------------------------------------------------------
	// Rendering
	// ------------------------------------------------------------------

	/** Ink-only refresh: PDFs, videos and an open text editor stay untouched. */
	private renderInk(): void {
		if (!this.renderer) return;
		this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
		this.renderMiniMap();
	}

	/** Full rebuild of ink and objects; only for structural document changes. */
	renderAll(): void {
		if (!this.renderer || !this.domLayerEl) return;
		this.applyStageTransform();
		this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
		this.renderDomLayer();
		this.renderA4Guides();
		this.renderMiniMap();
	}

	private renderDomLayer(): void {
		this.domLayerEl.empty();
		for (const b of this.pageBadges) this.renderBadge(b);
		for (const t of this.pageTexts) this.renderTextBox(t);
		for (const table of this.pageTables) this.renderTable(table);
		for (const e of this.pageEmbeds) renderEmbedFrame(this, this.domLayerEl, e);
	}

	private applyStageTransform(): void {
		const { x, y, scale } = this.data.viewTransform;
		this.stageEl.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
		this.updateBackgroundPosition();
		this.renderA4Guides();
		this.renderMiniMap();
	}

	private updateBackground(): void {
		const ws = this.workspaceEl;
		ws.setAttr("data-bg", this.data.background);
		ws.setAttr("data-bg-tone", isLightColor(this.data.backgroundColor) ? "light" : "dark");
		ws.style.backgroundColor = this.data.backgroundColor || DEFAULT_BG_COLOR;

		const tone = isLightColor(this.data.backgroundColor) ? 0.2 : 0.22;
		const line = hexToRgba(this.data.lineColor || DEFAULT_LINE_COLOR, tone);
		const glow = isLightColor(this.data.backgroundColor)
			? "linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(255, 255, 255, 0))"
			: "linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(255, 255, 255, 0))";
		switch (this.data.background) {
			case "dots":
				ws.style.backgroundImage = `radial-gradient(${line} 1px, transparent 1.35px), ${glow}`;
				break;
			case "grid":
				ws.style.backgroundImage =
					`linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px), ${glow}`;
				break;
			case "lines":
			case "margin":
				ws.style.backgroundImage = `linear-gradient(${line} 1px, transparent 1px), ${glow}`;
				break;
			default:
				ws.setCssStyles({ backgroundImage: "none" });
		}

		this.updateMarginLine();
		this.updateBackgroundPosition();
		this.applyContrastDefaults();
	}

	/** Default ink and text were light-on-dark; on a light page they vanished. */
	private applyContrastDefaults(): void {
		const light = isLightColor(this.data.backgroundColor);
		if (!this.penColorChosen) {
			this.penColorHex = light ? "#1f2937" : "#e5e7eb";
			this.updateDerivedColors();
		}
		if (!this.textColorChosen) this.textColor = light ? "#111827" : "#f8fafc";
		this.syncToolbar();
	}

	/** The paper margin stays near the useful left edge instead of drifting through the page while panning. */
	private updateMarginLine(): void {
		if (this.marginEnabled) {
			if (!this.marginEl && this.workspaceEl) {
				this.marginEl = this.workspaceEl.createDiv({ cls: "onenote-margin-line" });
			}
		} else {
			this.marginEl?.remove();
			this.marginEl = null;
		}
	}

	private updateBackgroundPosition(): void {
		const { x, y, scale } = this.data.viewTransform;
		const size = GRID_CELLS[this.data.gridSize ?? "medium"] * scale;
		if (this.data.background === "blank") {
			this.workspaceEl.setCssStyles({ backgroundSize: "", backgroundPosition: "" });
		} else if (this.data.background === "lines" || this.data.background === "margin") {
			this.workspaceEl.style.backgroundSize = `100% ${size}px, 100% 100%`;
			this.workspaceEl.style.backgroundPosition = `${x}px ${y}px, 0 0`;
		} else if (this.data.background === "grid") {
			this.workspaceEl.style.backgroundSize = `${size}px ${size}px, ${size}px ${size}px, 100% 100%`;
			this.workspaceEl.style.backgroundPosition = `${x}px ${y}px, ${x}px ${y}px, 0 0`;
		} else {
			this.workspaceEl.style.backgroundSize = `${size}px ${size}px, 100% 100%`;
			this.workspaceEl.style.backgroundPosition = `${x}px ${y}px, 0 0`;
		}
		this.updateMarginLinePosition();
	}

	private updateMarginLinePosition(): void {
		if (!this.marginEl) return;
		const inset = Math.round(clamp(this.workspaceEl.clientWidth * 0.075, 56, 92));
		this.marginEl.style.left = `${inset}px`;
	}

	// ------------------------------------------------------------------
	// Smart ruler, A4 guides and minimap
	// ------------------------------------------------------------------

	private createRuler(): void {
		this.rulerEl = this.workspaceEl.createDiv({ cls: "notelens-smart-ruler hidden" });
		const marks = this.rulerEl.createDiv({ cls: "notelens-ruler-marks" });
		for (let mark = 0; mark <= 50; mark++) {
			const tick = marks.createDiv({ cls: `notelens-ruler-tick ${mark % 5 === 0 ? "major" : ""}` });
			if (mark % 5 === 0 && mark < 50) tick.setAttr("data-label", String(mark / 5));
		}
		const label = this.rulerEl.createDiv({ cls: "notelens-ruler-label" });
		const modeBtn = label.createEl("button", { cls: "notelens-ruler-mode" });
		modeBtn.title = tr("Alternar regla y transportador");
		modeBtn.onclick = (event) => {
			event.stopPropagation();
			this.rulerState.mode = this.rulerState.mode === "ruler" ? "protractor" : "ruler";
			this.renderRuler();
		};
		// Keep the close control in the central label strip. The protractor uses a
		// clip-path, so a corner control can otherwise be visually clipped away.
		const closeRuler = label.createEl("button", { cls: "notelens-embed-close notelens-ruler-close" });
		setIcon(closeRuler, "x");
		closeRuler.title = tr("Ocultar la regla");
		closeRuler.setAttr("aria-label", tr("Ocultar la regla"));
		closeRuler.addEventListener("pointerdown", (event) => event.stopPropagation());
		closeRuler.onclick = (event) => { event.stopPropagation(); this.toggleRuler(); };
		const rotate = this.rulerEl.createDiv({ cls: "notelens-ruler-rotate" });
		rotate.title = tr("Girar regla");
		rotate.addEventListener("pointerdown", (event) => this.startRulerRotate(event));
		this.rulerEl.addEventListener("pointerdown", (event) => this.startRulerDrag(event));
		this.renderRuler();
	}

	private renderRuler(): void {
		if (!this.rulerEl) return;
		this.rulerEl.toggleClass("hidden", !this.rulerState.visible);
		this.rulerEl.toggleClass("is-protractor", this.rulerState.mode === "protractor");
		this.rulerEl.style.left = `${this.rulerState.x}px`;
		this.rulerEl.style.top = `${this.rulerState.y}px`;
		this.rulerEl.style.width = `${this.rulerState.length}px`;
		const isProtractor = this.rulerState.mode === "protractor";
		this.rulerEl.style.transformOrigin = isProtractor ? "50% 100%" : "50% 50%";
		this.rulerEl.style.transform = `translateY(${isProtractor ? "-100%" : "-50%"}) rotate(${this.rulerState.angle}deg)`;
		const mode = this.rulerEl.querySelector(".notelens-ruler-mode") as HTMLElement | null;
		if (mode) {
			const angle = ((Math.round(this.rulerState.angle) % 360) + 360) % 360;
			mode.setText(isProtractor ? tr("Ángulos {p0}°", { p0: angle }) : tr("Regla"));
			mode.setAttr("aria-label", mode.textContent || "Regla");
		}
	}

	toggleRuler(): void {
		this.rulerState.visible = !this.rulerState.visible;
		this.renderRuler();
		this.syncToolbar();
	}

	isRulerVisible(): boolean { return this.rulerState.visible; }

	private startRulerDrag(event: PointerEvent): void {
		if ((event.target as HTMLElement).closest("button, .notelens-ruler-rotate")) return;
		if (event.pointerType !== "touch" && this.currentTool !== "select") return;
		event.stopPropagation();
		event.preventDefault();
		const startX = event.clientX;
		const startY = event.clientY;
		const originX = this.rulerState.x;
		const originY = this.rulerState.y;
		const onMove = (move: PointerEvent) => {
			this.rulerState.x = originX + move.clientX - startX;
			this.rulerState.y = originY + move.clientY - startY;
			this.renderRuler();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	private startRulerRotate(event: PointerEvent): void {
		event.stopPropagation();
		event.preventDefault();
		const rect = this.workspaceEl.getBoundingClientRect();
		const centerX = rect.left + this.rulerState.x + this.rulerState.length / 2;
		const centerY = rect.top + this.rulerState.y;
		const onMove = (move: PointerEvent) => {
			let angle = Math.atan2(move.clientY - centerY, move.clientX - centerX) * 180 / Math.PI;
			if (this.rulerState.mode === "protractor") angle = Math.round(angle / 15) * 15;
			this.rulerState.angle = angle;
			this.renderRuler();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	private getDrawingSceneCoords(clientX: number, clientY: number): { x: number; y: number } {
		if (!this.rulerState.visible || !["pen", "highlighter"].includes(this.currentTool)) {
			return this.getSceneCoords(clientX, clientY);
		}
		const rect = this.workspaceEl.getBoundingClientRect();
		const px = clientX - rect.left;
		const py = clientY - rect.top;
		const radians = this.rulerState.angle * Math.PI / 180;
		const dx = Math.cos(radians);
		const dy = Math.sin(radians);
		const toPointerX = px - this.rulerState.x;
		const toPointerY = py - this.rulerState.y;
		const projected = clamp(toPointerX * dx + toPointerY * dy, 0, this.rulerState.length);
		const snapX = this.rulerState.x + projected * dx;
		const snapY = this.rulerState.y + projected * dy;
		if (Math.hypot(px - snapX, py - snapY) > 18) return this.getSceneCoords(clientX, clientY);
		return this.getSceneCoords(rect.left + snapX, rect.top + snapY);
	}

	getMiniMapVisible(): boolean { return this.miniMapVisible; }

	toggleFullscreen(): void {
		const target = this.containerEl;
		if (document.fullscreenElement) {
			void document.exitFullscreen().catch(() => { /* already left */ });
		} else if (target.requestFullscreen) {
			void target.requestFullscreen().catch(() => new Notice(tr("Obsidian no permite pantalla completa aquí.")));
		} else {
			new Notice(tr("Este dispositivo no permite pantalla completa."));
		}
	}

	isFullscreen(): boolean { return document.fullscreenElement === this.containerEl; }

	/** Region capture for the translator: drag a rectangle, then read everything inside it. */
	captureBoardText(langCode: string, onProgress: (message: string) => void): Promise<string> {
		return new Promise((resolve, reject) => {
			this.commitTextEditor();
			const overlay = this.workspaceEl.createDiv({ cls: "notelens-capture-overlay" });
			const box = overlay.createDiv({ cls: "notelens-capture-box" });
			overlay.createDiv({ cls: "notelens-capture-hint", text: tr("Arrastra para elegir la zona que quieres leer. Esc cancela.") });
			let start: { x: number; y: number } | null = null;
			const wsRect = () => this.workspaceEl.getBoundingClientRect();
			const finish = (rect: { x: number; y: number; w: number; h: number } | null) => {
				overlay.remove();
				window.removeEventListener("keydown", onKey, { capture: true });
				if (!rect) { resolve(""); return; }
				this.readRegion(rect, langCode, onProgress).then(resolve, reject);
			};
			const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); } };
			window.addEventListener("keydown", onKey, { capture: true });
			overlay.addEventListener("pointerdown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const r = wsRect();
				start = { x: e.clientX - r.left, y: e.clientY - r.top };
				box.setCssStyles({ display: "block", left: `${start.x}px`, top: `${start.y}px`, width: "0px", height: "0px" });
			});
			overlay.addEventListener("pointermove", (e) => {
				if (!start) return;
				const r = wsRect();
				const x = e.clientX - r.left, y = e.clientY - r.top;
				box.style.left = `${Math.min(x, start.x)}px`; box.style.top = `${Math.min(y, start.y)}px`;
				box.style.width = `${Math.abs(x - start.x)}px`; box.style.height = `${Math.abs(y - start.y)}px`;
			});
			overlay.addEventListener("pointerup", (e) => {
				e.stopPropagation();
				if (!start) return;
				const r = wsRect();
				const x = e.clientX - r.left, y = e.clientY - r.top;
				const a = this.getSceneCoords(r.left + Math.min(x, start.x), r.top + Math.min(y, start.y));
				const b = this.getSceneCoords(r.left + Math.max(x, start.x), r.top + Math.max(y, start.y));
				start = null;
				if (b.x - a.x < 8 || b.y - a.y < 8) { finish(null); return; }
				finish({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
			});
		});
	}

	/** Text typed in boxes inside the region, plus OCR over a rendering of images, PDF pages and ink. */
	async readRegion(rect: { x: number; y: number; w: number; h: number }, langCode: string, onProgress: (message: string) => void): Promise<string> {
		const within = (x: number, y: number, w: number, h: number) => x < rect.x + rect.w && x + w > rect.x && y < rect.y + rect.h && y + h > rect.y;
		const readingFormula = langCode === "__formula__";
		const formulaBoxes = readingFormula ? this.pageTexts
			.filter(t => within(t.x, t.y, t.w ?? 200, t.h ?? 40) && t.text.trim())
			.filter(t => t.variant === "math"
				|| /[=^_√∫Σ]|\\(?:frac|sqrt|sum|int)|\b(?:sin|cos|tan|log|lim)\b/i.test(t.text)
				|| /[A-Za-z0-9)\]][ \t]*[+\-/*][ \t]*[A-Za-z0-9([]/.test(t.text))
			.sort((a, b) => Math.abs(a.y - b.y) < Math.max(a.fontSize, b.fontSize) * 0.8 ? a.x - b.x : a.y - b.y)
			: [];
		const directFormula = formulaBoxes.map(t => t.text.trim()).join(" ");
		const typed = readingFormula ? [] : this.pageTexts
			.filter(t => t.variant !== "math" && within(t.x, t.y, t.w ?? 200, t.h ?? 40) && t.text.trim())
			.map(t => t.text.trim());
		if (!readingFormula) {
			for (const table of this.pageTables) {
				if (within(table.x, table.y, table.w, table.h)) typed.push(table.cells.map(r => r.filter(c => c.trim()).join(" · ")).filter(Boolean).join("\n"));
			}
		}

		// Rasterise the region: page colour, then images and PDF pages, then ink.
		const scale = clamp(1800 / Math.max(rect.w, rect.h), 1, 4);
		const canvas = createEl("canvas");
		canvas.width = Math.ceil(rect.w * scale);
		canvas.height = Math.ceil(rect.h * scale);
		const ctx = canvas.getContext("2d");
		if (!ctx) return typed.join("\n\n");
		// Formula OCR always receives black ink on white paper. The previous dark
		// board capture inverted the useful pixels and often produced no result.
		ctx.fillStyle = readingFormula ? "#ffffff" : isLightColor(this.data.backgroundColor) ? "#ffffff" : this.data.backgroundColor;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
		const ws = this.workspaceEl.getBoundingClientRect();
		const vt = this.data.viewTransform;
		let painted = 0;
		let paintedMedia = 0;
		for (const el of Array.from(this.domLayerEl.querySelectorAll<HTMLCanvasElement | HTMLImageElement>("canvas.notelens-pdf-canvas, img.notelens-embed-img"))) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			const x = (r.left - ws.left - vt.x) / vt.scale;
			const y = (r.top - ws.top - vt.y) / vt.scale;
			const w = r.width / vt.scale;
			const h = r.height / vt.scale;
			if (!within(x, y, w, h)) continue;
			try { ctx.drawImage(el, x, y, w, h); painted++; paintedMedia++; } catch { /* cross-origin image */ }
		}
		const dark = !isLightColor(this.data.backgroundColor);
		const regionStrokes = this.pageStrokes.filter(s => s.type !== "highlighter" && s.points.some(p => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h));
		for (const s of this.pageStrokes) {
			const pts = s.points;
			if (!pts.some(p => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h)) continue;
			if (readingFormula && s.type === "highlighter") continue;
			ctx.strokeStyle = readingFormula ? "#111111" : s.type === "highlighter" ? "rgba(250, 204, 21, 0.35)" : dark ? "#f8fafc" : "#111111";
			ctx.lineWidth = Math.max(2, s.width);
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.beginPath();
			ctx.moveTo(pts[0].x, pts[0].y);
			for (let i = 0; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
			if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y); else ctx.lineTo(pts[0].x + 0.1, pts[0].y);
			ctx.stroke();
			painted++;
		}
		let recognized = "";
		if (readingFormula) {
			const vector = recognizeInkFormula(regionStrokes.map(stroke => ({
				width: stroke.width,
				points: stroke.points.map(point => ({ x: point.x - rect.x, y: point.y - rect.y }))
			})));
			const candidates: { source: string; bonus?: number }[] = [];
			if (directFormula) candidates.push({ source: directFormula, bonus: 14 });
			if (vector.source) candidates.push({ source: vector.source, bonus: vector.confidence * 9 });
			// Photographs/PDF pages need OCR. Pure board ink only needs it when the
			// geometry pass is uncertain, keeping the common route near-instant.
			if (paintedMedia > 0 || (!directFormula && regionStrokes.length > 0 && vector.confidence < 0.78)) {
				onProgress(paintedMedia > 0 ? tr("Leyendo la fórmula de la imagen…") : tr("Verificando símbolos dudosos…"));
				const ocr = await recognizeFormula(canvas, onProgress);
				if (ocr) candidates.push({ source: ocr, bonus: 1.5 });
			}
			recognized = pickFormulaCandidate(candidates);
			onProgress(recognized ? (directFormula ? "Fórmula recuperada desde la pizarra." : vector.detail) : "");
		} else if (painted > 0) {
			onProgress(tr("Preparando el reconocimiento…"));
			recognized = await recognizeImage(canvas, langCode, onProgress);
		}
		const parts = [...typed, recognized].filter(p => p.trim());
		onProgress(parts.length ? tr("Texto capturado.") : "");
		return parts.join("\n\n");
	}

	toggleMiniMap(): void {
		this.miniMapVisible = !this.miniMapVisible;
		try { this.app.saveLocalStorage("notelens-minimap", this.miniMapVisible); } catch { /* storage may be unavailable */ }
		this.miniMapEl?.toggleClass("hidden", !this.miniMapVisible);
		this.renderMiniMap();
		this.syncToolbar();
	}

	/** Tool defaults and behaviour switches from the plugin settings tab. */
	/**
	 * Re-reads the settings on an open board, so changing them in the settings
	 * tab takes effect without closing and reopening the whiteboard.
	 */

	/** Language the visible interface was built with, to notice a change. */
	private chromeLocale: Locale = getLocale();

	/**
	 * Builds every control around the canvas. Kept apart from onOpen so that
	 * changing the language can rebuild it without reopening the board.
	 */
	private buildChrome(): void {
		createToolbar(this, this.workspaceEl);
		createQuickTagsBar(this.workspaceEl, (tag) => this.onPickTag(tag), () => this.toggleTagSummary());
		createSettingsPanel(this, this.workspaceEl);
		createNavigationControls(this, this.workspaceEl);
		if (this.assistantWanted()) this.assistant = createAssistantPet(this, this.workspaceEl);
		createBookmarksControl(this, this.workspaceEl);
		createPagesControl(this, this.workspaceEl);
		createFocusModeControl(this, this.workspaceEl);
		this.calculator = createCalculatorPanel(this, this.workspaceEl);
		this.recorder = createRecorderPanel(this, this.workspaceEl);
		this.translator = createTranslatorPanel(this, this.workspaceEl);
		this.navigator = createNavigatorPanel(this, this.workspaceEl);
		this.createMiniMap();
		this.createRuler();
		this.chromeLocale = getLocale();
	}

	/**
	 * Throws the controls away and builds them again in the current language.
	 * The stage and the ink canvas are kept, so the drawing itself never moves.
	 */
	private rebuildChrome(): void {
		this.assistant?.destroy();
		this.assistant = null;
		for (const child of Array.from(this.workspaceEl.children)) {
			if (child.classList.contains("onenote-stage")) continue;
			if (child.classList.contains("onenote-canvas")) continue;
			child.remove();
		}
		this.buildChrome();
		this.syncToolbar();
		this.handleResize();
		this.renderMiniMap();
	}

	refreshFromSettings(): void {
		if (!this.workspaceEl) return;
		// A language change rewrites every label, so the controls are rebuilt
		// rather than patched one by one.
		if (this.chromeLocale !== getLocale()) {
			this.applySettings();
			this.rebuildChrome();
			return;
		}
		this.applySettings();
		this.syncToolbar();
		this.updateBackground();
		const wanted = this.assistantWanted();
		if (wanted && !this.assistant) {
			this.assistant = createAssistantPet(this, this.workspaceEl);
		} else if (!wanted && this.assistant) {
			this.assistant.destroy();
			this.assistant = null;
		} else {
			this.assistant?.refresh();
		}
	}

	private applySettings(): void {
		const s = this.plugin.settings;
		this.strokeWidth = s.penWidth;
		this.penStyle = s.penStyle ?? "ballpoint";
		if (s.penColor !== "auto") { this.penColorHex = s.penColor; this.penColorChosen = true; }
		this.highlighterColorHex = s.highlighterColor;
		this.highlighterWidth = s.highlighterWidth;
		this.highlighterIntensity = s.highlighterOpacity;
		this.textSize = s.textSize;
		this.textFont = s.defaultTextFont ?? "sans";
		this.calculatorUnit = s.calculatorDegrees ? "deg" : "rad";
		this.updateDerivedColors();
		this.workspaceEl.toggleClass("is-compact", s.compactUi);
		this.workspaceEl.toggleClass("hide-quick-tags", !s.showQuickTags);
	}

	private createMiniMap(): void {
		try {
			const stored = this.app.loadLocalStorage("notelens-minimap") as boolean | null;
			this.miniMapVisible = stored === null ? this.plugin.settings.showMinimap : stored;
		} catch { this.miniMapVisible = this.plugin.settings.showMinimap; }
		const wrap = this.workspaceEl.createDiv({ cls: "notelens-minimap" });
		wrap.toggleClass("hidden", !this.miniMapVisible);
		const header = wrap.createDiv({ cls: "notelens-minimap-header" });
		setIcon(header.createSpan({ cls: "notelens-minimap-icon" }), "map");
		header.createSpan({ cls: "notelens-minimap-title", text: tr("Mapa") });
		const closeBtn = header.createEl("button", { cls: "notelens-embed-close" });
		setIcon(closeBtn, "x");
		closeBtn.title = tr("Ocultar el mapa");
		closeBtn.onclick = () => this.toggleMiniMap();
		const canvas = wrap.createEl("canvas");
		canvas.width = 400;
		canvas.height = 240;
		canvas.setAttr("aria-label", tr("Minimapa de la pizarra"));
		// Click jumps there; dragging pans the page live.
		const toScene = (event: PointerEvent) => {
			const bounds = canvas.getBoundingClientRect();
			const map = this.miniMapBounds!;
			return { x: map.x + (event.clientX - bounds.left) / bounds.width * map.w, y: map.y + (event.clientY - bounds.top) / bounds.height * map.h };
		};
		canvas.addEventListener("pointerdown", (event) => {
			event.stopPropagation();
			event.preventDefault();
			if (!this.miniMapBounds) return;
			let moved = false;
			const centerOn = (pt: { x: number; y: number }) => {
				const rect = this.workspaceEl.getBoundingClientRect();
				const vt = this.data.viewTransform;
				vt.x = rect.width / 2 - pt.x * vt.scale;
				vt.y = rect.height / 2 - pt.y * vt.scale;
				this.applyStageTransform();
				this.renderer.renderAll(this.pageStrokes, this.pageShapes, vt);
			};
			const onMove = (ev: PointerEvent) => { moved = true; centerOn(toScene(ev)); };
			const onUp = (ev: PointerEvent) => {
				window.removeEventListener("pointermove", onMove, { capture: true });
				window.removeEventListener("pointerup", onUp, { capture: true });
				if (moved) { this.syncToolbar(); this.save(); }
				else { const pt = toScene(ev); this.panToScene(pt.x, pt.y); }
			};
			// Capture phase, because the minimap itself stops pointer events from bubbling.
			window.addEventListener("pointermove", onMove, { capture: true });
			window.addEventListener("pointerup", onUp, { capture: true });
		});
		for (const type of ["pointerdown", "pointerup", "dblclick"]) wrap.addEventListener(type, (e) => e.stopPropagation());
		wrap.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
		this.miniMapEl = wrap;
		this.miniMapCanvas = canvas;
	}

	private renderMiniMap(): void {
		const canvas = this.miniMapCanvas;
		if (!canvas || !this.workspaceEl || !this.miniMapVisible) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const rect = this.workspaceEl.getBoundingClientRect();
		const viewport = {
			x: -this.data.viewTransform.x / this.data.viewTransform.scale,
			y: -this.data.viewTransform.y / this.data.viewTransform.scale,
			w: rect.width / this.data.viewTransform.scale,
			h: rect.height / this.data.viewTransform.scale
		};
		const content = getCanvasContentBounds(this.activePageDocument(), viewport);
		// Show the content and the viewport together, keep the aspect ratio
		// (no squashed shapes) and never zoom in so far that a lone note fills the map.
		const union = {
			x: Math.min(content.x, viewport.x), y: Math.min(content.y, viewport.y),
			w: Math.max(content.x + content.w, viewport.x + viewport.w) - Math.min(content.x, viewport.x),
			h: Math.max(content.y + content.h, viewport.y + viewport.h) - Math.min(content.y, viewport.y)
		};
		const pad = Math.max(60, Math.max(union.w, union.h) * 0.06);
		let mapBounds = { x: union.x - pad, y: union.y - pad, w: union.w + pad * 2, h: union.h + pad * 2 };
		const aspect = canvas.width / canvas.height;
		if (mapBounds.w / mapBounds.h < aspect) {
			const w = mapBounds.h * aspect;
			mapBounds = { ...mapBounds, x: mapBounds.x - (w - mapBounds.w) / 2, w };
		} else {
			const h = mapBounds.w / aspect;
			mapBounds = { ...mapBounds, y: mapBounds.y - (h - mapBounds.h) / 2, h };
		}
		this.miniMapBounds = mapBounds;
		const sx = canvas.width / mapBounds.w;
		const sy = canvas.height / mapBounds.h;
		const mapX = (x: number) => (x - mapBounds.x) * sx;
		const mapY = (y: number) => (y - mapBounds.y) * sy;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		// Page-coloured ground with a faint dot grid, so the map reads like a small copy of the board.
		const light = isLightColor(this.data.backgroundColor);
		ctx.fillStyle = this.data.backgroundColor || DEFAULT_BG_COLOR;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = light ? "rgba(15, 23, 42, 0.14)" : "rgba(226, 232, 240, 0.12)";
		for (let gx = 12; gx < canvas.width; gx += 24) for (let gy = 12; gy < canvas.height; gy += 24) ctx.fillRect(gx, gy, 1.5, 1.5);

		const rounded = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => {
			ctx.beginPath();
			if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 2); else ctx.rect(x, y, w, h);
			ctx.fillStyle = fill;
			ctx.fill();
			if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
		};
		for (const shape of this.pageShapes) {
			rounded(mapX(Math.min(shape.x, shape.x + shape.w)), mapY(Math.min(shape.y, shape.y + shape.h)), Math.max(2, Math.abs(shape.w) * sx), Math.max(2, Math.abs(shape.h) * sy), shape.fill ? hexToRgba(shape.fill, 0.35) : "rgba(0,0,0,0)", shape.color);
		}
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const stroke of this.pageStrokes) {
			if (stroke.points.length < 2) continue;
			ctx.beginPath();
			ctx.strokeStyle = stroke.color;
			ctx.lineWidth = Math.max(stroke.type === "highlighter" ? 4 : 2, stroke.width * Math.min(sx, sy));
			ctx.moveTo(mapX(stroke.points[0].x), mapY(stroke.points[0].y));
			for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(mapX(stroke.points[i].x), mapY(stroke.points[i].y));
			ctx.stroke();
		}
		for (const t of this.pageTexts) {
			const el = this.domLayerEl.querySelector(`[data-id="${t.id}"]`) as HTMLElement | null;
			const w = el?.offsetWidth || t.w || 200;
			const h = el?.offsetHeight || t.h || 40;
			const fill = t.stickyColor ? hexToRgba(t.stickyColor, 0.9) : t.variant === "code" ? "rgba(125, 211, 252, 0.45)" : t.variant === "math" ? "rgba(167, 139, 250, 0.55)" : light ? "rgba(15, 23, 42, 0.3)" : "rgba(226, 232, 240, 0.5)";
			const edge = t.stickyColor ? "rgba(113, 87, 15, 0.8)" : t.variant === "code" ? "#7dd3fc" : t.variant === "math" ? "#c4b5fd" : light ? "rgba(15, 23, 42, 0.7)" : "rgba(241, 245, 249, 0.9)";
			rounded(mapX(t.x), mapY(t.y), Math.max(6, w * sx), Math.max(4, h * sy), fill, edge);
		}
		for (const table of this.pageTables) rounded(mapX(table.x), mapY(table.y), Math.max(6, table.w * sx), Math.max(4, table.h * sy), "rgba(56, 189, 248, 0.3)", "#38bdf8");
		for (const em of this.pageEmbeds) rounded(mapX(em.x), mapY(em.y), Math.max(6, em.w * sx), Math.max(4, em.h * sy), "rgba(148, 163, 184, 0.4)", "#cbd5e1");
		for (const b of this.pageBadges) {
			ctx.beginPath();
			ctx.arc(mapX(b.x) + 4, mapY(b.y) + 4, 4, 0, Math.PI * 2);
			ctx.fillStyle = quickTagById(b.tagId).color;
			ctx.fill();
			ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
			ctx.lineWidth = 1;
			ctx.stroke();
		}
		// Viewport frame: a translucent window with a crisp edge.
		const vx = mapX(viewport.x), vy = mapY(viewport.y), vw = viewport.w * sx, vh = viewport.h * sy;
		ctx.fillStyle = "rgba(56, 189, 248, 0.12)";
		ctx.fillRect(vx, vy, vw, vh);
		ctx.strokeStyle = "#38bdf8";
		ctx.lineWidth = 2;
		ctx.strokeRect(vx + 1, vy + 1, Math.max(2, vw - 2), Math.max(2, vh - 2));
	}

	private renderA4Guides(): void {
		if (!this.data.a4Guides || !this.stageEl || !this.workspaceEl) {
			this.a4GuidesEl?.addClass("hidden");
			return;
		}
		if (!this.a4GuidesEl) this.a4GuidesEl = this.stageEl.createDiv({ cls: "notelens-a4-guides" });
		this.a4GuidesEl.removeClass("hidden");
		this.a4GuidesEl.empty();
		const rect = this.workspaceEl.getBoundingClientRect();
		const vt = this.data.viewTransform;
		const left = -vt.x / vt.scale;
		const top = -vt.y / vt.scale;
		const right = left + rect.width / vt.scale;
		const bottom = top + rect.height / vt.scale;
		const startX = Math.floor(left / A4_SCENE_W) * A4_SCENE_W;
		const startY = Math.floor(top / A4_SCENE_H) * A4_SCENE_H;
		for (let x = startX; x < right + A4_SCENE_W; x += A4_SCENE_W) {
			for (let y = startY; y < bottom + A4_SCENE_H; y += A4_SCENE_H) {
				const page = this.a4GuidesEl.createDiv({ cls: "notelens-a4-page" });
				page.style.left = `${x}px`;
				page.style.top = `${y}px`;
				page.style.width = `${A4_SCENE_W}px`;
				page.style.height = `${A4_SCENE_H}px`;
			}
		}
	}

	toggleA4Guides(): void {
		this.history.push();
		this.data.a4Guides = !this.data.a4Guides;
		this.renderA4Guides();
		this.syncToolbar();
		this.save();
	}

	getA4GuidesEnabled(): boolean { return this.data.a4Guides; }

	// ------------------------------------------------------------------
	// Events
	// ------------------------------------------------------------------

	private setupEvents(): void {
		this.registerDomEvent(this.workspaceEl, "pointerdown", (e) => this.onPointerDown(e));
		this.registerDomEvent(this.workspaceEl, "pointerdown", () => this.hideTextPlacementHint(), { capture: true });
		this.registerDomEvent(window, "pointermove", (e) => this.onPointerMove(e));
		this.registerDomEvent(window, "pointerup", (e) => this.onPointerUp(e));
		this.registerDomEvent(window, "pointercancel", (e) => this.onPointerUp(e));

		// A touch that lands on the board belongs to the board. Obsidian reads
		// swipes across the app to open its sidebars and its own menus, and one
		// of those starting inside a stroke means the drawing is interrupted by
		// a panel. The gesture stops here instead of reaching the app around us.
		for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
			this.registerDomEvent(this.workspaceEl, type as "touchstart", (e: TouchEvent) => {
				// Typing in a box needs the app's own handling of the caret.
				const target = e.target as HTMLElement | null;
				if (target?.closest("input, textarea, [contenteditable='true']")) return;
				e.stopPropagation();
			});
		}

		this.registerDomEvent(this.workspaceEl, "wheel", (e) => this.onWheel(e), { passive: false });

		this.registerDomEvent(this.workspaceEl, "contextmenu", (e) => {
			if ((e.target as HTMLElement).closest(".onenote-placed-badge, .onenote-textbox, .notelens-embed, .notelens-pdf-stack, .notelens-loose-image")) return;
			e.preventDefault();
			// The barrel button of a stylus pans; it must not also open the menu.
			if (this.swallowNextCanvasMenu) {
				this.swallowNextCanvasMenu = false;
				return;
			}
			this.showCanvasMenu(e);
		});

		this.registerDomEvent(window, "keydown", (e) => this.onKeyDown(e));
		this.registerDomEvent(window, "paste", (e) => void this.onPaste(e));
		this.registerDomEvent(this.workspaceEl, "dblclick", (e) => this.onDoubleClick(e));
		this.registerDomEvent(this.workspaceEl, "pointerleave", () => {
			this.hideTextPlacementHint();
			this.hideEraserCursor();
		});
	}

	private showCanvasMenu(e: MouseEvent): void {
		const pt = this.getSceneCoords(e.clientX, e.clientY);
		const menu = new Menu();

		menu.addItem(item => item
			.setTitle(tr("Cuadro de texto aquí"))
			.setIcon("type")
			.onClick(() => this.createTextBoxAt(pt.x, pt.y)));

		menu.addItem(item => item
			.setTitle(tr("Nota adhesiva aquí"))
			.setIcon("sticky-note")
			.onClick(() => this.createStickyNoteAt(pt.x, pt.y)));

		menu.addItem(item => item
			.setTitle(tr("Tabla aquí"))
			.setIcon("table-2")
			.onClick(() => this.insertTableAt(pt.x, pt.y)));

		menu.addItem(item => item
			.setTitle(tr("Bloque de código aquí"))
			.setIcon("code-2")
			.onClick(() => this.createTextBoxAt(pt.x, pt.y, undefined, "code")));

		menu.addItem(item => item
			.setTitle(tr("Dibujar forma"))
			.setIcon("shapes")
			.onClick(() => this.setTool("shape")));

		menu.addItem(item => item
			.setTitle(tr("Insertar PDF"))
			.setIcon("file-text")
			.onClick(() => this.insertPdf()));

		menu.addItem(item => item
			.setTitle(tr("Insertar vídeo"))
			.setIcon("play-circle")
			.onClick(() => this.insertVideo()));

		menu.addItem(item => item
			.setTitle(tr("Insertar imagen"))
			.setIcon("image-plus")
			.onClick(() => this.insertImage()));

		menu.addItem(item => item
			.setTitle(tr("Adjuntar archivo de la bóveda"))
			.setIcon("paperclip")
			.onClick(() => this.insertFile()));

		menu.addItem(item => item
			.setTitle(tr("Subir archivo desde el dispositivo"))
			.setIcon("upload")
			.onClick(() => this.uploadFileFromDevice()));

		menu.addSeparator();

		menu.addItem(item => item
			.setTitle(tr("Seleccionar"))
			.setIcon("mouse-pointer-2")
			.onClick(() => this.setTool("select")));

		menu.addItem(item => item
			.setTitle(tr("Lápiz"))
			.setIcon("pencil")
			.onClick(() => this.setTool("pen")));

		menu.addSeparator();

		menu.addItem(item => item
			.setTitle(tr("Restablecer vista"))
			.setIcon("maximize")
			.onClick(() => this.resetView()));

		if (this.pageStrokes.length || this.pageShapes.length || this.pageBadges.length || this.pageTexts.length || this.pageTables.length || this.pageEmbeds.length) {
			menu.addItem(item => item
				.setTitle(tr("Limpiar pizarra"))
				.setIcon("trash-2")
				.onClick(() => this.clearCanvas()));
		}

		menu.showAtMouseEvent(e);
	}

	/** Paste images from the clipboard straight onto the canvas. */
	private async onPaste(e: ClipboardEvent): Promise<void> {
		if (e.defaultPrevented) return;
		if (this.app.workspace.getActiveViewOfType(OneNoteCanvasView) !== this) return;
		const target = e.target as HTMLElement | null;
		if (target && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

		// Objects copied from a board (this one or another vault window).
		const text = e.clipboardData?.getData("text/plain") ?? "";
		if (text.startsWith(CLIP_PREFIX)) {
			e.preventDefault();
			try { this.pasteObjects(JSON.parse(text.slice(CLIP_PREFIX.length)) as ClipboardPayload); }
			catch (err) { console.error("NoteLens: paste failed", err); new Notice(tr("No se pudo pegar la selección.")); }
			return;
		}

		const files = e.clipboardData?.files;
		const img = files && files.length ? Array.from(files).find(f => f.type.startsWith("image/")) : undefined;
		if (!img) {
			if (!text.trim() && this.clipboardPayload) { e.preventDefault(); this.pasteObjects(this.clipboardPayload); return; }
			if (text.trim()) {
				// A path, a wikilink or an obsidian:// address to something in this
				// vault comes in as the card that names it, not as its own address.
				const linked = this.vaultFileFromText(text);
				if (linked) {
					e.preventDefault();
					this.clearSelection(false);
					this.insertVaultFile(linked, this.pasteTarget(320, 150));
					this.pasteCount++;
					return;
				}
				if (/^([a-zA-Z]:[\\/]|\/\/|file:\/\/)/.test(text.trim()) && /\.[a-z0-9]{2,5}$/i.test(text.trim())) {
					new Notice(tr("Ese archivo está fuera de la bóveda, así que se pega como texto."), 4000);
				}
				// Plain text from anywhere becomes a text box under the pointer.
				e.preventDefault();
				this.history.push();
				this.clearSelection(false);
				const tb: TextBox = { id: genId("text"), pageId: this.data.activePageId, x: 0, y: 0, text: text.trim(), fontSize: this.textSize, color: this.textColor, fontFamily: this.textFont, variant: "text", autoWidth: true, h: 48 };
				tb.w = this.measureAutoWidth(tb);
				const at = this.pasteTarget(tb.w, tb.h ?? 48);
				tb.x = at.x;
				tb.y = at.y;
				this.data.texts.push(tb);
				this.renderTextBox(tb);
				this.selTexts.add(tb.id);
				this.renderSelectionBox();
				this.save();
			}
			return;
		}
		e.preventDefault();

		try {
			const buf = await img.arrayBuffer();
			const ext = (img.type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
			const fileName = `notelens-img-${Date.now()}.${ext}`;

			let path = fileName;
			try {
				path = await (this.app.fileManager as any).getAvailablePathForAttachment(fileName, this.file?.path ?? "");
			} catch { /* fall back to vault root */ }

			const parent = path.split("/").slice(0, -1).join("/");
			if (parent && !this.app.vault.getAbstractFileByPath(parent)) {
				await this.app.vault.createFolder(parent).catch(() => { /* already exists */ });
			}

			const tfile = await this.app.vault.createBinary(path, buf);
			this.history.push();
			const c = this.getViewportCenterScene();
			const embed: Embed = {
				id: genId("embed"), pageId: this.data.activePageId, kind: "image", src: tfile.path,
				x: c.x - 240, y: c.y - 180, w: 480, h: 0
			};
			this.data.embeds.push(embed);
			renderEmbedFrame(this, this.domLayerEl, embed);
			this.save();
			new Notice(tr("Imagen pegada en la pizarra"));
		} catch (err) {
			console.error("NoteLens: paste failed", err);
			new Notice(tr("NoteLens: no se pudo pegar la imagen."));
		}
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (this.app.workspace.getActiveViewOfType(OneNoteCanvasView) !== this) return;
		const target = e.target as HTMLElement | null;
		if (target && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

		if (e.key === "Escape" && this.currentTool === "place_badge") {
			this.activeBadgeTag = null;
			this.setTool("pen");
			return;
		}

		const key = e.key.toLowerCase();
		if ((e.ctrlKey || e.metaKey) && key === "z") {
			e.preventDefault();
			if (e.shiftKey) this.redo(); else this.undo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && key === "y") {
			e.preventDefault();
			this.redo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && key === "a") {
			e.preventDefault();
			this.selectAll();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && key === "f") {
			e.preventDefault();
			this.openSearch();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && (key === "c" || key === "x")) {
			if (this.hasSelection()) {
				e.preventDefault();
				this.copySelection(key === "x");
			}
			return;
		}
		if ((e.ctrlKey || e.metaKey) && key === "d") {
			if (this.hasSelection()) {
				e.preventDefault();
				this.duplicateSelection();
			}
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;

		if (e.key === "Delete" || e.key === "Backspace") {
			if (this.hasSelection()) {
				e.preventDefault();
				this.deleteSelection();
			}
			return;
		}
		const nudge: Record<string, [number, number]> = {
			ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
		};
		if (nudge[e.key] && this.hasSelection()) {
			e.preventDefault();
			const step = e.shiftKey ? 10 : 1;
			if (!e.repeat) this.history.push();
			this.moveSelectionBy(nudge[e.key][0] * step, nudge[e.key][1] * step);
			this.save();
			return;
		}
		if (e.key === "Escape") {
			if (this.focusModeEnabled) {
				this.toggleFocusMode();
				return;
			}
			this.clearSelection();
			(this.workspaceEl as any).__closePenPanel?.();
			this.hideFormatBar();
			return;
		}

		if (key === "l") { this.setSelectionMode("lasso"); return; }
		const map: Record<string, ToolId> = {
			v: "select", m: "hand", p: "pen", h: "highlighter", e: "eraser", t: "text", s: "shape"
		};
		if (map[key]) {
			if (map[key] === "select") this.setSelectionMode("rect"); else this.setTool(map[key]);
		}
	}

	/** Double-click with the selection tool picks the topmost ink or shape. */
	private onDoubleClick(e: MouseEvent): void {
		if (this.currentTool !== "select") return;
		const target = e.target as HTMLElement;
		if (target.closest(".onenote-ribbon-dock, .notelens-insert-dock, .notelens-document-dock, .onenote-quick-tags, .notelens-pen-panel, .notelens-settings-panel, .notelens-settings-btn, .notelens-navigation-controls, .notelens-bookmarks-dock, .notelens-pages-dock, .notelens-focus-toggle")) return;
		e.preventDefault();
		const id = target.closest("[data-id]")?.getAttribute("data-id");
		const pt = this.getSceneCoords(e.clientX, e.clientY);
		this.selectAt(pt, id);
		if (!id && !this.hasSelection()) this.createTextBoxAt(pt.x, pt.y);
	}

	private selectAt(pt: { x: number; y: number }, id?: string | null): void {
		this.clearSelection(false);
		if (id) {
			if (this.data.badges.some(b => b.id === id)) this.selBadges.add(id);
			else if (this.data.texts.some(t => t.id === id)) this.selTexts.add(id);
			else if (this.data.tables.some(table => table.id === id)) this.selTables.add(id);
			else if (this.data.embeds.some(embed => embed.id === id)) this.selEmbeds.add(id);
		} else {
			const strokes = this.pageStrokes;
			const strokeIdx = hitTestStrokes(strokes, pt.x, pt.y, 9);
			if (strokeIdx >= 0) this.selStrokes.add(strokes[strokeIdx].id);
			else {
				const shape = [...this.pageShapes].reverse().find(item => this.pointHitsShape(item, pt.x, pt.y, 8));
				if (shape) this.selShapes.add(shape.id);
			}
		}
		this.renderSelectionBox();
	}

	private onWheel(e: WheelEvent): void {
		e.preventDefault();
		const vt = this.data.viewTransform;

		// Plain wheel scrolls the page; Shift turns it sideways. Ctrl/Cmd (and
		// trackpad pinch, which arrives as a ctrl-wheel) zooms around the cursor.
		// The settings tab can make the plain wheel zoom instead.
		if (!e.ctrlKey && !e.metaKey && !this.plugin.settings.wheelZooms) {
			const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.workspaceEl.clientHeight : 1;
			let dx = e.deltaX * unit;
			let dy = e.deltaY * unit;
			if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }
			vt.x -= dx;
			vt.y -= dy;
			this.applyStageTransform();
			this.renderer.renderAll(this.pageStrokes, this.pageShapes, vt);
			this.save();
			return;
		}

		const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
		const rect = this.workspaceEl.getBoundingClientRect();
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		const newScale = clamp(vt.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
		vt.x = mouseX - (mouseX - vt.x) * (newScale / vt.scale);
		vt.y = mouseY - (mouseY - vt.y) * (newScale / vt.scale);
		vt.scale = newScale;

		this.applyStageTransform();
		this.renderer.renderAll(this.pageStrokes, this.pageShapes, vt);
		this.syncToolbar();
		this.save();
	}

	getSceneCoords(clientX: number, clientY: number): { x: number; y: number } {
		const rect = this.workspaceEl.getBoundingClientRect();
		const vt = this.data.viewTransform;
		return {
			x: (clientX - rect.left - vt.x) / vt.scale,
			y: (clientY - rect.top - vt.y) / vt.scale
		};
	}

	/**
	 * Top-left corner for a new object of the given size: the viewport centre,
	 * stepped diagonally until it no longer overlaps an existing object, so
	 * a note, a code block and a table inserted in a row all stay visible.
	 */
	private getInsertionPoint(w: number, h: number): { x: number; y: number } {
		const c = this.getViewportCenterScene();
		const measured = (item: { id: string; x: number; y: number; w?: number; h?: number }) => {
			const el = this.domLayerEl.querySelector(`[data-id="${item.id}"]`) as HTMLElement | null;
			return { x: item.x, y: item.y, w: item.w ?? el?.offsetWidth ?? 260, h: item.h ?? el?.offsetHeight ?? 60 };
		};
		const rects = [...this.pageTexts, ...this.pageTables, ...this.pageEmbeds].map(measured);
		let x = c.x - w / 2;
		let y = c.y - h / 2;
		const overlaps = () => rects.some(r => x < r.x + r.w + 12 && x + w + 12 > r.x && y < r.y + r.h + 12 && y + h + 12 > r.y);
		if (!overlaps()) return { x, y };
		// Prefer a free spot the user can see: sweep rings around the centre inside the viewport.
		const view = this.workspaceEl.getBoundingClientRect();
		const topLeft = this.getSceneCoords(view.left + 24, view.top + 170);
		const bottomRight = this.getSceneCoords(view.right - 24, view.bottom - 70);
		const inView = () => x >= topLeft.x && y >= topLeft.y && x + w <= bottomRight.x && y + h <= bottomRight.y;
		const startX = x, startY = y;
		const stepX = w / 2 + 12, stepY = h / 2 + 12;
		for (let ring = 1; ring <= 8; ring++) {
			for (let dy = -ring; dy <= ring; dy++) {
				for (let dx = -ring; dx <= ring; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
					x = startX + dx * stepX;
					y = startY + dy * stepY;
					if (inView() && !overlaps()) return { x, y };
				}
			}
		}
		x = startX; y = startY;
		for (let i = 0; i < 12 && overlaps(); i++) { x += 40; y += 40; }
		return { x, y };
	}

	private getViewportCenterScene(): { x: number; y: number } {
		const rect = this.workspaceEl.getBoundingClientRect();
		return this.getSceneCoords(rect.left + rect.width / 2, rect.top + rect.height / 2);
	}

	// ------------------------------------------------------------------
	// Pointer gestures (pan, pinch, ink, erase)
	// ------------------------------------------------------------------

	private onPointerDown(e: PointerEvent): void {
		if (e.pointerType === "pen") {
			this.rememberPen();
			this.penPointerId = e.pointerId;
		}
		// A hand resting on the screen while the pen writes is not a gesture.
		if (e.pointerType === "touch" && this.penIsDown()) return;
		this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (this.pointers.size === 2) {
			this.startPinch();
			return;
		}
		if (this.pointers.size > 2) return;

		// Close transient UI when the canvas itself is clicked.
		if (e.target === this.workspaceEl || e.target === this.renderer.canvas) {
			(this.workspaceEl as any).__closePenPanel?.();
			this.hideFormatBar();
		}

		// The page is user-select: none, and Chromium does not move focus away
		// from an editor when such an area is pressed. Any press that reaches
		// here is on the page (docks and editors stop propagation), so end
		// whatever is being typed: a text box or a table cell.
		const wasEditing = !!this.activeTextEditor;
		const active = document.activeElement as HTMLElement | null;
		if (active && active !== e.target && this.workspaceEl.contains(active)
			&& (active.isContentEditable || active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
			active.blur();
		}
		if (this.activeTextEditor) this.commitTextEditor();

		// Palm rejection, but only for someone who actually holds a stylus: a
		// finger draws until a pen has touched this vault, and pans from then on.
		// The hand tool drags the board with whatever is touching it — a stylus
		// included — and the barrel button of a pen does the same without leaving
		// the tool you are drawing with.
		const barrelPan = e.pointerType === "pen" && e.button === 2;
		if ((e.pointerType === "touch" && !this.fingerDraws())
			|| e.button === 1 || barrelPan
			|| (e.button === 0 && (this.currentTool === "hand" || e.altKey))) {
			// A barrel press also asks for the context menu; the drag wins.
			if (barrelPan) this.swallowNextCanvasMenu = true;
			this.startPan(e);
			return;
		}
		// The back of a stylus is its eraser (button 5), whatever tool is selected.
		const tipErase = e.pointerType === "pen" && e.button === 5;
		if (e.button !== 0 && !tipErase) return;

		const pt = this.getSceneCoords(e.clientX, e.clientY);

		if (tipErase || this.currentTool === "eraser") {
			this.isErasing = true;
			this.tipErasing = tipErase;
			// A finger has no hover, so the rubber is only ever drawn once it is
			// touching: place it here rather than waiting for the first move.
			this.updateEraserCursor(e);
			this.eraserCursorEl?.addClass("is-active");
			this.erasedAny = false;
			this.eraseHistoryPushed = false;
			this.eraseAt(pt.x, pt.y);
			return;
		}

		// Select tool: drag inside the selection moves it; otherwise rubber-band.
		if (this.currentTool === "select") {
			if (e.altKey) { this.startPan(e); return; }
			if (this.hasSelection() && this.selectionBounds()?.contains(pt.x, pt.y)) {
				this.startSelectionDrag(e);
				return;
			}
			this.isSelecting = true;
			this.rubberStart = pt;
			if (this.selectionMode === "lasso") {
				this.lassoPoints = [pt];
				this.lassoEl = createSvg("svg", { cls: "onenote-lasso" });
				this.lassoEl.createSvg("polygon");
				this.domLayerEl.appendChild(this.lassoEl);
			} else {
				this.rubberEl = this.domLayerEl.createDiv({ cls: "onenote-rubberband" });
				this.positionRubber(pt, pt);
			}
			return;
		}

		if (this.currentTool === "place_badge" && this.activeBadgeTag) {
			this.createBadgeAt(pt.x, pt.y, this.activeBadgeTag);
			return;
		}

		if (this.currentTool === "text") {
			this.hideTextPlacementHint();
			// Cancelling pointerdown stops the browser's own focus change,
			// which otherwise blurred the freshly focused editor immediately.
			// A finger is left alone: cancelling its press is what stops a phone
			// from raising its keyboard for the box that just appeared.
			if (e.pointerType !== "touch") e.preventDefault();
			// Like OneNote: the first click outside only finishes the edit.
			if (wasEditing) return;
			this.createTextBoxAt(pt.x, pt.y);
			return;
		}

		if (this.currentTool === "shape") {
			this.history.push();
			this.isShaping = true;
			this.currentShape = {
				id: genId("shape"), pageId: this.data.activePageId, kind: this.shapeKind, x: pt.x, y: pt.y, w: 0, h: 0,
				color: this.derivedColorFor("pen"), width: Math.max(1.5, this.strokeWidth),
				fill: this.isFillableShape(this.shapeKind) && this.shapeFillEnabled ? this.shapeFillColor : undefined,
				fillOpacity: this.isFillableShape(this.shapeKind) && this.shapeFillEnabled ? this.shapeFillOpacity : 0
			};
			this.data.shapes.push(this.currentShape);
			this.save();
			return;
		}

		if (this.currentTool === "pen" || this.currentTool === "highlighter") {
			this.history.push();
			this.isDrawing = true;
			const isHighlighter = this.currentTool === "highlighter";
			const type = isHighlighter ? "highlighter" as const : "pen" as const;
			this.currentStroke = {
				id: genId("stroke"),
				pageId: this.data.activePageId,
				type,
				color: this.derivedColorFor(type),
				width: isHighlighter ? this.highlighterWidth : this.strokeWidth,
				style: isHighlighter ? undefined : this.penStyle,
				points: [{ ...this.getDrawingSceneCoords(e.clientX, e.clientY), p: e.pressure > 0 ? e.pressure : 0.5 }]
			};
			this.data.strokes.push(this.currentStroke);
			this.renderedPoints = 1;
			this.save();
		}
	}

	private onPointerMove(e: PointerEvent): void {
		this.lastPointerClient = { x: e.clientX, y: e.clientY };
		this.updateToolPointerPreview(e);
		if (this.pointers.has(e.pointerId)) {
			this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		}

		if (this.pinchStart) {
			this.updatePinch();
			return;
		}

		if (this.isPanning) {
			this.data.viewTransform.x = e.clientX - this.panStart.x;
			this.data.viewTransform.y = e.clientY - this.panStart.y;
			this.applyStageTransform();
			this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
			return;
		}

		if (this.isDrawing && this.currentStroke) {
			// Coalesced events carry the points a fast pen made between frames.
			// A browser that has none for this move still moved the pointer.
			const coalesced = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
			const events = coalesced.length ? coalesced : [e];
			for (const ev of events) {
				const pt = this.getDrawingSceneCoords(ev.clientX, ev.clientY);
				this.currentStroke.points.push({
					x: pt.x,
					y: pt.y,
					p: ev.pressure > 0 ? ev.pressure : 0.5
				});
			}
			if (e.shiftKey) {
				// Shift keeps the stroke a straight line from where it started.
				const pts = this.currentStroke.points;
				this.currentStroke.points = [pts[0], pts[pts.length - 1]];
				this.renderer.drawLiveWholeStroke(this.currentStroke, this.data.viewTransform);
			} else if (this.renderer.supportsIncrementalInk(this.currentStroke)) {
				this.renderer.prepareLive(this.data.viewTransform);
				this.renderer.drawStrokeFrom(this.currentStroke, this.renderedPoints);
			} else {
				this.renderer.drawLiveWholeStroke(this.currentStroke, this.data.viewTransform);
			}
			this.renderedPoints = this.currentStroke.points.length;
			this.save();
			return;
		}

		if (this.isShaping && this.currentShape) {
			const pt = this.getSceneCoords(e.clientX, e.clientY);
			this.currentShape.w = pt.x - this.currentShape.x;
			this.currentShape.h = pt.y - this.currentShape.y;
			this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
			this.save();
			return;
		}

		if (this.isSelecting && this.rubberStart) {
			const pt = this.getSceneCoords(e.clientX, e.clientY);
			if (this.lassoEl) {
				this.lassoPoints.push(pt);
				this.lassoEl.querySelector("polygon")?.setAttribute("points", this.lassoPoints.map(p => `${p.x},${p.y}`).join(" "));
			} else {
				this.positionRubber(this.rubberStart, pt);
			}
			return;
		}

		if (this.isErasing) {
			const pt = this.getSceneCoords(e.clientX, e.clientY);
			this.eraseAt(pt.x, pt.y);
			if (this.erasedAny) this.save();
		}

	}

	private onPointerUp(e: PointerEvent): void {
		this.pointers.delete(e.pointerId);
		if (this.penPointerId === e.pointerId) this.penPointerId = null;

		if (this.pinchStart) {
			if (this.pointers.size < 2) {
				this.pinchStart = null;
				this.workspaceEl.removeClass("is-panning");
				this.save();
			}
			return;
		}

		if (this.isSelecting) {
			const pt = this.getSceneCoords(e.clientX, e.clientY);
			if (this.lassoEl) this.finishLassoSelect(); else this.finishRubberSelect(pt);
		}

		if (this.isPanning) {
			this.isPanning = false;
			this.workspaceEl.removeClass("is-panning");
			this.save();
		}

		if (this.isDrawing) {
			this.isDrawing = false;
			this.currentStroke = null;
			this.renderedPoints = 0;
			this.renderer.endLive();
			this.renderInk();
			this.save();
		}

		if (this.isShaping) {
			this.isShaping = false;
			const shape = this.currentShape;
			this.currentShape = null;
			if (shape && Math.hypot(shape.w, shape.h) < 5) this.data.shapes.remove(shape);
			this.renderInk();
			this.save();
		}

		if (this.isErasing) {
			this.isErasing = false;
			this.eraserCursorEl?.removeClass("is-active");
			// Nothing hovers on a touch screen, so the rubber leaves with the
			// finger instead of sitting where it was last seen.
			if (this.tipErasing || e.pointerType === "touch") {
				this.tipErasing = false;
				this.hideEraserCursor();
			}
			if (this.erasedAny) this.save();
		}
	}

	/**
	 * What a single finger does. A stylus user expects the palm and the spare
	 * hand to move the board and only the pen to write, which is what this did
	 * for everyone — leaving a phone, where there is no pen, unable to draw at
	 * all. So the finger writes until a stylus has been used in this vault, and
	 * moves the board after that. The setting forces writing either way.
	 */
	private fingerDraws(): boolean {
		return this.plugin.settings.fingerDraws || !this.penEverSeen;
	}

	/** Remembers the stylus across boards and restarts, not just this session. */
	private rememberPen(): void {
		if (this.penEverSeen) return;
		this.penEverSeen = true;
		try {
			this.app.saveLocalStorage(PEN_SEEN_KEY, true);
		} catch {
			// A vault that cannot store this simply asks again next time.
		}
	}

	private penIsDown(): boolean {
		return this.penPointerId !== null;
	}

	private startPan(e: PointerEvent): void {
		this.isPanning = true;
		this.workspaceEl.addClass("is-panning");
		this.panStart = {
			x: e.clientX - this.data.viewTransform.x,
			y: e.clientY - this.data.viewTransform.y
		};
	}

	private startPinch(): void {
		if (this.isDrawing) {
			this.isDrawing = false;
			// The second finger means "move the board", not "leave a dot where I
			// happened to touch first": the started stroke goes with the gesture.
			const started = this.currentStroke;
			if (started) this.data.strokes.remove(started);
			this.currentStroke = null;
			this.renderedPoints = 0;
			this.renderer.endLive();
			this.renderInk();
			this.save();
		}
		if (this.isShaping) {
			this.isShaping = false;
			const shape = this.currentShape;
			this.currentShape = null;
			if (shape) this.data.shapes.remove(shape);
			this.renderInk();
		}
		this.isPanning = false;
		this.workspaceEl.removeClass("is-panning");
		this.isErasing = false;
		this.eraserCursorEl?.removeClass("is-active");

		const pts = [...this.pointers.values()];
		if (pts.length < 2) return;
		const rect = this.workspaceEl.getBoundingClientRect();
		this.pinchStart = {
			d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
			cx: (pts[0].x + pts[1].x) / 2 - rect.left,
			cy: (pts[0].y + pts[1].y) / 2 - rect.top,
			vt: { ...this.data.viewTransform }
		};
	}

	private updatePinch(): void {
		const pts = [...this.pointers.values()];
		const s = this.pinchStart;
		if (!s || pts.length < 2) return;
		const rect = this.workspaceEl.getBoundingClientRect();
		const cx = (pts[0].x + pts[1].x) / 2 - rect.left;
		const cy = (pts[0].y + pts[1].y) / 2 - rect.top;
		const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;

		const vt = this.data.viewTransform;
		const newScale = clamp(s.vt.scale * (d / s.d), MIN_SCALE, MAX_SCALE);
		const r = newScale / s.vt.scale;
		vt.x = cx - (s.cx - s.vt.x) * r;
		vt.y = cy - (s.cy - s.vt.y) * r;
		vt.scale = newScale;

		this.applyStageTransform();
		this.renderer.renderAll(this.pageStrokes, this.pageShapes, vt);
		this.syncToolbar();
	}

	private eraseAt(x: number, y: number): void {
		const slop = this.eraserSize / this.data.viewTransform.scale;
		if (this.eraserMode === "partial") {
			this.erasePartialAt(x, y, slop);
			return;
		}
		const strokes = this.pageStrokes;
		const shapes = this.pageShapes;
		const idx = hitTestStrokes(strokes, x, y, slop);
		const shape = idx < 0 ? shapes.find(item => this.pointHitsShape(item, x, y, slop)) : undefined;
		if (idx < 0 && !shape) return;
		if (!this.eraseHistoryPushed) {
			this.history.push();
			this.eraseHistoryPushed = true;
		}
		if (idx >= 0) this.data.strokes.remove(strokes[idx]);
		else if (shape) this.data.shapes.remove(shape);
		this.erasedAny = true;
		this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
	}

	/**
	 * Partial eraser: every stroke under the eraser loses exactly the part the
	 * circle covers, split where the circle crosses it, and the remaining pieces
	 * live on as separate strokes. A straight line drawn with Shift has only two
	 * points, so dropping touched points used to delete it whole.
	 */
	private erasePartialAt(x: number, y: number, radius: number): void {
		const next: Stroke[] = [];
		let changed = false;
		for (const stroke of this.pageStrokes) {
			const pieces = cutStrokeAround(stroke.points, x, y, radius + stroke.width / 2);
			if (!pieces) { next.push(stroke); continue; }
			changed = true;
			for (const points of pieces) next.push({ ...stroke, id: genId("stroke"), points });
		}
		// A shape has no pieces to keep: touching it removes it, as in OneNote.
		const shape = this.pageShapes.find(item => this.pointHitsShape(item, x, y, radius));
		if (!changed && !shape) return;
		if (!this.eraseHistoryPushed) {
			this.history.push();
			this.eraseHistoryPushed = true;
		}
		if (changed) this.data.strokes = [...this.data.strokes.filter(stroke => !this.belongsToActivePage(stroke)), ...next];
		if (shape) this.data.shapes.remove(shape);
		this.erasedAny = true;
		this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
	}

	private pointHitsShape(shape: Shape, x: number, y: number, slop: number): boolean {
		const x0 = Math.min(shape.x, shape.x + shape.w) - slop;
		const y0 = Math.min(shape.y, shape.y + shape.h) - slop;
		const x1 = Math.max(shape.x, shape.x + shape.w) + slop;
		const y1 = Math.max(shape.y, shape.y + shape.h) + slop;
		return x >= x0 && x <= x1 && y >= y0 && y <= y1;
	}

	// ------------------------------------------------------------------
	// Selection (rubber band, group move, delete) — OneNote style
	// ------------------------------------------------------------------

	private hasSelection(): boolean {
		return this.selStrokes.size + this.selShapes.size + this.selBadges.size + this.selTexts.size + this.selTables.size + this.selEmbeds.size > 0;
	}

	private positionRubber(a: { x: number; y: number }, b: { x: number; y: number }): void {
		if (!this.rubberEl) return;
		const x = Math.min(a.x, b.x);
		const y = Math.min(a.y, b.y);
		this.rubberEl.style.left = `${x}px`;
		this.rubberEl.style.top = `${y}px`;
		this.rubberEl.style.width = `${Math.abs(b.x - a.x)}px`;
		this.rubberEl.style.height = `${Math.abs(b.y - a.y)}px`;
	}

	/** Lasso: ink is selected when most of its points fall inside the loop; objects when their centre does. */
	private finishLassoSelect(): void {
		const poly = this.lassoPoints;
		this.isSelecting = false;
		this.rubberStart = null;
		this.lassoEl?.remove();
		this.lassoEl = null;
		this.lassoPoints = [];
		this.clearSelection(false);
		const xs = poly.map(p => p.x);
		const ys = poly.map(p => p.y);
		if (poly.length < 3 || Math.max(...xs) - Math.min(...xs) < 4 || Math.max(...ys) - Math.min(...ys) < 4) {
			this.renderSelectionBox();
			return;
		}
		const inside = (x: number, y: number): boolean => {
			let hit = false;
			for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
				const a = poly[i];
				const b = poly[j];
				if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
			}
			return hit;
		};
		for (const s of this.pageStrokes) {
			const within = s.points.filter(p => inside(p.x, p.y)).length;
			if (within > 0 && within >= s.points.length * 0.5) this.selStrokes.add(s.id);
		}
		for (const shape of this.pageShapes) {
			if (inside(shape.x + shape.w / 2, shape.y + shape.h / 2)) this.selShapes.add(shape.id);
		}
		const centreInside = (id: string): boolean => {
			const r = this.elementSceneRect(id);
			return !!r && inside(r.x + r.w / 2, r.y + r.h / 2);
		};
		for (const b of this.pageBadges) if (centreInside(b.id)) this.selBadges.add(b.id);
		for (const t of this.pageTexts) if (centreInside(t.id)) this.selTexts.add(t.id);
		for (const table of this.pageTables) if (centreInside(table.id)) this.selTables.add(table.id);
		for (const em of this.pageEmbeds) if (centreInside(em.id)) this.selEmbeds.add(em.id);
		this.renderSelectionBox();
	}

	private finishRubberSelect(end: { x: number; y: number }): void {
		const start = this.rubberStart;
		this.isSelecting = false;
		this.rubberStart = null;
		this.rubberEl?.remove();
		this.rubberEl = null;
		if (!start) return;

		const x0 = Math.min(start.x, end.x);
		const y0 = Math.min(start.y, end.y);
		const x1 = Math.max(start.x, end.x);
		const y1 = Math.max(start.y, end.y);

		this.clearSelection(false);

		// Tiny drag = click on empty canvas → just clear the selection.
		if (x1 - x0 < 4 && y1 - y0 < 4) {
			this.renderSelectionBox();
			return;
		}

		for (const s of this.pageStrokes) {
			if (s.points.some(p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)) {
				this.selStrokes.add(s.id);
			}
		}
		for (const shape of this.pageShapes) {
			if (this.shapeIntersects(shape, x0, y0, x1, y1)) this.selShapes.add(shape.id);
		}
		for (const b of this.pageBadges) {
			if (this.elementIntersects(b.id, x0, y0, x1, y1)) this.selBadges.add(b.id);
		}
		for (const t of this.pageTexts) {
			if (this.elementIntersects(t.id, x0, y0, x1, y1)) this.selTexts.add(t.id);
		}
		for (const table of this.pageTables) {
			if (this.elementIntersects(table.id, x0, y0, x1, y1)) this.selTables.add(table.id);
		}
		for (const em of this.pageEmbeds) {
			if (this.elementIntersects(em.id, x0, y0, x1, y1)) this.selEmbeds.add(em.id);
		}

		this.renderSelectionBox();
	}

	private elementIntersects(id: string, x0: number, y0: number, x1: number, y1: number): boolean {
		const r = this.elementSceneRect(id);
		if (!r) return false;
		return r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0;
	}

	private shapeIntersects(shape: Shape, x0: number, y0: number, x1: number, y1: number): boolean {
		const sx0 = Math.min(shape.x, shape.x + shape.w);
		const sy0 = Math.min(shape.y, shape.y + shape.h);
		const sx1 = Math.max(shape.x, shape.x + shape.w);
		const sy1 = Math.max(shape.y, shape.y + shape.h);
		return sx0 < x1 && sx1 > x0 && sy0 < y1 && sy1 > y0;
	}

	/** Scene-space rect of a DOM-layer element, from its live element. */
	private elementSceneRect(id: string): { x: number; y: number; w: number; h: number } | null {
		const el = this.domLayerEl.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
		if (!el) return null;
		const badge = this.data.badges.find(item => item.id === id);
		const scale = badge?.scale ?? 1;
		return {
			x: parseFloat(el.style.left) || 0,
			y: parseFloat(el.style.top) || 0,
			w: el.offsetWidth * scale,
			h: el.offsetHeight * scale
		};
	}

	/** The four corners of a shape after its own rotation. */
	private shapeCorners(shape: Shape): { x: number; y: number }[] {
		const corners = [
			{ x: shape.x, y: shape.y }, { x: shape.x + shape.w, y: shape.y },
			{ x: shape.x + shape.w, y: shape.y + shape.h }, { x: shape.x, y: shape.y + shape.h }
		];
		if (!shape.rotation) return corners;
		const cx = shape.x + shape.w / 2, cy = shape.y + shape.h / 2;
		const rad = shape.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
		return corners.map(p => ({ x: cx + (p.x - cx) * cos - (p.y - cy) * sin, y: cy + (p.x - cx) * sin + (p.y - cy) * cos }));
	}

	private selectionBounds(): { x: number; y: number; w: number; h: number; contains: (px: number, py: number) => boolean } | null {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

		for (const s of this.pageStrokes) {
			if (!this.selStrokes.has(s.id)) continue;
			for (const p of s.points) {
				minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
				maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
			}
		}
		for (const shape of this.pageShapes) {
			if (!this.selShapes.has(shape.id)) continue;
			for (const corner of this.shapeCorners(shape)) {
				minX = Math.min(minX, corner.x); minY = Math.min(minY, corner.y);
				maxX = Math.max(maxX, corner.x); maxY = Math.max(maxY, corner.y);
			}
		}
		for (const id of [...this.selBadges, ...this.selTexts, ...this.selTables, ...this.selEmbeds]) {
			const r = this.elementSceneRect(id);
			if (!r) continue;
			// A rotated box takes the bounds of its turned corners, so the frame still wraps it.
			const rotation = this.data.texts.find(t => t.id === id)?.rotation
				?? this.data.tables.find(t => t.id === id)?.rotation
				?? this.data.embeds.find(t => t.id === id)?.rotation ?? 0;
			if (rotation) {
				const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
				const rad = rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
				for (const [px, py] of [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]) {
					const qx = cx + (px - cx) * cos - (py - cy) * sin, qy = cy + (px - cx) * sin + (py - cy) * cos;
					minX = Math.min(minX, qx); minY = Math.min(minY, qy);
					maxX = Math.max(maxX, qx); maxY = Math.max(maxY, qy);
				}
				continue;
			}
			minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
			maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
		}

		if (!isFinite(minX)) return null;
		const bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
		return {
			...bounds,
			contains: (px: number, py: number) =>
				px >= bounds.x && px <= bounds.x + bounds.w && py >= bounds.y && py <= bounds.y + bounds.h
		};
	}

	private renderSelectionBox(): void {
		this.selectionBoxEl?.remove();
		this.selectionBoxEl = null;
		this.domLayerEl.querySelectorAll(".notelens-selected").forEach(el => el.removeClass("notelens-selected"));

		const b = this.selectionBounds();
		if (!b) return;

		for (const id of [...this.selBadges, ...this.selTexts, ...this.selTables, ...this.selEmbeds]) {
			(this.domLayerEl.querySelector(`[data-id="${id}"]`) as HTMLElement | null)?.addClass("notelens-selected");
		}

		const pad = 8;
		const box = this.domLayerEl.createDiv({ cls: "onenote-selection-box" });
		box.style.left = `${b.x - pad}px`;
		box.style.top = `${b.y - pad}px`;
		box.style.width = `${b.w + pad * 2}px`;
		box.style.height = `${b.h + pad * 2}px`;
		// Near the top of the pane the docks would cover the action bar and the
		// rotation handle, so both flip underneath the frame.
		const vt = this.data.viewTransform;
		const screenTop = vt.y + (b.y - pad) * vt.scale;
		if (screenTop < 170) box.addClass("is-below");
		const resize = box.createDiv({ cls: "notelens-selection-resize" });
		resize.title = tr("Redimensionar selección");
		// Compact action bar above the frame: duplicate and delete, nothing else in the way.
		const bar = box.createDiv({ cls: "notelens-selection-bar" });
		bar.addEventListener("pointerdown", (event) => { event.stopPropagation(); event.preventDefault(); });
		const action = (icon: string, title: string, run: () => void) => {
			const button = bar.createEl("button", { cls: "notelens-selection-action" });
			setIcon(button, icon);
			button.title = tr(title);
			button.addEventListener("click", (event) => { event.stopPropagation(); run(); });
		};
		action("copy", "Duplicar (Ctrl+D)", () => this.duplicateSelection());
		action("rotate-ccw", "Girar 90° a la izquierda", () => this.rotateSelectionBy(-90));
		action("rotate-cw", "Girar 90° a la derecha", () => this.rotateSelectionBy(90));
		action("x", "Eliminar (Supr)", () => this.deleteSelection());
		resize.addEventListener("pointerdown", (event) => this.startSelectionResize(event));
		// Rotation handle above the frame: drag it around the centre; Shift snaps to 15°.
		const rotate = box.createDiv({ cls: "notelens-selection-rotate" });
		rotate.title = tr("Girar la selección (Shift: pasos de 15°)");
		rotate.addEventListener("pointerdown", (event) => this.startSelectionRotate(event));
		this.selectionBoxEl = box;
	}

	private clearSelection(rerender = true): void {
		this.selStrokes.clear();
		this.selShapes.clear();
		this.selBadges.clear();
		this.selTexts.clear();
		this.selTables.clear();
		this.selEmbeds.clear();
		if (rerender) this.renderSelectionBox();
	}

	private startSelectionDrag(e: PointerEvent): void {
		this.history.push();
		let last = this.getSceneCoords(e.clientX, e.clientY);

		const onMove = (ev: PointerEvent) => {
			const cur = this.getSceneCoords(ev.clientX, ev.clientY);
			const dx = cur.x - last.x;
			const dy = cur.y - last.y;
			last = cur;
			this.moveSelectionBy(dx, dy);
			this.save();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			this.save();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	/** Free rotation: the pointer's angle around the selection centre drives the turn. */
	private startSelectionRotate(event: PointerEvent): void {
		event.stopPropagation();
		event.preventDefault();
		const bounds = this.selectionBounds();
		if (!bounds) return;
		this.history.push();
		const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
		const angleAt = (ev: PointerEvent) => {
			const p = this.getSceneCoords(ev.clientX, ev.clientY);
			return Math.atan2(p.y - center.y, p.x - center.x) * 180 / Math.PI;
		};
		const startAngle = angleAt(event);
		let applied = 0;
		const badge = this.domLayerEl.createDiv({ cls: "notelens-rotation-badge" });
		const showBadge = (deg: number) => {
			badge.setText(`${Math.round(((deg % 360) + 360) % 360)}°`);
			badge.style.left = `${center.x}px`;
			badge.style.top = `${bounds.y - 44}px`;
		};
		showBadge(0);
		const onMove = (ev: PointerEvent) => {
			let target = angleAt(ev) - startAngle;
			if (ev.shiftKey) target = Math.round(target / 15) * 15;
			const delta = target - applied;
			if (Math.abs(delta) < 0.01) return;
			applied = target;
			this.rotateSelectionBy(delta, center, false);
			showBadge(applied);
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove, true);
			window.removeEventListener("pointerup", onUp, true);
			badge.remove();
			this.renderAll();
			this.renderSelectionBox();
			this.save();
		};
		window.addEventListener("pointermove", onMove, true);
		window.addEventListener("pointerup", onUp, true);
	}

	/**
	 * Rotates every selected object by `deg` around the selection centre (or a
	 * given pivot). Ink is rotated point by point; shapes, text boxes, tables
	 * and embeds keep a rotation of their own and orbit the pivot.
	 */
	private rotateSelectionBy(deg: number, pivot?: { x: number; y: number }, record = true): void {
		const bounds = this.selectionBounds();
		if (!bounds) return;
		if (record) this.history.push();
		const c = pivot ?? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
		const rad = deg * Math.PI / 180;
		const cos = Math.cos(rad), sin = Math.sin(rad);
		const spin = (x: number, y: number) => ({ x: c.x + (x - c.x) * cos - (y - c.y) * sin, y: c.y + (x - c.x) * sin + (y - c.y) * cos });
		const norm = (a: number) => { const r = Math.round(a * 100) / 100; return Math.abs(r % 360) < 0.01 ? undefined : r; };

		for (const s of this.pageStrokes) {
			if (!this.selStrokes.has(s.id)) continue;
			for (const p of s.points) { const q = spin(p.x, p.y); p.x = q.x; p.y = q.y; }
		}
		for (const shape of this.pageShapes) {
			if (!this.selShapes.has(shape.id)) continue;
			const centre = spin(shape.x + shape.w / 2, shape.y + shape.h / 2);
			shape.x = centre.x - shape.w / 2;
			shape.y = centre.y - shape.h / 2;
			shape.rotation = norm((shape.rotation ?? 0) + deg);
		}
		const orbit = (obj: { x: number; y: number; rotation?: number }, id: string, turns: boolean) => {
			const el = this.domLayerEl.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
			if (!el) return;
			const rect = this.elementSceneRect(id);
			const w = rect?.w ?? 0, h = rect?.h ?? 0;
			const centre = spin(obj.x + w / 2, obj.y + h / 2);
			obj.x = centre.x - w / 2;
			obj.y = centre.y - h / 2;
			el.style.left = `${obj.x}px`;
			el.style.top = `${obj.y}px`;
			if (turns) {
				obj.rotation = norm((obj.rotation ?? 0) + deg);
				el.style.transform = obj.rotation ? `rotate(${obj.rotation}deg)` : "";
			}
		};
		for (const b of this.pageBadges) if (this.selBadges.has(b.id)) orbit(b as unknown as { x: number; y: number }, b.id, false);
		for (const tb of this.pageTexts) if (this.selTexts.has(tb.id)) orbit(tb, tb.id, true);
		for (const table of this.pageTables) if (this.selTables.has(table.id)) orbit(table, table.id, true);
		for (const em of this.pageEmbeds) if (this.selEmbeds.has(em.id)) orbit(em, em.id, true);

		this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
		if (record) {
			this.renderSelectionBox();
			this.save();
		} else {
			const b = this.selectionBounds();
			if (b && this.selectionBoxEl) {
				const pad = 8;
				this.selectionBoxEl.style.left = `${b.x - pad}px`;
				this.selectionBoxEl.style.top = `${b.y - pad}px`;
				this.selectionBoxEl.style.width = `${b.w + pad * 2}px`;
				this.selectionBoxEl.style.height = `${b.h + pad * 2}px`;
			}
		}
	}

	private moveSelectionBy(dx: number, dy: number): void {
		let strokesMoved = false;

		for (const s of this.pageStrokes) {
			if (!this.selStrokes.has(s.id)) continue;
			for (const p of s.points) { p.x += dx; p.y += dy; }
			strokesMoved = true;
		}
		for (const shape of this.pageShapes) {
			if (!this.selShapes.has(shape.id)) continue;
			shape.x += dx;
			shape.y += dy;
			strokesMoved = true;
		}

		const moveDom = (obj: { x: number; y: number }, id: string) => {
			obj.x += dx;
			obj.y += dy;
			const el = this.domLayerEl.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
			if (el) {
				el.style.left = `${obj.x}px`;
				el.style.top = `${obj.y}px`;
			}
		};

		for (const b of this.pageBadges) if (this.selBadges.has(b.id)) moveDom(b, b.id);
		for (const t of this.pageTexts) if (this.selTexts.has(t.id)) moveDom(t, t.id);
		for (const table of this.pageTables) if (this.selTables.has(table.id)) moveDom(table, table.id);
		for (const em of this.pageEmbeds) if (this.selEmbeds.has(em.id)) moveDom(em, em.id);

		if (strokesMoved) {
			this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
		}

		// Keep the selection box glued to its content.
		const b = this.selectionBounds();
		if (b && this.selectionBoxEl) {
			const pad = 8;
			this.selectionBoxEl.style.left = `${b.x - pad}px`;
			this.selectionBoxEl.style.top = `${b.y - pad}px`;
			this.selectionBoxEl.style.width = `${b.w + pad * 2}px`;
			this.selectionBoxEl.style.height = `${b.h + pad * 2}px`;
		}
	}

	/** Scales every selected object from the top-left selection corner. */
	private startSelectionResize(event: PointerEvent): void {
		event.stopPropagation();
		event.preventDefault();
		const bounds = this.selectionBounds();
		if (!bounds) return;
		this.history.push();
		const snapshot = this.captureSelectionResizeSnapshot(bounds);
		const baseW = Math.max(bounds.w, 12);
		const baseH = Math.max(bounds.h, 12);
		const onMove = (move: PointerEvent) => {
			const point = this.getSceneCoords(move.clientX, move.clientY);
			const sx = Math.max(0.08, (point.x - bounds.x) / baseW);
			const sy = Math.max(0.08, (point.y - bounds.y) / baseH);
			this.applySelectionScale(snapshot, sx, sy);
			this.save();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			this.renderAll();
			this.renderSelectionBox();
			this.save();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	private captureSelectionResizeSnapshot(bounds: { x: number; y: number; w: number; h: number }): SelectionResizeSnapshot {
		const texts = new Map<string, { x: number; y: number; w: number; h: number }>();
		for (const text of this.pageTexts) {
			if (!this.selTexts.has(text.id)) continue;
			const rect = this.elementSceneRect(text.id);
			texts.set(text.id, { x: text.x, y: text.y, w: text.w ?? rect?.w ?? 260, h: text.h ?? rect?.h ?? 48 });
		}
		return {
			bounds: { x: bounds.x, y: bounds.y, w: Math.max(bounds.w, 12), h: Math.max(bounds.h, 12) },
			strokes: new Map(this.pageStrokes.filter(item => this.selStrokes.has(item.id)).map(item => [item.id, {
				points: item.points.map(point => ({ x: point.x, y: point.y })), width: item.width
			}])),
			shapes: new Map(this.pageShapes.filter(item => this.selShapes.has(item.id)).map(item => [item.id, {
				x: item.x, y: item.y, w: item.w, h: item.h, width: item.width
			}])),
			badges: new Map(this.pageBadges.filter(item => this.selBadges.has(item.id)).map(item => [item.id, {
				x: item.x, y: item.y, scale: item.scale ?? 1
			}])),
			texts,
			tables: new Map(this.pageTables.filter(item => this.selTables.has(item.id)).map(item => [item.id, {
				x: item.x, y: item.y, w: item.w, h: item.h
			}])),
			embeds: new Map(this.pageEmbeds.filter(item => this.selEmbeds.has(item.id)).map(item => [item.id, {
				x: item.x, y: item.y, w: item.w, h: item.h
			}]))
		};
	}

	private applySelectionScale(snapshot: SelectionResizeSnapshot, sx: number, sy: number): void {
		const { x, y } = snapshot.bounds;
		const mapX = (value: number) => x + (value - x) * sx;
		const mapY = (value: number) => y + (value - y) * sy;
		const lineScale = Math.sqrt(sx * sy);
		for (const stroke of this.pageStrokes) {
			const original = snapshot.strokes.get(stroke.id);
			if (!original) continue;
			for (let index = 0; index < stroke.points.length; index++) {
				stroke.points[index].x = mapX(original.points[index].x);
				stroke.points[index].y = mapY(original.points[index].y);
			}
			stroke.width = clamp(original.width * lineScale, 0.5, 48);
		}
		for (const shape of this.pageShapes) {
			const original = snapshot.shapes.get(shape.id);
			if (!original) continue;
			shape.x = mapX(original.x); shape.y = mapY(original.y);
			shape.w = original.w * sx; shape.h = original.h * sy;
			shape.width = clamp(original.width * lineScale, 0.5, 48);
		}
		for (const badge of this.pageBadges) {
			const original = snapshot.badges.get(badge.id);
			if (!original) continue;
			badge.x = mapX(original.x); badge.y = mapY(original.y);
			badge.scale = clamp(original.scale * lineScale, 0.5, 3);
		}
		for (const text of this.pageTexts) {
			const original = snapshot.texts.get(text.id);
			if (!original) continue;
			text.x = mapX(original.x); text.y = mapY(original.y);
			text.w = clamp(original.w * sx, text.stickyColor ? 180 : 120, 1800);
			text.h = clamp(original.h * sy, text.stickyColor ? 100 : 34, 1800);
		}
		for (const table of this.pageTables) {
			const original = snapshot.tables.get(table.id);
			if (!original) continue;
			table.x = mapX(original.x); table.y = mapY(original.y);
			table.w = clamp(original.w * sx, 160, 2200); table.h = clamp(original.h * sy, 96, 1800);
		}
		for (const embed of this.pageEmbeds) {
			const original = snapshot.embeds.get(embed.id);
			if (!original) continue;
			embed.x = mapX(original.x); embed.y = mapY(original.y);
			embed.w = clamp(original.w * sx, 80, 2400);
			embed.h = original.h > 0 ? clamp(original.h * sy, 80, 1800) : 0;
		}
		this.syncSelectedGeometry();
		this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
		this.renderSelectionBox();
	}

	private syncSelectedGeometry(): void {
		for (const badge of this.pageBadges) {
			if (!this.selBadges.has(badge.id)) continue;
			const el = this.domLayerEl.querySelector(`[data-id="${badge.id}"]`) as HTMLElement | null;
			if (el) {
				el.style.left = `${badge.x}px`; el.style.top = `${badge.y}px`;
				el.style.transform = `scale(${badge.scale ?? 1})`;
			}
		}
		for (const text of this.pageTexts) {
			if (!this.selTexts.has(text.id)) continue;
			const el = this.domLayerEl.querySelector(`[data-id="${text.id}"]`) as HTMLElement | null;
			if (el) { el.style.left = `${text.x}px`; el.style.top = `${text.y}px`; this.applyTextStyles(el, text); }
		}
		for (const table of this.pageTables) {
			if (!this.selTables.has(table.id)) continue;
			const el = this.domLayerEl.querySelector(`[data-id="${table.id}"]`) as HTMLElement | null;
			if (el) { el.style.left = `${table.x}px`; el.style.top = `${table.y}px`; el.style.width = `${table.w}px`; el.style.height = `${table.h}px`; }
		}
		for (const embed of this.pageEmbeds) {
			if (!this.selEmbeds.has(embed.id)) continue;
			const el = this.domLayerEl.querySelector(`[data-id="${embed.id}"]`) as HTMLElement | null;
			if (el) {
				el.style.left = `${embed.x}px`; el.style.top = `${embed.y}px`; el.style.width = `${embed.w}px`;
				if (embed.h > 0) el.style.height = `${embed.h}px`;
			}
		}
	}

	// ------------------------------------------------------------------
	// Search across text boxes, tables and tags
	// ------------------------------------------------------------------

	private openSearch(): void {
		if (this.searchEl) {
			(this.searchEl.querySelector("input") as HTMLInputElement | null)?.focus();
			return;
		}
		const bar = this.workspaceEl.createDiv({ cls: "notelens-search" });
		for (const type of ["pointerdown", "pointerup", "dblclick"]) bar.addEventListener(type, (e) => e.stopPropagation());
		bar.addEventListener("keydown", (e) => e.stopPropagation());
		setIcon(bar.createSpan({ cls: "notelens-search-icon" }), "search");
		const input = bar.createEl("input", { cls: "notelens-search-input" });
		input.type = "text";
		input.placeholder = tr("Buscar en la pizarra…");
		const count = bar.createSpan({ cls: "notelens-search-count", text: "" });
		const prev = bar.createEl("button", { cls: "notelens-nav-btn" });
		setIcon(prev, "chevron-up");
		prev.title = tr("Anterior (Shift+Enter)");
		const next = bar.createEl("button", { cls: "notelens-nav-btn" });
		setIcon(next, "chevron-down");
		next.title = tr("Siguiente (Enter)");
		const closeBtn = bar.createEl("button", { cls: "notelens-nav-btn" });
		setIcon(closeBtn, "x");
		closeBtn.title = tr("Cerrar (Esc)");
		this.searchEl = bar;

		const run = () => {
			this.searchHits = this.findMatches(input.value);
			this.searchIndex = this.searchHits.length ? 0 : -1;
			this.showSearchHit(count);
		};
		const step = (delta: number) => {
			if (!this.searchHits.length) return;
			this.searchIndex = (this.searchIndex + delta + this.searchHits.length) % this.searchHits.length;
			this.showSearchHit(count);
		};
		input.addEventListener("input", run);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
			else if (e.key === "Escape") { e.preventDefault(); this.closeSearch(); }
		});
		prev.onclick = () => step(-1);
		next.onclick = () => step(1);
		closeBtn.onclick = () => this.closeSearch();
		input.focus();
	}

	private closeSearch(): void {
		this.searchEl?.remove();
		this.searchEl = null;
		this.searchHits = [];
		this.searchIndex = -1;
		this.domLayerEl.querySelectorAll(".notelens-search-hit").forEach(el => el.removeClass("notelens-search-hit", "notelens-search-current"));
	}

	private findMatches(query: string): { id: string; x: number; y: number }[] {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		const hits: { id: string; x: number; y: number }[] = [];
		for (const t of this.pageTexts) {
			if (t.text.toLowerCase().includes(q)) hits.push({ id: t.id, x: t.x + (t.w ?? 200) / 2, y: t.y + (t.h ?? 40) / 2 });
		}
		for (const table of this.pageTables) {
			if (table.cells.some(row => row.some(cell => cell.toLowerCase().includes(q)))) hits.push({ id: table.id, x: table.x + table.w / 2, y: table.y + table.h / 2 });
		}
		for (const b of this.pageBadges) {
			if (b.label.toLowerCase().includes(q) || (b.tooltip ?? "").toLowerCase().includes(q)) hits.push({ id: b.id, x: b.x, y: b.y });
		}
		for (const em of this.pageEmbeds) {
			if (em.src.toLowerCase().includes(q)) hits.push({ id: em.id, x: em.x + em.w / 2, y: em.y + em.h / 2 });
		}
		return hits;
	}

	private showSearchHit(count: HTMLElement): void {
		this.domLayerEl.querySelectorAll(".notelens-search-hit").forEach(el => el.removeClass("notelens-search-hit", "notelens-search-current"));
		const total = this.searchHits.length;
		count.setText(total ? `${this.searchIndex + 1}/${total}` : (this.searchEl?.querySelector("input") as HTMLInputElement | null)?.value ? "0" : "");
		for (const hit of this.searchHits) {
			(this.domLayerEl.querySelector(`[data-id="${hit.id}"]`) as HTMLElement | null)?.addClass("notelens-search-hit");
		}
		const current = this.searchHits[this.searchIndex];
		if (!current) return;
		(this.domLayerEl.querySelector(`[data-id="${current.id}"]`) as HTMLElement | null)?.addClass("notelens-search-current");
		this.panToScene(current.x, current.y, Math.max(this.data.viewTransform.scale, 0.8));
	}

	// ------------------------------------------------------------------
	// Clipboard: Ctrl+C / Ctrl+X / Ctrl+V for board objects
	// ------------------------------------------------------------------

	/** Where a paste lands: under the pointer when it is over the board, else the viewport centre (stepping for repeats). */
	private pasteTarget(w: number, h: number): { x: number; y: number } {
		const p = this.lastPointerClient;
		const r = this.workspaceEl.getBoundingClientRect();
		if (p && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) {
			const el = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
			if (el && (this.workspaceEl.contains(el)) && !el.closest(".onenote-ribbon-dock, .notelens-insert-dock, .notelens-document-dock, .onenote-quick-tags, .notelens-pen-panel, .notelens-calculator, .notelens-translator, .notelens-recorder, .notelens-navigator, .notelens-shortcuts, .notelens-tag-summary, .notelens-minimap, .notelens-settings-panel, .notelens-bookmarks-dock, .notelens-pages-dock")) {
				const s = this.getSceneCoords(p.x, p.y);
				return { x: s.x - w / 2, y: s.y - h / 2 };
			}
		}
		const c = this.getViewportCenterScene();
		const step = (this.pasteCount % 6) * 24;
		return { x: c.x - w / 2 + step, y: c.y - h / 2 + step };
	}

	private copySelection(cut: boolean): void {
		const payload: ClipboardPayload = {
			notelens: 1,
			strokes: this.data.strokes.filter(s => this.selStrokes.has(s.id)),
			shapes: this.data.shapes.filter(s => this.selShapes.has(s.id)),
			badges: this.data.badges.filter(b => this.selBadges.has(b.id)),
			texts: this.data.texts.filter(t => this.selTexts.has(t.id)),
			tables: this.data.tables.filter(t => this.selTables.has(t.id)),
			embeds: this.data.embeds.filter(em => this.selEmbeds.has(em.id))
		};
		const count = payload.strokes.length + payload.shapes.length + payload.badges.length + payload.texts.length + payload.tables.length + payload.embeds.length;
		if (!count) return;
		const copy = JSON.parse(JSON.stringify(payload)) as ClipboardPayload;
		this.clipboardPayload = copy;
		this.pasteCount = 0;
		void navigator.clipboard?.writeText(CLIP_PREFIX + JSON.stringify(copy)).catch(() => { /* memory copy still works */ });
		new Notice(tr("{p0}: {p1} {p2}. Ctrl+V pega donde esté el ratón.", { p0: cut ? "Cortado" : "Copiado", p1: count, p2: count === 1 ? "objeto" : "objetos" }));
		if (cut) this.deleteSelection();
	}

	private pasteObjects(payload: ClipboardPayload): void {
		const items = [...payload.strokes.flatMap(s => s.points), ...payload.shapes, ...payload.badges, ...payload.texts, ...payload.tables, ...payload.embeds];
		if (!items.length) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		const expand = (x: number, y: number, w = 0, h = 0) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h); };
		for (const p of payload.strokes.flatMap(s => s.points)) expand(p.x, p.y);
		for (const s of payload.shapes) expand(Math.min(s.x, s.x + s.w), Math.min(s.y, s.y + s.h), Math.abs(s.w), Math.abs(s.h));
		for (const b of payload.badges) expand(b.x, b.y, 120, 30);
		for (const t of payload.texts) expand(t.x, t.y, t.w ?? 200, t.h ?? 40);
		for (const t of payload.tables) expand(t.x, t.y, t.w, t.h);
		for (const em of payload.embeds) expand(em.x, em.y, em.w, em.h || 100);
		const w = maxX - minX, h = maxY - minY;
		const target = this.pasteTarget(w, h);
		const dx = target.x - minX, dy = target.y - minY;
		this.pasteCount++;

		this.history.push();
		this.commitTextEditor();
		this.clearSelection(false);
		const remap = <T extends { id: string; pageId?: string; x?: number; y?: number }>(item: T, prefix: string): T => {
			const copy = JSON.parse(JSON.stringify(item)) as T;
			copy.id = genId(prefix);
			copy.pageId = this.data.activePageId;
			if (typeof copy.x === "number") copy.x += dx;
			if (typeof copy.y === "number") copy.y += dy;
			return copy;
		};
		for (const s of payload.strokes) { const c = remap(s, "stroke"); c.points = c.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })); this.data.strokes.push(c); this.selStrokes.add(c.id); }
		for (const s of payload.shapes) { const c = remap(s, "shape"); this.data.shapes.push(c); this.selShapes.add(c.id); }
		for (const b of payload.badges) { const c = remap(b, "badge"); this.data.badges.push(c); this.selBadges.add(c.id); }
		for (const t of payload.texts) { const c = remap(t, "text"); this.data.texts.push(c); this.selTexts.add(c.id); }
		for (const t of payload.tables) { const c = remap(t, "table"); this.data.tables.push(c); this.selTables.add(c.id); }
		for (const em of payload.embeds) { const c = remap(em, "embed"); this.data.embeds.push(c); this.selEmbeds.add(c.id); }
		this.renderAll();
		this.renderSelectionBox();
		this.save();
	}

	private selectAll(): void {
		this.commitTextEditor();
		if (this.currentTool !== "select") this.setTool("select");
		this.clearSelection(false);
		for (const s of this.pageStrokes) this.selStrokes.add(s.id);
		for (const s of this.pageShapes) this.selShapes.add(s.id);
		for (const b of this.pageBadges) this.selBadges.add(b.id);
		for (const t of this.pageTexts) this.selTexts.add(t.id);
		for (const t of this.pageTables) this.selTables.add(t.id);
		for (const em of this.pageEmbeds) this.selEmbeds.add(em.id);
		this.renderSelectionBox();
	}

	/** Ctrl+D: clones the selection slightly offset and selects the copies. */
	private duplicateSelection(): void {
		if (!this.hasSelection()) return;
		this.history.push();
		const offset = 24;
		const clone = <T extends { id: string; x?: number; y?: number }>(item: T, prefix: string): T => {
			const copy = JSON.parse(JSON.stringify(item)) as T;
			copy.id = genId(prefix);
			if (typeof copy.x === "number") copy.x += offset;
			if (typeof copy.y === "number") copy.y += offset;
			return copy;
		};
		const newStrokes = this.data.strokes.filter(s => this.selStrokes.has(s.id)).map(s => {
			const copy = clone(s, "stroke");
			copy.points = copy.points.map(p => ({ ...p, x: p.x + offset, y: p.y + offset }));
			return copy;
		});
		const newShapes = this.data.shapes.filter(s => this.selShapes.has(s.id)).map(s => clone(s, "shape"));
		const newBadges = this.data.badges.filter(b => this.selBadges.has(b.id)).map(b => clone(b, "badge"));
		const newTexts = this.data.texts.filter(t => this.selTexts.has(t.id)).map(t => clone(t, "text"));
		const newTables = this.data.tables.filter(t => this.selTables.has(t.id)).map(t => clone(t, "table"));
		this.data.strokes.push(...newStrokes);
		this.data.shapes.push(...newShapes);
		this.data.badges.push(...newBadges);
		this.data.texts.push(...newTexts);
		this.data.tables.push(...newTables);
		this.clearSelection(false);
		for (const s of newStrokes) this.selStrokes.add(s.id);
		for (const s of newShapes) this.selShapes.add(s.id);
		for (const b of newBadges) this.selBadges.add(b.id);
		for (const t of newTexts) this.selTexts.add(t.id);
		for (const t of newTables) this.selTables.add(t.id);
		this.renderAll();
		this.renderSelectionBox();
		this.save();
	}

	private deleteSelection(): void {
		if (!this.hasSelection()) return;
		this.history.push();
		this.data.strokes = this.data.strokes.filter(s => !this.selStrokes.has(s.id));
		this.data.shapes = this.data.shapes.filter(s => !this.selShapes.has(s.id));
		this.data.badges = this.data.badges.filter(b => !this.selBadges.has(b.id));
		this.data.texts = this.data.texts.filter(t => !this.selTexts.has(t.id));
		this.data.tables = this.data.tables.filter(table => !this.selTables.has(table.id));
		this.data.embeds = this.data.embeds.filter(em => !this.selEmbeds.has(em.id));
		this.clearSelection(false);
		this.renderAll();
		this.save();
	}

	// ------------------------------------------------------------------
	// ToolbarHost
	// ------------------------------------------------------------------

	setTool(tool: ToolId): void {
		const previousTool = this.currentTool;
		this.currentTool = tool;
		this.activeBadgeTag = null;
		this.syncToolCursor();
		if (tool !== "text") this.hideTextPlacementHint();
		if (tool !== "place_badge") {
			this.workspaceEl.removeAttribute("data-badge-tag");
			(this.workspaceEl as any).__clearActiveTag?.();
		}
		// Keep selected figures available to the shape panel for post-draw edits,
		// and keep the selection when the same tool is chosen again.
		const sameTool = tool === previousTool;
		if (tool !== "select" && !sameTool && !(tool === "shape" && this.selShapes.size > 0)) this.clearSelection();
		if (tool !== "pen" && tool !== "highlighter") {
			(this.workspaceEl as any).__closePenPanel?.();
		}
		this.syncToolbar();
	}

	private syncToolbar(): void {
		(this.workspaceEl as any).__refreshToolbar?.();
		(this.workspaceEl as any).__refreshNavigation?.();
		(this.workspaceEl as any).__refreshPaperSettings?.();
	}

	private syncToolCursor(): void {
		if (!this.workspaceEl) return;
		this.workspaceEl.setAttr("data-tool", this.currentTool);
		// The hand joins the ink tools here: dragging must move the board even
		// when the pen lands on a note, a table or a PDF.
		this.workspaceEl.setAttr("data-pass-ink", ["hand", "pen", "highlighter", "eraser", "shape"].includes(this.currentTool) ? "true" : "false");
		if (this.currentTool !== "text") this.hideTextPlacementHint();
		if (this.currentTool !== "eraser") this.hideEraserCursor();
	}

	setPenColor(hex: string): void {
		this.penColorChosen = true;
		this.penColorHex = hex;
		this.updateDerivedColors();
		// Recent colors (most recent first, unique, max 6)
		this.recentColors = [hex, ...this.recentColors.filter(c => c.toLowerCase() !== hex.toLowerCase())].slice(0, 6);
		// OneNote behavior: with ink selected, the new color applies to it.
		this.applyToSelectedStrokes(s => { if (s.type === "pen") s.color = this.derivedColorFor("pen"); });
		if (this.currentTool === "shape") this.applyToSelectedShapes(shape => { shape.color = this.derivedColorFor("pen"); });
		this.syncToolbar();
	}

	setHighlighterColor(hex: string): void {
		this.highlighterColorHex = hex;
		this.updateDerivedColors();
		this.recentColors = [hex, ...this.recentColors.filter(c => c.toLowerCase() !== hex.toLowerCase())].slice(0, 6);
		this.applyToSelectedStrokes(s => { if (s.type === "highlighter") s.color = this.derivedColorFor("highlighter"); });
		this.syncToolbar();
	}

	/** Switches the pen nib; selected pen strokes adopt it too, like a colour change. */
	setPenStyle(style: PenStyle): void {
		this.penStyle = style;
		if (this.currentTool !== "pen") this.setTool("pen");
		this.applyToSelectedStrokes(s => { if (s.type === "pen") s.style = style; });
		this.plugin.settings.penStyle = style;
		void this.plugin.saveSettings();
		this.syncToolbar();
	}

	setStrokeWidth(w: number): void {
		if (this.currentTool === "highlighter") {
			this.highlighterWidth = clamp(w, 8, 42);
			this.applyToSelectedStrokes(s => { if (s.type === "highlighter") s.width = this.highlighterWidth; });
		} else {
			this.strokeWidth = clamp(w, 1, 24);
			this.applyToSelectedStrokes(s => { if (s.type === "pen") s.width = this.strokeWidth; });
			if (this.currentTool === "shape") this.applyToSelectedShapes(shape => { shape.width = this.strokeWidth; });
		}
		this.syncToolbar();
	}

	setStrokeIntensity(v: number): void {
		if (this.currentTool === "highlighter") {
			this.highlighterIntensity = clamp(v, 0.1, 0.9);
		} else {
			this.strokeIntensity = clamp(v, 0.05, 1);
		}
		this.updateDerivedColors();
		this.applyToSelectedStrokes(s => { s.color = setColorAlpha(s.color, this.intensityAlphaFor(s.type)); });
		this.syncToolbar();
	}

	setEraserSize(v: number): void {
		this.eraserSize = clamp(v, 2, 60);
		this.syncEraserCursorSize();
		this.syncToolbar();
	}

	setEraserMode(mode: EraserMode): void {
		this.eraserMode = mode;
		this.syncEraserCursorSize();
		this.syncToolbar();
	}

	setSelectionMode(mode: SelectionMode): void {
		this.selectionMode = mode;
		if (this.currentTool !== "select") this.setTool("select");
		this.workspaceEl.setAttr("data-selection-mode", mode);
		this.syncToolbar();
	}

	/** Zooms out or in so every object on the board is visible at once. */
	fitToContent(): void {
		const rect = this.workspaceEl.getBoundingClientRect();
		const bounds = getCanvasContentBounds(this.activePageDocument(), { x: 0, y: 0, w: 0, h: 0 });
		if (!(bounds.w > 0) || !(bounds.h > 0)) { this.resetView(); return; }
		const pad = 80;
		const scale = clamp(Math.min(rect.width / (bounds.w + pad * 2), rect.height / (bounds.h + pad * 2)), MIN_SCALE, MAX_SCALE);
		this.panToScene(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, scale);
	}

	setTextSize(v: number): void {
		this.textSize = clamp(v, 8, 96);
		this.applyToSelectedTexts(t => { t.fontSize = this.textSize; });
		this.syncToolbar();
	}

	setTextColor(hex: string): void {
		this.textColorChosen = true;
		this.textColor = hex;
		this.applyToSelectedTexts(t => { t.color = hex; });
		this.syncToolbar();
	}

	setTextFont(font: CanvasFont): void {
		this.textFont = font;
		this.applyToSelectedTexts(t => { t.fontFamily = font; });
		this.syncToolbar();
	}

	setShapeKind(kind: ShapeKind): void {
		this.shapeKind = kind;
		this.syncToolbar();
	}

	setShapeFillColor(hex: string): void {
		this.shapeFillColor = hex;
		this.shapeFillEnabled = true;
		this.applyToSelectedShapes(shape => {
			if (!this.isFillableShape(shape.kind)) return;
			shape.fill = hex;
			shape.fillOpacity = this.shapeFillOpacity;
		});
		this.syncToolbar();
	}

	setShapeFillOpacity(opacity: number): void {
		this.shapeFillOpacity = clamp(opacity, 0, 1);
		this.shapeFillEnabled = true;
		this.applyToSelectedShapes(shape => {
			if (!this.isFillableShape(shape.kind)) return;
			shape.fill = this.shapeFillColor;
			shape.fillOpacity = this.shapeFillOpacity;
		});
		this.syncToolbar();
	}

	setShapeFillEnabled(enabled: boolean): void {
		this.shapeFillEnabled = enabled;
		this.applyToSelectedShapes(shape => {
			if (!this.isFillableShape(shape.kind)) return;
			shape.fill = enabled ? this.shapeFillColor : undefined;
			shape.fillOpacity = enabled ? this.shapeFillOpacity : 0;
		});
		this.syncToolbar();
	}

	private intensityAlphaFor(type: "pen" | "highlighter"): number {
		return type === "highlighter" ? this.highlighterIntensity : this.strokeIntensity;
	}

	private derivedColorFor(type: "pen" | "highlighter"): string {
		return type === "highlighter"
			? hexToRgba(this.highlighterColorHex, this.highlighterIntensity)
			: this.strokeIntensity >= 0.999 ? this.penColorHex : hexToRgba(this.penColorHex, this.strokeIntensity);
	}

	/** Applies a mutation to every selected stroke, with history + re-render. */
	private applyToSelectedStrokes(mutate: (s: Stroke) => void): void {
		if (this.selStrokes.size === 0) return;
		this.history.push();
		let touched = false;
		for (const s of this.pageStrokes) {
			if (this.selStrokes.has(s.id)) { mutate(s); touched = true; }
		}
		if (!touched) return;
		this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
		this.save();
	}

	private applyToSelectedShapes(mutate: (shape: Shape) => void): void {
		if (this.selShapes.size === 0) return;
		this.history.push();
		let touched = false;
		for (const shape of this.pageShapes) {
			if (!this.selShapes.has(shape.id)) continue;
			mutate(shape);
			touched = true;
		}
		if (!touched) return;
		this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
		this.save();
	}

	private isFillableShape(kind: ShapeKind): boolean {
		return kind !== "line" && kind !== "arrow";
	}

	/** Applies a mutation to every selected text box, with history + re-render. */
	private applyToSelectedTexts(mutate: (t: TextBox) => void): void {
		if (this.selTexts.size === 0) return;
		this.history.push();
		let touched = false;
		for (const t of this.pageTexts) {
			if (!this.selTexts.has(t.id)) continue;
			mutate(t);
			const el = this.domLayerEl.querySelector(`[data-id="${t.id}"]`) as HTMLElement | null;
			if (el) this.applyTextStyles(el, t);
			touched = true;
		}
		if (touched) this.save();
	}

	setLineColor(hex: string): void {
		this.history.push();
		this.data.lineColor = hex;
		this.updateBackground();
		this.save();
	}

	private updateDerivedColors(): void {
		this.strokeColor = this.strokeIntensity >= 0.999
			? this.penColorHex
			: hexToRgba(this.penColorHex, this.strokeIntensity);
		this.highlighterColor = hexToRgba(this.highlighterColorHex, this.highlighterIntensity);
	}

	setGridSize(size: GridSize): void {
		this.history.push();
		this.data.gridSize = size;
		this.updateBackgroundPosition();
		this.save();
	}

	toggleCalculator(): void {
		this.calculator?.toggle();
		if (this.calculator?.isOpen()) this.closeOtherPanelsIfNarrow("calculator");
		this.syncToolbar();
	}

	/**
	 * On a narrow pane (phone, or a tablet split view) the floating panels
	 * take the full width, so only one can be read at a time: opening one
	 * puts the others away.
	 */
	private lastOpenedPanel: "calculator" | "recorder" | "translator" | "navigator" | null = null;
	private closeOtherPanelsIfNarrow(keep: "calculator" | "recorder" | "translator" | "navigator"): void {
		this.lastOpenedPanel = keep;
		if (this.workspaceEl.getBoundingClientRect().width > 700) return;
		if (keep !== "calculator" && this.calculator?.isOpen()) this.calculator.toggle();
		if (keep !== "recorder" && this.recorder?.isOpen()) this.recorder.toggle();
		if (keep !== "translator" && this.translator?.isOpen()) this.translator.toggle();
		if (keep !== "navigator" && this.navigator?.isOpen()) this.navigator.toggle();
	}

	isCalculatorOpen(): boolean { return this.calculator?.isOpen() ?? false; }

	toggleRecorder(): void {
		this.recorder?.toggle();
		if (this.recorder?.isOpen()) this.closeOtherPanelsIfNarrow("recorder");
		this.syncToolbar();
	}

	isRecorderOpen(): boolean { return this.recorder?.isOpen() ?? false; }
	isTranslatorOpen(): boolean { return this.translator?.isOpen() ?? false; }

	/** Writes the MP3 next to the board's attachments and drops an audio player on the page. */
	async saveRecording(mp3: ArrayBuffer, seconds: number): Promise<void> {
		const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		let path = `Grabacion_${stamp}.mp3`;
		try {
			path = await (this.app.fileManager as any).getAvailablePathForAttachment(path, this.file?.path ?? "");
		} catch { /* vault root when no attachment folder is configured */ }
		const parent = path.split("/").slice(0, -1).join("/");
		if (parent && !this.app.vault.getAbstractFileByPath(parent)) {
			await this.app.vault.createFolder(parent).catch(() => { /* folder already exists */ });
		}
		const saved = await this.app.vault.createBinary(path, mp3);
		this.insertVaultFile(saved);
		new Notice(tr("Grabación guardada ({p0} s): {p1}", { p0: Math.round(seconds), p1: saved.name }));
	}

	setCalculatorUnit(unit: AngleUnit): void { this.calculatorUnit = unit; }

	/** Drops "expresión = resultado" on the board as a text box. */
	insertCalculation(expression: string, result: string): void {
		this.history.push();
		const tb: TextBox = {
			id: genId("text"), pageId: this.data.activePageId, x: 0, y: 0, text: tr("{p0} = {p1}", { p0: expression, p1: result }),
			fontSize: this.textSize, color: this.textColor, fontFamily: this.textFont, variant: "text", autoWidth: true, h: 48
		};
		tb.w = this.measureAutoWidth(tb);
		const at = this.getInsertionPoint(tb.w, tb.h ?? 48);
		tb.x = at.x;
		tb.y = at.y;
		this.data.texts.push(tb);
		this.renderTextBox(tb);
		this.clearSelection(false);
		this.selTexts.add(tb.id);
		this.renderSelectionBox();
		this.save();
	}

	insertMathBlock(): void {
		new InkEquationModal(
			this.app,
			"",
			(source) => this.placeFormula(source),
			(source, into) => {
				try {
					into.appendChild(renderMath(toRenderableLatex(source), true));
					void finishRenderMath();
				} catch {
					into.createSpan({ cls: "notelens-math-placeholder", text: tr("No se puede representar todavía") });
				}
			},
			tidyFormulaText,
			(onProgress) => this.captureBoardFormula(onProgress)
		).open();
	}

	/**
	 * Same region picker as the translator's OCR, but rasterised and read with
	 * the formula recogniser instead of the prose one.
	 */
	private captureBoardFormula(onProgress: (message: string) => void): Promise<string> {
		return this.captureBoardText("__formula__", onProgress);
	}

	/** Language the board reader transcribes in, from the settings. */
	get ocrLanguage(): string { return this.plugin.settings.ocrLanguage || "es"; }
	get translationPrivateOnly(): boolean { return this.plugin.settings.translationPrivateOnly === true; }

	/** Drops a formula on the board and leaves it selected, ready to move. */
	private placeFormula(source: string): void {
		const at = this.getInsertionPoint(320, 70);
		this.history.push();
		const formula: TextBox = {
			id: genId("text"), pageId: this.data.activePageId, x: at.x, y: at.y,
			text: source, fontSize: this.textSize,
			color: isLightColor(this.data.backgroundColor) ? "#111827" : "#f8fafc",
			w: 320, h: 60, fontFamily: this.textFont, variant: "math", autoWidth: true
		};
		this.data.texts.push(formula);
		this.renderTextBox(formula);
		this.clearSelection(false);
		this.selTexts.add(formula.id);
		this.renderSelectionBox();
		this.save();
	}

	setBackground(p: BackgroundPattern): void {
		this.history.push();
		if (p === "margin") {
			this.data.background = "lines";
			this.data.marginEnabled = true;
		} else {
			this.data.background = p;
		}
		this.updateBackground();
		this.save();
	}

	setMarginEnabled(enabled: boolean): void {
		this.history.push();
		if (this.data.background === "margin") this.data.background = "lines";
		this.data.marginEnabled = enabled;
		this.updateBackground();
		this.save();
	}

	setBackgroundColor(hex: string): void {
		this.history.push();
		this.data.backgroundColor = hex;
		this.updateBackground();
		this.save();
	}

	resetView(): void {
		this.history.push();
		this.data.viewTransform = { x: 0, y: 0, scale: 1 };
		this.applyStageTransform();
		this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
		this.syncToolbar();
		this.save();
	}

	getZoomPercent(): number {
		return Math.round(this.data.viewTransform.scale * 100);
	}

	getFocusModeEnabled(): boolean { return this.focusModeEnabled; }

	toggleFocusMode(): void {
		this.focusModeEnabled = !this.focusModeEnabled;
		this.workspaceEl.toggleClass("is-focus-mode", this.focusModeEnabled);
		(this.workspaceEl as any).__refreshFocusMode?.();
	}

	zoomIn(): void { this.zoomBy(1.15); }
	zoomOut(): void { this.zoomBy(1 / 1.15); }

	private zoomBy(factor: number): void {
		const rect = this.workspaceEl.getBoundingClientRect();
		const mouseX = rect.width / 2;
		const mouseY = rect.height / 2;
		const vt = this.data.viewTransform;
		const newScale = clamp(vt.scale * factor, MIN_SCALE, MAX_SCALE);
		vt.x = mouseX - (mouseX - vt.x) * (newScale / vt.scale);
		vt.y = mouseY - (mouseY - vt.y) * (newScale / vt.scale);
		vt.scale = newScale;
		this.applyStageTransform();
		this.renderer.renderAll(this.pageStrokes, this.pageShapes, vt);
		this.syncToolbar();
		this.save();
	}

	private clearCanvas(): void {
		this.history.push();
		this.data.strokes = this.data.strokes.filter(item => !this.belongsToActivePage(item));
		this.data.shapes = this.data.shapes.filter(item => !this.belongsToActivePage(item));
		this.data.badges = this.data.badges.filter(item => !this.belongsToActivePage(item));
		this.data.texts = this.data.texts.filter(item => !this.belongsToActivePage(item));
		this.data.tables = this.data.tables.filter(item => !this.belongsToActivePage(item));
		this.data.embeds = this.data.embeds.filter(item => !this.belongsToActivePage(item));
		this.data.bookmarks = this.data.bookmarks.filter(item => !this.belongsToActivePage(item));
		this.clearSelection(false);
		this.hideFormatBar();
		this.renderAll();
		(this.workspaceEl as any).__refreshBookmarks?.();
		this.refreshTagSummary();
		this.save();
		new Notice(tr("Página limpiada"));
	}

	undo(): void { this.history.undo(); }
	redo(): void { this.history.redo(); }

	insertPdf(): void {
		new PdfPickModal(this.app, (file) => this.insertPdfFile(file)).open();
	}

	private insertPdfFile(file: TFile): void {
		new PdfModeModal(this.app, (mode) => {
			this.history.push();
			const c = this.getViewportCenterScene();
			const w = mode === "pages" ? 700 : 640;
			const h = mode === "pages" ? 0 : 480;
			const embed: Embed = {
				id: genId("embed"), pageId: this.data.activePageId, kind: "pdf", src: file.path,
				x: c.x - w / 2, y: c.y - (h || 500) / 2, w, h, pdfMode: mode
			};
			this.data.embeds.push(embed);
			renderEmbedFrame(this, this.domLayerEl, embed);
			this.save();
		}).open();
	}

	insertVideo(): void {
		new VideoInsertModal(this.app, (embed) => {
			this.history.push();
			embed.pageId = this.data.activePageId;
			const c = this.getViewportCenterScene();
			embed.x = c.x - embed.w / 2;
			embed.y = c.y - embed.h / 2;
			this.data.embeds.push(embed);
			renderEmbedFrame(this, this.domLayerEl, embed);
			this.save();
		}).open();
	}

	insertImage(): void {
		new ImagePickModal(this.app, (file) => {
			this.history.push();
			const c = this.getViewportCenterScene();
			const embed: Embed = {
				id: genId("embed"), pageId: this.data.activePageId, kind: "image", src: file.path,
				x: c.x - 240, y: c.y - 180, w: 480, h: 0
			};
			this.data.embeds.push(embed);
			renderEmbedFrame(this, this.domLayerEl, embed);
			this.save();
		}).open();
	}

	insertFile(): void {
		new VaultFilePickModal(this.app, (file) => this.insertVaultFile(file)).open();
	}

	// ------------------------------------------------------------------
	// Links to other notes and boards
	// ------------------------------------------------------------------

	insertLink(): void {
		new NoteOrBoardPickModal(this.app, this.currentPath, (file) => this.insertVaultFile(file)).open();
	}

	toggleNavigator(): void {
		this.navigator?.toggle();
		if (this.navigator?.isOpen()) this.closeOtherPanelsIfNarrow("navigator");
		this.syncToolbar();
	}

	isNavigatorOpen(): boolean { return this.navigator?.isOpen() ?? false; }

	listBoards(): TFile[] {
		return this.app.vault.getFiles().filter(isBoardFile).sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	listNotes(query: string): TFile[] {
		const q = query.trim().toLowerCase();
		return this.app.vault.getFiles()
			.filter(file => file.extension.toLowerCase() === "md" && (!q || file.path.toLowerCase().includes(q)))
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, q ? 60 : 30);
	}

	openPath(path: string, newLeaf: boolean): void {
		this.openLink(path, newLeaf);
	}

	openLink(path: string, newLeaf: boolean): void {
		if (/^https?:\/\//i.test(path)) { window.open(path, "_blank", "noopener,noreferrer"); return; }
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			void this.app.workspace.openLinkText(path, this.file?.path ?? "", newLeaf);
			return;
		}
		void this.saver?.flush(this.data);
		void this.app.workspace.getLeaf(newLeaf).openFile(file);
	}

	createBoard(): void {
		void this.saver?.flush(this.data);
		void this.plugin.createNewOneNoteFile();
	}

	linkPath(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) this.insertVaultFile(file);
	}

	async uploadFileFromDevice(): Promise<void> {
		const picker = createEl("input");
		picker.type = "file";
		picker.onchange = async () => {
			const localFile = picker.files?.[0];
			if (!localFile) return;
			try {
				const safeName = localFile.name.replace(/[\\/:*?"<>|]/g, "-");
				let path = safeName || `notelens-file-${Date.now()}`;
				try {
					path = await (this.app.fileManager as any).getAvailablePathForAttachment(path, this.file?.path ?? "");
				} catch { /* fall back to the vault root */ }
				const parent = path.split("/").slice(0, -1).join("/");
				if (parent && !this.app.vault.getAbstractFileByPath(parent)) {
					await this.app.vault.createFolder(parent).catch(() => { /* folder already exists */ });
				}
				const saved = await this.app.vault.createBinary(path, await localFile.arrayBuffer());
				this.insertVaultFile(saved);
				new Notice(tr("Archivo añadido: {p0}", { p0: saved.name }));
			} catch (error) {
				console.error("NoteLens: device upload failed", error);
				new Notice(tr("NoteLens: no se pudo añadir el archivo."));
			}
		};
		picker.click();
	}

	/**
	 * The file a piece of text names, when this vault holds it.
	 *
	 * Understands what people actually copy: the full path from the file
	 * explorer (`C:\\…\\Bóveda\\Materia\\Nota.md`), a path relative to the vault,
	 * a `[[wikilink]]`, a `file://` URL and Obsidian's own `obsidian://open`
	 * address. Anything pointing outside the vault is not a file we can show.
	 */
	private vaultFileFromText(text: string): TFile | null {
		const raw = text.trim().replace(/^"|"$/g, "");
		if (!raw || /[\r\n]/.test(raw)) return null;
		let candidate = raw;
		const wiki = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(raw);
		if (wiki) {
			candidate = wiki[1];
		} else if (/^obsidian:\/\//i.test(raw)) {
			try {
				candidate = new URL(raw).searchParams.get("file") ?? "";
			} catch { return null; }
		} else if (/^file:\/\//i.test(raw)) {
			try {
				candidate = decodeURIComponent(new URL(raw).pathname).replace(/^\/([A-Za-z]:)/, "$1");
			} catch { return null; }
		}
		candidate = candidate.replace(/\\/g, "/").trim();
		if (!candidate) return null;
		const base = this.vaultBasePath();
		if (base && candidate.toLowerCase().startsWith(`${base}/`)) candidate = candidate.slice(base.length + 1);
		else if (/^([A-Za-z]:\/|\/)/.test(candidate)) return null;
		const direct = this.app.vault.getAbstractFileByPath(candidate);
		if (direct instanceof TFile) return direct;
		// Only something written as a reference gets looked up by name: pasting a
		// word that happens to match a note must stay the word you pasted.
		const isReference = !!wiki || /^(obsidian|file):\/\//i.test(raw) || candidate.includes("/") || /\.[a-z0-9]{1,6}$/i.test(candidate);
		if (!isReference) return null;
		// A name without its folder, or without the extension, still finds its note.
		return this.app.metadataCache?.getFirstLinkpathDest(candidate.replace(/\.md$/i, ""), this.currentPath ?? "") ?? null;
	}

	/** Where this vault lives on disk, in forward slashes; empty where the app cannot say. */
	private vaultBasePath(): string {
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		if (typeof adapter?.getBasePath !== "function") return "";
		try {
			return adapter.getBasePath().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
		} catch {
			return "";
		}
	}

	private insertVaultFile(file: TFile, at?: { x: number; y: number }): void {
		if (file.extension.toLowerCase() === "pdf") {
			this.insertPdfFile(file);
			return;
		}
		this.history.push();
		const kind = this.embedKindFor(file);
		const c = this.getViewportCenterScene();
		const dimensions = kind === "video" ? { w: 560, h: 315 }
			: kind === "audio" ? { w: 430, h: 130 }
			: kind === "image" ? { w: 480, h: 0 }
			: kind === "note" ? { w: 320, h: 150 }
			: kind === "board" ? { w: 320, h: 96 }
			: { w: 360, h: 112 };
		const spot = at ?? this.getInsertionPoint(dimensions.w, dimensions.h || 120);
		// Cards land where they were asked for; media without a spot is centred on the view.
		const centred = !at && kind !== "note" && kind !== "board";
		const embed: Embed = {
			id: genId("embed"), pageId: this.data.activePageId, kind, src: file.path,
			x: centred ? c.x - dimensions.w / 2 : spot.x,
			y: centred ? c.y - dimensions.h / 2 : spot.y,
			w: dimensions.w, h: dimensions.h
		};
		this.data.embeds.push(embed);
		renderEmbedFrame(this, this.domLayerEl, embed);
		this.save();
	}

	private embedKindFor(file: TFile): EmbedKind {
		const ext = file.extension.toLowerCase();
		if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"].includes(ext)) return "image";
		if (["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"].includes(ext)) return "audio";
		if (["mp4", "webm", "mov", "mkv", "m4v"].includes(ext)) return "video";
		if (ext === "epub") return "epub";
		if (ext === "md") return "note";
		if (isBoardFile(file)) return "board";
		return "file";
	}

	// ------------------------------------------------------------------
	// EmbedHost
	// ------------------------------------------------------------------

	onEmbedChanged(): void { this.save(); }
	onEmbedDeleted(embed: Embed): void {
		this.history.push();
		this.data.embeds.remove(embed);
		this.save();
	}

	shouldPassPointerToCanvas(): boolean {
		return ["pen", "highlighter", "eraser", "shape"].includes(this.currentTool);
	}

	selectEmbed(embed: Embed): void {
		if (this.currentTool !== "select") return;
		this.clearSelection(false);
		this.selEmbeds.add(embed.id);
		this.renderSelectionBox();
	}

	openVaultFile(path: string): void {
		if (/^https?:\/\//i.test(path)) {
			window.open(path, "_blank", "noopener,noreferrer");
			return;
		}
		void this.app.workspace.openLinkText(path, this.file?.path ?? "", true);
	}
	onDragStart(): void { this.history.push(); }
	onDragEnd(): void { this.save(); }

	// ------------------------------------------------------------------
	// Badges
	// ------------------------------------------------------------------

	private onPickTag(tag: QuickTag): void {
		this.commitTextEditor();
		this.currentTool = "place_badge";
		this.activeBadgeTag = tag;
		// Each tag places with its own cursor, so you always see what you are about to drop.
		this.workspaceEl.setAttr("data-badge-tag", tag.id);
		this.hideTextPlacementHint();
		(this.workspaceEl as any).__closePenPanel?.();
		this.syncToolCursor();
		this.syncToolbar();
		new Notice(tr("Toca en el lienzo para colocar: {p0}", { p0: tr(tag.label) }));
	}

	private createBadgeAt(x: number, y: number, tag: QuickTag): void {
		const sourceTitle = tag.label.replace(/^[\p{Extended_Pictographic}‍️\s]+/u, "").trim() || tag.label;
		const defaultTitle = tr(sourceTitle);
		const place = (content: HoverNoteContent) => {
			this.history.push();
			const checklist = content.checklist?.length ? content.checklist : undefined;
			const badge: Badge = {
				id: genId("badge"), pageId: this.data.activePageId, x, y, tagId: tag.id, label: tag.label,
				title: content.title.trim() || defaultTitle,
				tooltip: content.text || undefined,
				sketch: content.sketch,
				images: content.images,
				checklist,
				done: checklist?.length ? checklist.every(item => item.done) : false
			};
			this.data.badges.push(badge);
			this.renderBadge(badge);
			this.save();
			this.currentTool = "pen";
			this.activeBadgeTag = null;
			this.workspaceEl.removeAttribute("data-badge-tag");
			(this.workspaceEl as any).__clearActiveTag?.();
			this.syncToolCursor();
			this.syncToolbar();
		};

		const dialogTitle = tag.id === "tag_hover" ? tr("Nueva nota flotante") : tr("Nueva etiqueta: {p0}", { p0: defaultTitle });
		new HoverNoteModal(this.app, dialogTitle, { title: defaultTitle, text: "" }, (content) => {
			if (content) place(content);
		}, tag.id === "tag_hover" ? undefined : "Añade el contexto de esta etiqueta. También puedes dibujar o adjuntar imágenes desde Pizarra.", tag.id === "tag_todo").open();
	}

	private renderBadge(badge: Badge): void {
		const tag = quickTagById(badge.tagId);
		const el = this.domLayerEl.createDiv({ cls: "onenote-placed-badge" });
		el.setAttr("data-id", badge.id);
		el.style.left = `${badge.x}px`;
		el.style.top = `${badge.y}px`;
		el.setCssStyles({ transformOrigin: "top left" });
		el.style.transform = `scale(${badge.scale ?? 1})`;
		el.style.setProperty("--tag-color", tag.color);
		el.setAttr("data-tag", badge.tagId);
		const hasImages = !!badge.images?.length;
		el.toggleClass("has-sketch", !!badge.sketch || hasImages);
		const checkable = badge.tagId === "tag_todo" || badge.tagId === "tag_question";
		el.toggleClass("is-checkable", checkable);
		el.toggleClass("is-done", !!badge.done);
		const iconEl = el.createSpan({ cls: "onenote-tag-icon" });
		setIcon(iconEl, badge.done ? "check-circle-2" : tag.icon);
		const fallback = tr(badge.label.replace(/^[\p{Extended_Pictographic}‍️\s]+/u, ""));
		const excerpt = badge.title?.trim()
			|| (badge.tagId === "tag_hover" && badge.tooltip ? badge.tooltip.split("\n")[0].slice(0, 48) + (badge.tooltip.length > 48 ? "…" : "") : fallback);
		el.createSpan({ cls: "onenote-badge-label", text: excerpt });
		if (badge.tagId === "tag_todo" && badge.checklist?.length) {
			const completed = badge.checklist.filter(item => item.done).length;
			el.createSpan({ cls: "onenote-badge-progress", text: `${completed}/${badge.checklist.length}` });
		}
		if (badge.sketch) setIcon(el.createSpan({ cls: "onenote-badge-sketch-mark" }), "pen-tool");
		if (hasImages) setIcon(el.createSpan({ cls: "onenote-badge-sketch-mark" }), "image");
		const badgeClose = el.createEl("button", { cls: "onenote-badge-close" });
		setIcon(badgeClose, "x");
		badgeClose.title = tr("Quitar etiqueta");
		badgeClose.addEventListener("pointerdown", (e) => e.stopPropagation());
		badgeClose.addEventListener("click", (e) => {
			e.stopPropagation();
			this.history.push();
			el.remove();
			this.data.badges.remove(badge);
			this.selBadges.delete(badge.id);
			this.refreshTagSummary();
			this.renderSelectionBox();
			this.save();
		});
		if (badge.tagId === "tag_todo" && badge.checklist?.length) {
			const pending = badge.checklist.find(item => !item.done);
			el.title = pending
				? tr("{p0}. Clic completa un paso: «{p1}». Pasa el cursor para marcar el que quieras", { p0: excerpt, p1: pending.text || (pending.sketch ? tr("paso a mano") : tr("sin nombre")) })
				: tr("{p0}. Todos los pasos hechos; clic reabre el último", { p0: excerpt });
		} else if (checkable) el.title = badge.done ? tr("{p0}. Hecho; clic para volver a marcar como pendiente", { p0: excerpt }) : tr("{p0}. Clic para cambiar su estado; doble clic para editar", { p0: excerpt });
		else if (badge.tagId === "tag_hover") el.title = tr("{p0}. Doble clic para editarla", { p0: excerpt });
		else el.title = tr("{p0}. Clic para ver el resumen de etiquetas", { p0: tr(tag.label) });

		let pressedAt = 0;
		el.addEventListener("pointerdown", (e) => {
			pressedAt = performance.now();
			if (this.currentTool !== "select" || e.button !== 0) return;
			e.stopPropagation();
			e.preventDefault();
			this.routeElementDrag(e, "badge", badge.id);
		});
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			// A drag is not a click.
			if (performance.now() - pressedAt > 350) return;
			if (badge.tagId === "tag_todo" && badge.checklist?.length) this.advanceChecklist(badge);
			else if (checkable) this.toggleBadgeDone(badge);
			else if (badge.tagId === "tag_hover") this.showHoverTooltip(badge);
			else this.toggleTagSummary(badge.tagId);
		});
		el.addEventListener("dblclick", (e) => {
			e.stopPropagation();
			e.preventDefault();
			this.editBadgeNote(badge);
		});

		el.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const menu = new Menu();
			menu.addItem(item => item
				.setTitle(badge.tagId === "tag_todo" ? tr("Editar checklist, notas e imágenes") : tr("Editar título, nota e imágenes"))
				.setIcon("pencil")
				.onClick(() => this.editBadgeNote(badge)));
			const menuChecklist = badge.tagId === "tag_todo" ? badge.checklist ?? [] : [];
			if (menuChecklist.length) {
				const pending = menuChecklist.find(item => !item.done);
				if (pending) {
					menu.addItem(item => item
						.setTitle(tr("Completar el siguiente paso: {p0}", { p0: pending.text || (pending.sketch ? tr("paso a mano") : tr("sin nombre")) }))
						.setIcon("square-check-big")
						.onClick(() => this.advanceChecklist(badge)));
				}
				menu.addItem(item => item
					.setTitle(tr("Marcar todos los pasos como hechos"))
					.setIcon("check-circle-2")
					.setDisabled(menuChecklist.every(item => item.done))
					.onClick(() => this.setChecklistAll(badge, true)));
				menu.addItem(item => item
					.setTitle(tr("Marcar todos los pasos como pendientes"))
					.setIcon("circle")
					.setDisabled(menuChecklist.every(item => !item.done))
					.onClick(() => this.setChecklistAll(badge, false)));
			} else if (badge.tagId === "tag_todo" || badge.tagId === "tag_question") {
				menu.addItem(item => item
					.setTitle(badge.done ? tr("Marcar como pendiente") : (badge.tagId === "tag_todo" ? tr("Marcar como hecha") : tr("Marcar como resuelta")))
					.setIcon(badge.done ? "circle" : "check-circle-2")
					.onClick(() => this.toggleBadgeDone(badge)));
			}
			menu.addItem(item => item
				.setTitle(tr("Eliminar etiqueta"))
				.setIcon("trash")
				.onClick(() => {
					this.history.push();
					el.remove();
					this.data.badges.remove(badge);
					this.refreshTagSummary();
					this.save();
				}));
			menu.showAtMouseEvent(e);
		});

		el.addEventListener("pointerenter", () => this.showHoverTooltip(badge));
		el.addEventListener("pointerleave", () => this.scheduleHoverTooltipHide());
	}

	/**
	 * A task badge is done only when every step is. Called after any change to
	 * the checklist so the badge, the summary and the search stay in sync.
	 */
	private syncBadgeDone(badge: Badge): void {
		if (badge.tagId === "tag_todo" && badge.checklist?.length) {
			badge.done = badge.checklist.every(item => item.done);
		}
	}

	/** Repaints one badge in place and refreshes everything that mirrors it. */
	private refreshBadge(badge: Badge): void {
		if (this.belongsToActivePage(badge)) {
			const el = this.domLayerEl.querySelector(`[data-id="${badge.id}"]`) as HTMLElement | null;
			el?.remove();
			this.renderBadge(badge);
		}
		this.refreshTagSummary();
		this.save();
	}

	private toggleBadgeDone(badge: Badge): void {
		this.history.push();
		badge.done = !badge.done;
		this.refreshBadge(badge);
	}

	/** Ticks a single step; the badge follows only when the whole list is done. */
	private toggleChecklistItem(badge: Badge, itemId: string): void {
		const item = badge.checklist?.find(entry => entry.id === itemId);
		if (!item) return;
		this.history.push();
		item.done = !item.done;
		this.syncBadgeDone(badge);
		this.refreshBadge(badge);
		if (this.hoverTooltipBadgeId === badge.id) this.showHoverTooltip(badge);
	}

	/**
	 * Board click on a task with steps: completes the next pending one, or
	 * reopens the last when everything is already done. One step per click.
	 */
	private advanceChecklist(badge: Badge): void {
		const checklist = badge.checklist;
		if (!checklist?.length) return;
		this.history.push();
		const pending = checklist.find(item => !item.done);
		const target = pending ?? [...checklist].reverse().find(item => item.done);
		if (!target) return;
		target.done = !target.done;
		this.syncBadgeDone(badge);
		this.refreshBadge(badge);
		if (this.hoverTooltipBadgeId === badge.id) this.showHoverTooltip(badge);
		const completed = checklist.filter(item => item.done).length;
		new Notice(tr("{p0}: {p1} · {p2}/{p3}", { p0: target.text || (target.sketch ? tr("Paso a mano") : tr("Paso")), p1: target.done ? tr("hecho") : tr("pendiente"), p2: completed, p3: checklist.length }), 2200);
	}

	/** The "todas de esa tarea" path: every step at once, from the context menu. */
	private setChecklistAll(badge: Badge, done: boolean): void {
		if (!badge.checklist?.length) return;
		this.history.push();
		for (const item of badge.checklist) item.done = done;
		this.syncBadgeDone(badge);
		this.refreshBadge(badge);
		if (this.hoverTooltipBadgeId === badge.id) this.showHoverTooltip(badge);
		new Notice(done ? tr("Todos los pasos marcados como hechos") : tr("Todos los pasos marcados como pendientes"), 2200);
	}

	private editBadgeNote(badge: Badge): void {
		const tag = quickTagById(badge.tagId);
		const fallbackTitle = tag.label.replace(/^[\p{Extended_Pictographic}‍️\s]+/u, "").trim() || tag.label;
		const title = badge.tagId === "tag_hover" ? tr("Editar nota flotante") : tr("Editar etiqueta: {p0}", { p0: fallbackTitle });
		new HoverNoteModal(this.app, title, { title: badge.title ?? fallbackTitle, text: badge.tooltip ?? "", sketch: badge.sketch, images: badge.images, checklist: badge.checklist }, (content) => {
			if (!content) return;
			this.history.push();
			badge.title = content.title;
			badge.tooltip = content.text || undefined;
			badge.sketch = content.sketch;
			badge.images = content.images;
			if (badge.tagId === "tag_todo") {
				badge.checklist = content.checklist?.length ? content.checklist : undefined;
				badge.done = !!badge.checklist?.length && badge.checklist.every(item => item.done);
			}
			if (this.belongsToActivePage(badge)) {
				const el = this.domLayerEl.querySelector(`[data-id="${badge.id}"]`) as HTMLElement | null;
				el?.remove();
				this.renderBadge(badge);
			}
			this.refreshTagSummary();
			this.save();
		}, badge.tagId === "tag_hover" ? undefined : "Explica por qué marcaste esto. Aparece al pasar el cursor por la etiqueta.", badge.tagId === "tag_todo").open();
	}

	// ------------------------------------------------------------------
	// Tag summary (OneNote's "Find tags" pane)
	// ------------------------------------------------------------------

	private tagSummaryEl: HTMLElement | null = null;
	private tagSummaryFilter: string | null = null;
	private tagSummaryPageFilter: string | null = null;
	private tagSummaryPendingOnly = false;
	private tagSummaryQuery = "";

	toggleTagSummary(tagId?: string): void {
		if (this.tagSummaryEl && (!tagId || tagId === this.tagSummaryFilter)) {
			this.tagSummaryEl.remove();
			this.tagSummaryEl = null;
			this.tagSummaryQuery = "";
			return;
		}
		this.tagSummaryFilter = tagId ?? null;
		if (!this.tagSummaryEl) {
			const panel = this.workspaceEl.createDiv({ cls: "notelens-tag-summary" });
			for (const type of ["pointerdown", "pointerup", "dblclick"]) panel.addEventListener(type, (e) => e.stopPropagation());
			panel.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
			this.tagSummaryEl = panel;
		}
		this.refreshTagSummary();
	}

	/** Text near a badge, so the summary shows what the tag is about. */
	private badgeContext(badge: Badge): string {
		if (badge.tooltip) return badge.tooltip;
		if (badge.checklist?.length) return badge.checklist.map(item => item.text || (item.sketch ? tr("paso a mano") : "")).filter(Boolean).join(" · ");
		let best: { text: string; d: number } | null = null;
		for (const t of this.data.texts.filter(text => (text.pageId ?? this.data.activePageId) === (badge.pageId ?? this.data.activePageId))) {
			if (!t.text.trim()) continue;
			const cx = t.x + (t.w ?? 200) / 2;
			const cy = t.y + (t.h ?? 40) / 2;
			const d = Math.hypot(cx - badge.x, cy - badge.y);
			if (d < 420 && (!best || d < best.d)) best = { text: t.text, d };
		}
		return best ? best.text.split("\n")[0].slice(0, 80) : "";
	}

	private refreshTagSummary(): void {
		const panel = this.tagSummaryEl;
		if (!panel) return;
		panel.empty();
		const header = panel.createDiv({ cls: "notelens-tag-summary-header" });
		header.createSpan({ text: tr("Etiquetas de la libreta") });
		const closeBtn = header.createEl("button", { cls: "notelens-embed-close" });
		setIcon(closeBtn, "x");
		closeBtn.onclick = () => this.toggleTagSummary();
		let applySearch = () => {};
		const search = createPanelSearch(panel, tr("Buscar etiquetas…"), this.tagSummaryQuery, query => {
			this.tagSummaryQuery = query;
			applySearch();
		});

		const filters = panel.createDiv({ cls: "notelens-tag-summary-filters" });
		const allBtn = filters.createEl("button", { cls: "onenote-tag-chip", text: tr("Todas") });
		allBtn.toggleClass("active", this.tagSummaryFilter === null);
		allBtn.onclick = () => { this.tagSummaryFilter = null; this.refreshTagSummary(); };
		const pageScoped = this.data.badges.filter(b => this.tagSummaryPageFilter === null || (b.pageId ?? this.data.activePageId) === this.tagSummaryPageFilter);
		for (const tag of QUICK_TAGS) {
			const count = pageScoped.filter(b => b.tagId === tag.id).length;
			const chip = filters.createEl("button", { cls: "onenote-tag-chip" });
			chip.style.setProperty("--tag-color", tag.color);
			setIcon(chip.createSpan({ cls: "onenote-tag-icon" }), tag.icon);
			chip.createSpan({ text: tr("{p0} {p1}", { p0: tr(tag.label), p1: count }) });
			chip.toggleClass("active", this.tagSummaryFilter === tag.id);
			chip.onclick = () => { this.tagSummaryFilter = tag.id; this.refreshTagSummary(); };
		}
		// Page filter, shown only when the notebook has more than one page.
		if (this.data.pages.length > 1) {
			if (this.tagSummaryPageFilter && !this.data.pages.some(page => page.id === this.tagSummaryPageFilter)) {
				this.tagSummaryPageFilter = null;
			}
			const pageRow = panel.createDiv({ cls: "notelens-panel-page-filter" });
			const pageSelect = pageRow.createEl("select", { cls: "notelens-panel-page-select" });
			pageSelect.title = tr("Mostrar solo las etiquetas de una página");
			pageSelect.createEl("option", { value: "__all__", text: tr("Todas las páginas ({p0})", { p0: this.data.pages.length }) });
			for (const page of this.data.pages) {
				const counted = this.data.badges.filter(b => (b.pageId ?? this.data.activePageId) === page.id).length;
				pageSelect.createEl("option", { value: page.id, text: tr("{p0} ({p1})", { p0: this.getPageTitle(page.id), p1: counted }) });
			}
			pageSelect.value = this.tagSummaryPageFilter ?? "__all__";
			pageSelect.onchange = () => {
				this.tagSummaryPageFilter = pageSelect.value === "__all__" ? null : pageSelect.value;
				this.refreshTagSummary();
			};
		}

		const pendingRow = panel.createEl("label", { cls: "notelens-fill-toggle" });
		const pendingToggle = pendingRow.createEl("input");
		pendingToggle.type = "checkbox";
		pendingToggle.checked = this.tagSummaryPendingOnly;
		pendingRow.createSpan({ text: tr("Solo pendientes") });
		pendingToggle.onchange = () => { this.tagSummaryPendingOnly = pendingToggle.checked; this.refreshTagSummary(); };

		const list = panel.createDiv({ cls: "notelens-tag-summary-list" });
		const items = this.data.badges
			.filter(b => this.tagSummaryPageFilter === null || (b.pageId ?? this.data.activePageId) === this.tagSummaryPageFilter)
			.filter(b => (this.tagSummaryFilter === null || b.tagId === this.tagSummaryFilter) && !(this.tagSummaryPendingOnly && b.done));
		const empty = list.createDiv({ cls: "notelens-bookmarks-empty hidden" });
		const searchableRows: Array<{ row: HTMLElement; values: Array<string | undefined> }> = [];
		for (const badge of items) {
			const tag = quickTagById(badge.tagId);
			const context = this.badgeContext(badge);
			const pageTitle = this.getPageTitle(badge.pageId);
			const row = list.createDiv({ cls: "notelens-tag-summary-item" });
			row.style.setProperty("--tag-color", tag.color);
			row.toggleClass("is-done", !!badge.done);
			if (badge.tagId === "tag_todo" || badge.tagId === "tag_question") {
				const box = row.createEl("input");
				box.type = "checkbox";
				box.checked = !!badge.done;
				box.title = badge.tagId === "tag_todo" ? tr("Tarea hecha") : tr("Duda resuelta");
				box.onclick = (e) => { e.stopPropagation(); this.toggleBadgeDone(badge); };
			} else {
				setIcon(row.createSpan({ cls: "onenote-tag-icon" }), tag.icon);
			}
			const body = row.createDiv({ cls: "notelens-tag-summary-body" });
			const meta = body.createDiv({ cls: "notelens-tag-summary-meta" });
			meta.createSpan({ cls: "notelens-tag-summary-kind", text: tr(tag.label) });
			meta.createSpan({ cls: "notelens-tag-summary-page", text: pageTitle });
			body.createDiv({ cls: "notelens-tag-summary-text", text: badge.title?.trim() || context || tr("Sin título. Doble clic en la etiqueta para editarla.") });
			if (badge.tagId === "tag_todo" && badge.checklist?.length) {
				const completed = badge.checklist.filter(item => item.done).length;
				const nextItem = badge.checklist.find(item => !item.done);
				const next = nextItem ? (nextItem.text || (nextItem.sketch ? tr("paso a mano") : "")) : undefined;
				const progress = tr("{p0}/{p1} completados", { p0: completed, p1: badge.checklist.length });
				body.createDiv({ cls: "notelens-tag-summary-note", text: next ? tr("{p0} · Siguiente: {p1}", { p0: progress, p1: next }) : progress });
			}
			if (badge.title?.trim() && context && context !== badge.title.trim()) {
				body.createDiv({ cls: "notelens-tag-summary-note", text: context });
			}
			searchableRows.push({
				row,
				values: [tag.label, tr(tag.label), badge.label, badge.title, context, pageTitle, ...(badge.checklist ?? []).map(item => item.text), ...(badge.images ?? []).map(image => image.name), badge.done ? tr("completada resuelta") : tr("pendiente")]
			});
			row.onclick = () => {
				const pageId = badge.pageId ?? this.data.activePageId;
				if (pageId !== this.data.activePageId) this.goToDocumentPage(pageId);
				window.requestAnimationFrame(() => {
					this.panToScene(badge.x, badge.y, Math.max(this.data.viewTransform.scale, 1));
					this.clearSelection(false);
					this.selBadges.add(badge.id);
					this.renderSelectionBox();
				});
			};
		}
		applySearch = () => {
			let visible = 0;
			for (const entry of searchableRows) {
				const matches = matchesPanelSearch(this.tagSummaryQuery, ...entry.values);
				entry.row.toggleClass("hidden", !matches);
				if (matches) visible++;
			}
			if (items.length === 0) {
				empty.setText(this.data.badges.length ? tr("Nada que mostrar con estos filtros.") : tr("Coloca etiquetas desde la fila superior: Importante, Duda, Idea clave, Tarea o Nota flotante."));
				empty.removeClass("hidden");
			} else if (visible === 0) {
				empty.setText(tr("No hay etiquetas que coincidan con la búsqueda."));
				empty.removeClass("hidden");
			} else {
				empty.addClass("hidden");
			}
			search.setCount(visible, items.length);
		};
		applySearch();
		const pending = pageScoped.filter(b => (b.tagId === "tag_todo" || b.tagId === "tag_question") && !b.done).length;
		panel.createDiv({
			cls: "notelens-calculator-help",
			text: pending
				? (pending === 1 ? tr("1 pendiente entre tareas y dudas.") : tr("{p0} pendientes entre tareas y dudas.", { p0: pending }))
				: tr("No hay tareas ni dudas pendientes.")
		});
	}

	/**
	 * Hover card of a placed tag. Every tag type gets its own card: colour,
	 * header, and what it says when the badge has no explanation yet.
	 */
	private showHoverTooltip(badge: Badge): void {
		this.cancelHoverTooltipHide();
		this.hideHoverTooltip();
		const tag = quickTagById(badge.tagId);
		const el = this.domLayerEl.createDiv({ cls: "onenote-top-tooltip" });
		el.setAttr("data-tag", badge.tagId);
		el.style.setProperty("--tag-color", tag.color);
		el.toggleClass("is-done", !!badge.done);
		const checklist = badge.tagId === "tag_todo" ? badge.checklist ?? [] : [];
		const completed = checklist.filter(item => item.done).length;
		const head = el.createDiv({ cls: "onenote-top-tooltip-head" });
		setIcon(head.createSpan({ cls: "onenote-top-tooltip-icon" }), badge.done ? "check-circle-2" : tag.icon);
		const heading: Record<string, string> = {
			tag_star: tr("Importante"),
			tag_question: badge.done ? tr("Duda resuelta") : tr("Duda pendiente"),
			tag_idea: tr("Idea clave"),
			tag_todo: badge.done ? tr("Tarea hecha") : tr("Tarea pendiente"),
			tag_hover: badge.sketch && !badge.tooltip ? tr("Nota dibujada") : tr("Nota flotante")
		};
		head.createSpan({ cls: "onenote-top-tooltip-title", text: heading[badge.tagId] ?? tr(tag.label) });
		if (checklist.length) head.createSpan({ cls: "onenote-top-tooltip-progress", text: `${completed}/${checklist.length}` });
		if (badge.title?.trim()) el.createDiv({ cls: "onenote-top-tooltip-note-title", text: badge.title.trim() });
		if (checklist.length) {
			const list = el.createDiv({ cls: "onenote-top-tooltip-checklist" });
			for (const item of checklist) {
				// Each step is its own button: ticking one never touches the others.
				const row = list.createEl("button", { cls: "onenote-top-tooltip-checklist-item" });
				row.toggleClass("is-done", item.done);
				setIcon(row.createSpan(), item.done ? "square-check-big" : "square");
				if (item.sketch) {
					const handwriting = row.createEl("img", { cls: "onenote-top-tooltip-step-sketch" });
					handwriting.src = item.sketch;
					handwriting.alt = item.text || tr("Paso escrito a mano");
					// Inline, so a stale stylesheet can never let the ink spill out of the card.
					handwriting.setCssStyles({ display: "block", width: "auto", height: "auto", maxWidth: "100%", maxHeight: "68px" });
				} else {
					row.createSpan({ text: item.text });
				}
				row.title = item.done ? tr("Marcar este paso como pendiente") : tr("Marcar solo este paso como hecho");
				row.addEventListener("pointerdown", (event) => event.stopPropagation());
				row.addEventListener("click", (event) => {
					event.stopPropagation();
					event.preventDefault();
					this.toggleChecklistItem(badge, item.id);
				});
			}
			const allDone = completed === checklist.length;
			const bulk = el.createEl("button", { cls: "onenote-top-tooltip-bulk" });
			setIcon(bulk.createSpan(), allDone ? "circle" : "check-check");
			bulk.createSpan({ text: allDone ? tr("Marcar todos como pendientes") : tr("Marcar todos como hechos") });
			bulk.addEventListener("pointerdown", (event) => event.stopPropagation());
			bulk.addEventListener("click", (event) => {
				event.stopPropagation();
				event.preventDefault();
				this.setChecklistAll(badge, !allDone);
			});
		}
		const images = badge.images ?? [];
		if (badge.sketch || images.length) {
			const preview = el.createDiv({ cls: "onenote-top-tooltip-sketch" });
			for (const image of images) {
				const img = preview.createEl("img", { cls: "onenote-top-tooltip-pinned-image" });
				img.src = image.src;
				img.alt = image.name;
				img.style.left = `${image.x / HOVER_NOTE_BOARD_WIDTH * 100}%`;
				img.style.top = `${image.y / HOVER_NOTE_BOARD_HEIGHT * 100}%`;
				img.style.width = `${image.w / HOVER_NOTE_BOARD_WIDTH * 100}%`;
				img.style.height = `${image.h / HOVER_NOTE_BOARD_HEIGHT * 100}%`;
			}
			if (badge.sketch) {
				const drawing = preview.createEl("img", { cls: "onenote-top-tooltip-drawing" });
				drawing.src = badge.sketch;
				drawing.alt = tr("Trazos de la nota");
			}
		}
		if (badge.tooltip) {
			el.createDiv({ cls: "onenote-top-tooltip-body", text: badge.tooltip });
		} else if (!badge.sketch && !images.length && !checklist.length) {
			const hints: Record<string, string> = {
				tag_star: tr("Vuelve aquí al repasar. Doble clic para anotar por qué es importante."),
				tag_question: badge.done ? tr("Ya está resuelta.") : tr("Pregúntalo en clase o búscalo. Clic para marcarla resuelta."),
				tag_idea: tr("El concepto que hay que recordar. Doble clic para resumirlo."),
				tag_todo: badge.done ? tr("Completada.") : tr("Clic para marcarla hecha. Doble clic para añadir pasos."),
				tag_hover: tr("Doble clic para escribir o dibujar la nota.")
			};
			const near = this.badgeContext(badge);
			el.createDiv({ cls: "onenote-top-tooltip-hint", text: near ? tr("Junto a: «{p0}»", { p0: near }) : (hints[badge.tagId] ?? "") });
			if (near) el.createDiv({ cls: "onenote-top-tooltip-hint", text: hints[badge.tagId] ?? "" });
		}
		// Choose the side using the card's real size, so image notes never cover the top docks.
		const badgeEl = this.domLayerEl.querySelector(`[data-id="${badge.id}"]`) as HTMLElement | null;
		const badgeW = (badgeEl?.offsetWidth ?? 120) * (badge.scale ?? 1);
		const badgeH = (badgeEl?.offsetHeight ?? 28) * (badge.scale ?? 1);
		const vt = this.data.viewTransform;
		const screenTop = vt.y + badge.y * vt.scale;
		const viewport = this.workspaceEl.getBoundingClientRect();
		const cardScreenH = el.offsetHeight * vt.scale;
		const roomAbove = screenTop - 170;
		const roomBelow = viewport.height - (screenTop + badgeH * vt.scale) - 62;
		const below = roomAbove < cardScreenH + 14 && (roomBelow >= cardScreenH + 14 || roomBelow > roomAbove);
		el.toggleClass("is-below", below);
		const desiredScreenX = vt.x + (badge.x + badgeW / 2) * vt.scale;
		const halfCardScreenW = el.offsetWidth * vt.scale / 2;
		const minScreenX = halfCardScreenW + 12;
		const maxScreenX = viewport.width - halfCardScreenW - 12;
		const safeScreenX = minScreenX <= maxScreenX ? clamp(desiredScreenX, minScreenX, maxScreenX) : viewport.width / 2;
		el.style.left = `${(safeScreenX - vt.x) / vt.scale}px`;
		el.style.top = below ? `${badge.y + badgeH + 12}px` : `${badge.y - 10}px`;
		// Task cards are interactive, so the pointer must be able to reach them.
		const interactive = checklist.length > 0;
		el.toggleClass("is-interactive", interactive);
		if (interactive) {
			el.addEventListener("pointerenter", () => this.cancelHoverTooltipHide());
			el.addEventListener("pointerleave", () => this.scheduleHoverTooltipHide());
		}
		this.hoverTooltipEl = el;
		this.hoverTooltipBadgeId = badge.id;
	}

	private cancelHoverTooltipHide(): void {
		if (this.hoverTooltipHideTimer === null) return;
		window.clearTimeout(this.hoverTooltipHideTimer);
		this.hoverTooltipHideTimer = null;
	}

	/** Small grace period so moving from the badge onto its card does not close it. */
	private scheduleHoverTooltipHide(): void {
		this.cancelHoverTooltipHide();
		this.hoverTooltipHideTimer = window.setTimeout(() => {
			this.hoverTooltipHideTimer = null;
			this.hideHoverTooltip();
		}, 220);
	}

	private hideHoverTooltip(): void {
		this.cancelHoverTooltipHide();
		this.hoverTooltipEl?.remove();
		this.hoverTooltipEl = null;
		this.hoverTooltipBadgeId = null;
	}

	// ------------------------------------------------------------------
	// Text boxes
	// ------------------------------------------------------------------

	private createTextBoxAt(x: number, y: number, stickyColor?: string, variant: "text" | "code" | "math" = "text"): void {
		this.history.push();
		this.clearSelection();
		const tb: TextBox = {
			id: genId("text"), pageId: this.data.activePageId, x, y,
			text: "", fontSize: this.textSize,
			color: stickyColor ? "#302b19" : variant === "code" ? "#e2e8f0" : this.textColor || (isLightColor(this.data.backgroundColor) ? "#111827" : "#f8fafc"),
			stickyColor,
			w: stickyColor ? 220 : variant === "code" ? 440 : variant === "math" ? 320 : 160,
			h: stickyColor ? 150 : variant === "code" ? 180 : variant === "math" ? 60 : 48,
			autoWidth: !stickyColor && variant === "text",
			fontFamily: variant === "code" ? "mono" : stickyColor ? "rounded" : this.textFont,
			variant,
			language: variant === "code" ? "plaintext" : undefined
		};
		this.data.texts.push(tb);
		const el = this.renderTextBox(tb);
		this.save();
		this.beginTextEdit(tb, el);
	}

	addStickyNote(): void {
		const c = this.getInsertionPoint(220, 150);
		this.createStickyNoteAt(c.x, c.y);
	}

	insertCodeBlock(): void {
		const c = this.getInsertionPoint(440, 180);
		this.createTextBoxAt(c.x, c.y, undefined, "code");
	}

	insertTable(): void {
		const c = this.getInsertionPoint(520, 220);
		this.insertTableAt(c.x, c.y);
	}

	private insertTableAt(x: number, y: number): void {
		this.history.push();
		const table: CanvasTable = {
			id: genId("table"), pageId: this.data.activePageId, x, y,
			w: 520, h: 220, rows: 3, cols: 3, header: false,
			cells: [["", "", ""], ["", "", ""], ["", "", ""]]
		};
		this.data.tables.push(table);
		const el = this.renderTable(table);
		this.save();
		(el.querySelector(".notelens-table-cell") as HTMLTextAreaElement | null)?.focus();
	}

	/**
	 * Dictation: the browser speech API needs Google services that Obsidian's
	 * Electron build does not ship, so it never worked there. The operating
	 * system's own dictation does work in any focused text field and needs no
	 * connection, so open a text box, focus it and point the user to it.
	 */
	startDictation(): void {
		const at = this.getInsertionPoint(320, 48);
		this.createTextBoxAt(at.x, at.y);
		const editor = this.activeTextEditor;
		if (!editor) return;
		const isMac = Platform.isMacOS || Platform.isIosApp;
		const shortcut = isMac ? "pulsa Fn dos veces (o Control dos veces)" : "pulsa Win+H";
		const hint = this.domLayerEl.createDiv({ cls: "notelens-dictation-hint" });
		setIcon(hint.createSpan(), "mic");
		hint.createSpan({ text: tr(" Dictado: {p0} y habla. Se escribe aquí. Esc termina.", { p0: shortcut }) });
		hint.style.left = `${at.x}px`;
		hint.style.top = `${at.y + 56}px`;
		const remove = () => { hint.remove(); editor.removeEventListener("blur", remove); };
		editor.addEventListener("blur", remove);
		editor.focus();
		new Notice(tr("Dictado del sistema: {p0} con el cuadro de texto activo. Funciona sin conexión.", { p0: shortcut }), 7000);
	}

	getViewportBookmarks(): ViewportBookmark[] {
		return this.data.bookmarks;
	}

	get aiBaseUrl(): string { return this.plugin.settings.aiBaseUrl; }
	get aiModel(): string { return this.plugin.settings.aiModel; }

	setAiModel(model: string): void {
		this.plugin.settings.aiModel = model;
		void this.plugin.saveSettings();
	}

	/** Leen is behind a flag until his release; see src/features.ts. */
	private assistantWanted(): boolean {
		return EXPERIMENTAL.assistant && this.plugin.settings.showAssistantPet;
	}

	get assistantName(): string { return this.plugin.settings.assistantName || "Leen"; }

	get petScale(): number { return this.plugin.settings.petScale ?? 1; }
	get petBubbles(): boolean { return this.plugin.settings.petBubbles !== false; }
	get aiUseBoardContext(): boolean { return this.plugin.settings.aiUseBoardContext === true; }

	/** Opens Obsidian's settings on the NoteLens tab. */
	openPluginSettings(): void {
		const app = this.app as unknown as {
			setting?: { open(): void; openTabById(id: string): void };
		};
		try {
			app.setting?.open();
			app.setting?.openTabById(this.plugin.manifest.id);
		} catch {
			new Notice(tr("Abre Ajustes › Plugins de la comunidad › NoteLens"));
		}
	}

	getPetPosition(): { x: number | null; y: number | null } {
		return { x: this.plugin.settings.petX, y: this.plugin.settings.petY };
	}

	setPetPosition(x: number, y: number): void {
		this.plugin.settings.petX = Math.min(Math.max(x, 0), 1);
		this.plugin.settings.petY = Math.min(Math.max(y, 0), 1);
		void this.plugin.saveSettings();
	}

	setAssistantName(name: string): void {
		this.plugin.settings.assistantName = name.trim().slice(0, 24) || "Leen";
		void this.plugin.saveSettings();
	}

	/**
	 * Carries out one thing the assistant asked for and describes it in Spanish,
	 * so the chat can report exactly what landed on the board.
	 */
	runAssistantAction(action: AssistantAction): string {
		const body = action.body.trim();
		if (!body) return "nada que escribir";
		switch (action.kind) {
			case "posit": {
				const palette: Record<string, string> = {
					amarillo: "#fff2a8", naranja: "#ffd9a0", rosa: "#ffd7e5",
					verde: "#d8f5c9", azul: "#cde8ff", lila: "#eadbff", blanco: "#f4f1e8"
				};
				const color = palette[(action.color ?? "").toLowerCase()] ?? "#fff2a8";
				const at = this.getInsertionPoint(220, 150);
				this.history.push();
				const note: TextBox = {
					id: genId("text"), pageId: this.data.activePageId, x: at.x, y: at.y,
					text: body.slice(0, 400), fontSize: this.textSize, color: "#302b19",
					stickyColor: color, w: 220, h: 150, fontFamily: "rounded", variant: "text"
				};
				this.data.texts.push(note);
				this.renderTextBox(note);
				this.save();
				return "un posit";
			}
			case "latex": {
				const at = this.getInsertionPoint(320, 70);
				this.history.push();
				const formula: TextBox = {
					id: genId("text"), pageId: this.data.activePageId, x: at.x, y: at.y,
					text: body.slice(0, 400), fontSize: this.textSize,
					color: isLightColor(this.data.backgroundColor) ? "#111827" : "#f8fafc",
					w: 320, h: 60, fontFamily: this.textFont, variant: "math", autoWidth: true
				};
				this.data.texts.push(formula);
				this.renderTextBox(formula);
				this.save();
				return "una fórmula";
			}
			case "tarea": {
				const parts = body.split(/\s*;\s*/).filter(Boolean);
				const title = parts.shift() ?? "Tarea";
				const at = this.getInsertionPoint(220, 60);
				this.history.push();
				const badge: Badge = {
					id: genId("badge"), pageId: this.data.activePageId, x: at.x, y: at.y,
					tagId: "tag_todo", label: "Tarea", title: title.slice(0, 120),
					checklist: parts.slice(0, 12).map(step => ({ id: genId("task_item"), text: step.slice(0, 200), done: false })),
					done: false
				};
				this.data.badges.push(badge);
				this.renderBadge(badge);
				this.refreshTagSummary();
				this.save();
				return parts.length ? `una tarea con ${parts.length} paso${parts.length === 1 ? "" : "s"}` : "una tarea";
			}
			default: {
				this.insertAssistantText(body);
				return "un cuadro de texto";
			}
		}
	}

	/** Everything readable on the current page, so the assistant can use it as context. */
	getBoardText(): string {
		const parts: string[] = [];
		for (const text of this.data.texts) {
			if (!this.belongsToActivePage(text) || !text.text.trim()) continue;
			parts.push(text.text.trim());
		}
		for (const table of this.data.tables) {
			if (!this.belongsToActivePage(table)) continue;
			const rows = table.cells.map(row => row.join(" | ").trim()).filter(Boolean);
			if (rows.length) parts.push(`${table.title?.trim() || "Tabla"}:\n${rows.join("\n")}`);
		}
		for (const badge of this.data.badges) {
			if (!this.belongsToActivePage(badge)) continue;
			const steps = (badge.checklist ?? []).map(item => `- [${item.done ? "x" : " "}] ${item.text || "(paso a mano)"}`);
			const body = [badge.title?.trim(), badge.tooltip?.trim(), ...steps].filter(Boolean).join("\n");
			if (body) parts.push(`${quickTagById(badge.tagId).label}: ${body}`);
		}
		return parts.join("\n\n");
	}

	/** Text belonging only to the active selection; local tools prefer this. */
	getSelectionText(): string {
		if (!this.hasSelection()) return "";
		const parts: string[] = [];
		for (const text of this.pageTexts) {
			if (this.selTexts.has(text.id) && text.text.trim()) parts.push(text.text.trim());
		}
		for (const table of this.pageTables) {
			if (!this.selTables.has(table.id)) continue;
			const rows = table.cells.map(row => row.join(" | ").trim()).filter(Boolean);
			if (rows.length) parts.push(`${table.title?.trim() || "Tabla"}:\n${rows.join("\n")}`);
		}
		for (const badge of this.pageBadges) {
			if (!this.selBadges.has(badge.id)) continue;
			const steps = (badge.checklist ?? []).map(item => `- [${item.done ? "x" : " "}] ${item.text || "(paso a mano)"}`);
			const body = [badge.title?.trim(), badge.tooltip?.trim(), ...steps].filter(Boolean).join("\n");
			if (body) parts.push(`${quickTagById(badge.tagId).label}: ${body}`);
		}
		return parts.join("\n\n");
	}

	openFormulaReader(): void {
		this.insertMathBlock();
	}

	/** Fast board operations exposed by the local assistant. */
	runBoardUtility(utility: BoardUtility): string {
		if (utility === "polish-ink") {
			const strokes = this.pageStrokes.filter(stroke => this.selStrokes.has(stroke.id));
			if (!strokes.length) return tr("Selecciona uno o varios trazos para pulir la tinta");
			this.history.push();
			for (const stroke of strokes) {
				if (stroke.points.length < 3) continue;
				const first = stroke.points[0];
				const last = stroke.points[stroke.points.length - 1];
				const chord = Math.hypot(last.x - first.x, last.y - first.y);
				let path = 0;
				for (let i = 1; i < stroke.points.length; i++) path += Math.hypot(stroke.points[i].x - stroke.points[i - 1].x, stroke.points[i].y - stroke.points[i - 1].y);
				if (chord > 12 && chord / Math.max(path, 0.01) > 0.94) {
					// Preserve pressure samples while snapping an intentional line.
					stroke.points = stroke.points.map((point, index) => {
						const t = index / Math.max(1, stroke.points.length - 1);
						return { x: first.x + (last.x - first.x) * t, y: first.y + (last.y - first.y) * t, p: point.p };
					});
				} else {
					const original = stroke.points;
					stroke.points = original.map((point, index) => {
						if (index === 0 || index === original.length - 1) return point;
						const before = original[index - 1], after = original[index + 1];
						return {
							x: before.x * 0.2 + point.x * 0.6 + after.x * 0.2,
							y: before.y * 0.2 + point.y * 0.6 + after.y * 0.2,
							p: before.p * 0.15 + point.p * 0.7 + after.p * 0.15
						};
					});
				}
			}
			this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
			this.renderSelectionBox();
			this.save();
			return `${strokes.length} trazo${strokes.length === 1 ? "" : "s"} suavizado${strokes.length === 1 ? "" : "s"}`;
		}

		interface LayoutItem { x: number; y: number; w: number; h: number; move(x: number, y: number): void }
		const items: LayoutItem[] = [];
		for (const shape of this.pageShapes) if (this.selShapes.has(shape.id)) items.push({ x: shape.x, y: shape.y, w: shape.w, h: shape.h, move: (x, y) => { shape.x = x; shape.y = y; } });
		for (const badge of this.pageBadges) if (this.selBadges.has(badge.id)) {
			const scale = badge.scale ?? 1;
			items.push({ x: badge.x, y: badge.y, w: 150 * scale, h: 38 * scale, move: (x, y) => { badge.x = x; badge.y = y; } });
		}
		for (const text of this.pageTexts) if (this.selTexts.has(text.id)) items.push({ x: text.x, y: text.y, w: text.w ?? 260, h: text.h ?? 60, move: (x, y) => { text.x = x; text.y = y; } });
		for (const table of this.pageTables) if (this.selTables.has(table.id)) items.push({ x: table.x, y: table.y, w: table.w, h: table.h, move: (x, y) => { table.x = x; table.y = y; } });
		for (const embed of this.pageEmbeds) if (this.selEmbeds.has(embed.id)) items.push({ x: embed.x, y: embed.y, w: embed.w, h: embed.h, move: (x, y) => { embed.x = x; embed.y = y; } });
		if (items.length < 2) return tr("Selecciona al menos dos objetos para ordenarlos");

		this.history.push();
		items.sort((a, b) => a.y - b.y || a.x - b.x);
		const originX = Math.min(...items.map(item => item.x));
		const originY = Math.min(...items.map(item => item.y));
		const columns = Math.max(1, Math.ceil(Math.sqrt(items.length)));
		const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(...items.filter((_item, index) => index % columns === column).map(item => item.w), 0));
		const rows = Math.ceil(items.length / columns);
		const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...items.slice(row * columns, (row + 1) * columns).map(item => item.h), 0));
		const gap = 28;
		const columnX = columnWidths.map((_width, index) => originX + columnWidths.slice(0, index).reduce((sum, width) => sum + width + gap, 0));
		const rowY = rowHeights.map((_height, index) => originY + rowHeights.slice(0, index).reduce((sum, height) => sum + height + gap, 0));
		items.forEach((item, index) => item.move(columnX[index % columns], rowY[Math.floor(index / columns)]));
		this.renderAll();
		this.renderSelectionBox();
		this.save();
		return `${items.length} objetos ordenados en una cuadrícula`;
	}

	/** Drops an assistant answer on the board as a text box you can edit. */
	insertAssistantText(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;
		this.history.push();
		const at = this.getInsertionPoint(420, 160);
		const tb: TextBox = {
			id: genId("text"), pageId: this.data.activePageId, x: at.x, y: at.y,
			text: trimmed, fontSize: this.textSize,
			color: isLightColor(this.data.backgroundColor) ? "#111827" : "#f8fafc",
			w: 420, autoWidth: false, fontFamily: this.textFont, variant: "text"
		};
		this.data.texts.push(tb);
		this.renderTextBox(tb);
		this.clearSelection(false);
		this.selTexts.add(tb.id);
		this.renderSelectionBox();
		this.save();
	}

	getDocumentPages(): DocumentPage[] { return this.data.pages; }
	getActivePageId(): string { return this.data.activePageId; }
	getPageTitle(id = this.data.activePageId): string {
		return this.data.pages.find(page => page.id === id)?.title ?? tr("Página");
	}

	addDocumentPage(): void {
		this.commitTextEditor();
		this.syncActivePageMeta();
		this.history.push();
		const page = createDocumentPage(tr("Página {p0}", { p0: this.data.pages.length + 1 }), {
			background: this.data.background,
			marginEnabled: this.marginEnabled,
			backgroundColor: this.data.backgroundColor,
			lineColor: this.data.lineColor,
			gridSize: this.data.gridSize
		});
		this.data.pages.push(page);
		this.applyPageMeta(page);
		this.clearSelection(false);
		this.closeSearch();
		this.hideHoverTooltip();
		this.renderAll();
		this.updateBackground();
		this.syncToolbar();
		(this.workspaceEl as any).__refreshPages?.(page.id);
		(this.workspaceEl as any).__refreshBookmarks?.();
		this.refreshTagSummary();
		this.save();
	}

	goToDocumentPage(id: string): void {
		const page = this.data.pages.find(item => item.id === id);
		if (!page || page.id === this.data.activePageId) return;
		this.commitTextEditor();
		this.syncActivePageMeta();
		this.applyPageMeta(page);
		this.clearSelection(false);
		this.closeSearch();
		this.hideHoverTooltip();
		this.hideFormatBar();
		this.renderAll();
		this.updateBackground();
		this.syncToolbar();
		(this.workspaceEl as any).__refreshPages?.();
		(this.workspaceEl as any).__refreshBookmarks?.();
		this.refreshTagSummary();
		this.save();
	}

	renameDocumentPage(id: string, title: string): void {
		const page = this.data.pages.find(item => item.id === id);
		const clean = title.trim().slice(0, 80);
		if (!page || !clean || page.title === clean) return;
		this.history.push();
		page.title = clean;
		(this.workspaceEl as any).__refreshPages?.();
		(this.workspaceEl as any).__refreshBookmarks?.();
		this.refreshTagSummary();
		this.save();
	}

	deleteDocumentPage(id: string): void {
		if (this.data.pages.length <= 1) {
			new Notice(tr("La libreta debe conservar al menos una página."));
			return;
		}
		const index = this.data.pages.findIndex(page => page.id === id);
		if (index < 0) return;
		this.commitTextEditor();
		this.syncActivePageMeta();
		this.history.push();
		const wasActive = id === this.data.activePageId;
		this.data.pages.splice(index, 1);
		this.data.strokes = this.data.strokes.filter(item => item.pageId !== id);
		this.data.shapes = this.data.shapes.filter(item => item.pageId !== id);
		this.data.badges = this.data.badges.filter(item => item.pageId !== id);
		this.data.texts = this.data.texts.filter(item => item.pageId !== id);
		this.data.tables = this.data.tables.filter(item => item.pageId !== id);
		this.data.embeds = this.data.embeds.filter(item => item.pageId !== id);
		this.data.bookmarks = this.data.bookmarks.filter(item => item.pageId !== id);
		if (wasActive) this.applyPageMeta(this.data.pages[Math.min(index, this.data.pages.length - 1)]);
		this.clearSelection(false);
		this.closeSearch();
		this.renderAll();
		this.updateBackground();
		this.syncToolbar();
		(this.workspaceEl as any).__refreshPages?.();
		(this.workspaceEl as any).__refreshBookmarks?.();
		this.refreshTagSummary();
		this.save();
		new Notice(tr("Página eliminada. Puedes recuperarla con Ctrl+Z."));
	}

	/**
	 * Saves the current view at once, without a dialog in the way: the new
	 * bookmark opens in the list with its name selected so typing renames it.
	 */
	addViewportBookmark(): void {
		const label = tr("Sección {p0}", { p0: this.data.bookmarks.length + 1 });
		const c = this.getViewportCenterScene();
		this.history.push();
		const bookmark: ViewportBookmark = { id: genId("bookmark"), pageId: this.data.activePageId, label, x: c.x, y: c.y, scale: this.data.viewTransform.scale };
		this.data.bookmarks.push(bookmark);
		(this.workspaceEl as any).__refreshBookmarks?.(bookmark.id);
		this.save();
	}

	renameViewportBookmark(id: string, label: string): void {
		const bookmark = this.data.bookmarks.find(item => item.id === id);
		if (!bookmark || !label.trim()) return;
		this.history.push();
		bookmark.label = label.trim();
		(this.workspaceEl as any).__refreshBookmarks?.();
		this.save();
	}

	deleteViewportBookmark(id: string): void {
		const bookmark = this.data.bookmarks.find(item => item.id === id);
		if (!bookmark) return;
		this.history.push();
		this.data.bookmarks.remove(bookmark);
		(this.workspaceEl as any).__refreshBookmarks?.();
		this.save();
	}

	goToViewportBookmark(id: string): void {
		const bookmark = this.data.bookmarks.find(item => item.id === id);
		if (!bookmark) return;
		const pageId = bookmark.pageId ?? this.data.activePageId;
		if (pageId !== this.data.activePageId) this.goToDocumentPage(pageId);
		window.requestAnimationFrame(() => this.panToScene(bookmark.x, bookmark.y, bookmark.scale));
	}

	private panToScene(sceneX: number, sceneY: number, targetScale = this.data.viewTransform.scale): void {
		const rect = this.workspaceEl.getBoundingClientRect();
		const start = { ...this.data.viewTransform };
		const scale = clamp(targetScale, MIN_SCALE, MAX_SCALE);
		const target = { x: rect.width / 2 - sceneX * scale, y: rect.height / 2 - sceneY * scale, scale };
		const started = performance.now();
		const duration = 320;
		const animate = (now: number) => {
			const t = Math.min(1, (now - started) / duration);
			const eased = 1 - Math.pow(1 - t, 3);
			this.data.viewTransform.x = start.x + (target.x - start.x) * eased;
			this.data.viewTransform.y = start.y + (target.y - start.y) * eased;
			this.data.viewTransform.scale = start.scale + (target.scale - start.scale) * eased;
			this.applyStageTransform();
			this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
			if (t < 1) window.requestAnimationFrame(animate);
			else {
				this.syncToolbar();
				this.save();
			}
		};
		window.requestAnimationFrame(animate);
	}

	/**
	 * Pictures of every formula on the page, taken from the boxes on screen, in
	 * ink colour: the export page is white whatever the board looks like.
	 */
	private async rasterizeFormulas(doc: OneNoteDocument): Promise<Map<string, RasterImage>> {
		const out = new Map<string, RasterImage>();
		for (const tb of doc.texts) {
			if (tb.variant !== "math") continue;
			const box = this.domLayerEl.querySelector<HTMLElement>(`.notelens-math-block[data-id="${tb.id}"]`);
			const math = box?.querySelector<HTMLElement>("mjx-container");
			if (!math) continue;
			const image = await rasterizeMath(math, "#111827");
			if (image) out.set(tb.id, { ...image, dx: math.offsetLeft, dy: math.offsetTop });
		}
		return out;
	}

	async exportA4Pdf(): Promise<void> {
		try {
			const page = this.activePageDocument();
			const bytes = createA4Pdf(page, this.getViewportSceneBounds(), await this.rasterizeFormulas(page));
			const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			const base = `NoteLens-${stamp}.pdf`;
			let path = base;
			try {
				path = await (this.app.fileManager as any).getAvailablePathForAttachment(base, this.file?.path ?? "");
			} catch { /* use vault root when no attachment folder is configured */ }
			const parent = path.split("/").slice(0, -1).join("/");
			if (parent && !this.app.vault.getAbstractFileByPath(parent)) {
				await this.app.vault.createFolder(parent).catch(() => { /* folder already exists */ });
			}
			const saved = await this.app.vault.createBinary(path, bytes);
			new Notice(tr("PDF A4 creado: {p0}", { p0: saved.name }));
			void this.app.workspace.openLinkText(saved.path, this.file?.path ?? "", true);
		} catch (error) {
			console.error("NoteLens: PDF export failed", error);
			new Notice(tr("No se pudo exportar el PDF A4."));
		}
	}

	async exportSharePackage(): Promise<void> {
		try {
			new Notice(tr("Preparando paquete editable de NoteLens..."));
			this.syncActivePageMeta();
			const title = this.file?.basename ?? "Pizarra NoteLens";
			const result = await buildSharePackage(this.app, this.data, title);
			const name = `${title.replace(/[\\/:*?"<>|]/g, "-") || "Pizarra NoteLens"}.nlshare`;
			let path = name;
			try {
				path = await (this.app.fileManager as any).getAvailablePathForAttachment(name, this.file?.path ?? "");
			} catch { /* place it in the vault root when attachments are not configured */ }
			const parent = path.split("/").slice(0, -1).join("/");
			if (parent && !this.app.vault.getAbstractFileByPath(parent)) {
				await this.app.vault.createFolder(parent).catch(() => { /* folder already exists */ });
			}
			const saved = await this.app.vault.createBinary(path, result.bytes);
			const skipped = result.skippedAssets.length ? ` (${result.skippedAssets.length} adjunto(s) no disponible(s))` : "";
			new Notice(tr("Paquete editable creado: {p0}{p1}", { p0: saved.name, p1: skipped }));
		} catch (error) {
			console.error("NoteLens: share export failed", error);
			new Notice(tr("No se pudo crear el paquete para compartir."));
		}
	}

	async importSharePackage(): Promise<void> {
		const picker = createEl("input");
		picker.type = "file";
		picker.accept = ".nlshare,application/zip,application/x-notelens";
		picker.onchange = async () => {
			const source = picker.files?.[0];
			if (!source) return;
			try {
				new Notice(tr("Importando pizarra editable de NoteLens..."));
				const result = await importShareArchive(this.app, source, this.file?.parent?.path ?? "");
				const missing = result.missingAssets.length ? ` (${result.missingAssets.length} adjunto(s) no se pudieron recuperar)` : "";
				new Notice(tr("Pizarra importada: {p0}{p1}", { p0: result.file.basename, p1: missing }));
				const leaf = this.app.workspace.getLeaf(true);
				await leaf.openFile(result.file);
			} catch (error) {
				console.error("NoteLens: share import failed", error);
				new Notice(tr("No se pudo importar el paquete de NoteLens."));
			}
		};
		picker.click();
	}

	/** Translate button: opens the floating translator, preloaded with the selection or the box being edited. */
	translateText(): void {
		this.translator?.open();
		this.closeOtherPanelsIfNarrow("translator");
		this.syncToolbar();
	}

	setTranslateLanguages(from: string, to: string): void {
		this.plugin.settings.translateFrom = from;
		this.plugin.settings.translateTo = to;
		void this.plugin.saveSettings();
	}

	getTranslationSource(): TranslationSource {
		const editor = this.activeTextEditor;
		if (editor) return { text: this.editorPlainText(editor), kind: "editor", count: 1 };
		const targets = this.translatableSelection();
		if (targets.length) return { text: targets.map(t => t.text).join("\n\n"), kind: "selection", count: targets.length };
		return { text: "", kind: "none", count: 0 };
	}

	private translatableSelection(): TextBox[] {
		return this.data.texts.filter(t => this.selTexts.has(t.id) && t.variant !== "code" && t.variant !== "math" && t.text.trim());
	}

	replaceTranslationTarget(text: string): void {
		const editor = this.activeTextEditor;
		if (editor) {
			this.pushEditSession();
			if (editor instanceof HTMLTextAreaElement) {
				editor.value = text;
				editor.dispatchEvent(new Event("input"));
				return;
			}
			// A rich box: swap every word, which also reports the edit like typing does.
			editor.focus();
			selectOffsets(editor, 0, editableText(editor).length);
			document.execCommand("insertText", false, text);
			return;
		}
		const targets = this.translatableSelection();
		if (targets.length === 0) { new Notice(tr("Selecciona el cuadro de texto que quieres sustituir.")); return; }
		this.history.push();
		if (targets.length === 1) {
			targets[0].text = text;
		} else {
			// Several boxes were joined with blank lines; hand each its own part when the count matches.
			const parts = text.split(/\n\s*\n/);
			targets.forEach((t, i) => { t.text = parts.length === targets.length ? parts[i].trim() : (i === 0 ? text : ""); });
		}
		this.renderAll();
		this.clearSelection(false);
		for (const t of targets) this.selTexts.add(t.id);
		this.renderSelectionBox();
		this.save();
	}

	addTranslationToBoard(text: string): void {
		this.history.push();
		const editorId = this.activeTextSourceEl?.getAttribute("data-id");
		const anchor = editorId ? this.data.texts.find(t => t.id === editorId) : this.translatableSelection()[0];
		const tb: TextBox = {
			id: genId("text"), pageId: this.data.activePageId, x: 0, y: 0, text, fontSize: this.textSize, color: anchor?.color ?? this.textColor,
			fontFamily: anchor?.fontFamily ?? this.textFont, variant: "text", autoWidth: true, h: 48
		};
		tb.w = anchor?.w ?? this.measureAutoWidth(tb);
		if (anchor) {
			const el = this.domLayerEl.querySelector(`[data-id="${anchor.id}"]`) as HTMLElement | null;
			tb.x = anchor.x;
			tb.y = anchor.y + (el?.offsetHeight ?? anchor.h ?? 48) + 12;
		} else {
			const at = this.getInsertionPoint(tb.w, tb.h ?? 48);
			tb.x = at.x;
			tb.y = at.y;
		}
		this.data.texts.push(tb);
		this.renderTextBox(tb);
		this.clearSelection(false);
		this.selTexts.add(tb.id);
		this.renderSelectionBox();
		this.save();
	}

	private getViewportSceneBounds(): { x: number; y: number; w: number; h: number } {
		const rect = this.workspaceEl.getBoundingClientRect();
		const vt = this.data.viewTransform;
		return { x: -vt.x / vt.scale, y: -vt.y / vt.scale, w: rect.width / vt.scale, h: rect.height / vt.scale };
	}

	private createStickyNoteAt(x: number, y: number, color = this.plugin.settings.defaultStickyColor || STICKY_COLORS[0]): void {
		this.createTextBoxAt(x, y, color);
	}

	private tableColumnWidths(table: CanvasTable): number[] {
		if (table.colWidths && table.colWidths.length === table.cols) return table.colWidths;
		return Array.from({ length: table.cols }, () => table.w / table.cols);
	}

	private tableRowHeights(table: CanvasTable): number[] {
		if (table.rowHeights && table.rowHeights.length === table.rows) return table.rowHeights;
		return Array.from({ length: table.rows }, () => Math.max(32, (table.h - 30) / table.rows));
	}

	private renderTable(table: CanvasTable): HTMLElement {
		const el = this.domLayerEl.createDiv({ cls: "notelens-table" });
		el.setAttr("data-id", table.id);
		el.style.left = `${table.x}px`;
		el.style.top = `${table.y}px`;
		el.style.width = `${table.w}px`;
		el.style.height = `${table.h}px`;
		el.style.transform = table.rotation ? `rotate(${table.rotation}deg)` : "";

		const header = el.createDiv({ cls: "notelens-table-header" });
		const titleEl = header.createSpan({ cls: "notelens-table-title", text: table.title?.trim() || "Tabla" });
		titleEl.title = tr("Doble clic para renombrar la tabla");
		titleEl.addEventListener("dblclick", (event) => { event.stopPropagation(); this.renameTable(table, titleEl); });
		const controls = header.createDiv({ cls: "notelens-table-controls" });
		const control = (icon: string, title: string, action: () => void) => {
			const button = controls.createEl("button", { cls: "notelens-table-control" });
			setIcon(button, icon);
			button.title = tr(title);
			button.addEventListener("pointerdown", (event) => event.stopPropagation());
			button.onclick = (event) => { event.stopPropagation(); action(); };
		};
		const headerBtn = controls.createEl("button", { cls: "notelens-table-control" });
		setIcon(headerBtn, "heading");
		headerBtn.title = table.header ? tr("Quitar la fila de encabezado") : tr("Usar la primera fila como encabezado");
		headerBtn.toggleClass("active", !!table.header);
		headerBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
		headerBtn.onclick = (event) => { event.stopPropagation(); this.history.push(); table.header = !table.header; this.renderAll(); this.save(); };
		control("rows-3", "Añadir fila al final", () => this.insertTableRow(table, table.rows));
		control("columns-3", "Añadir columna al final", () => this.insertTableColumn(table, table.cols));
		control("bar-chart-3", "Crear un gráfico con estos datos", () => this.chartFromTable(table));
		control("trash-2", "Eliminar tabla", () => {
			this.history.push();
			this.data.tables.remove(table);
			el.remove();
			this.save();
		});

		header.addEventListener("pointerdown", (event) => {
			if (this.currentTool !== "select" || event.button !== 0) return;
			event.stopPropagation();
			event.preventDefault();
			this.routeElementDrag(event, "table", table.id);
		});

		const widths = this.tableColumnWidths(table);
		const heights = this.tableRowHeights(table);
		const grid = el.createDiv({ cls: "notelens-table-grid" });
		grid.style.gridTemplateColumns = widths.map(w => `${w}px`).join(" ");
		grid.style.gridTemplateRows = heights.map(h => `minmax(${h}px, auto)`).join(" ");
		for (let row = 0; row < table.rows; row++) {
			for (let col = 0; col < table.cols; col++) {
				const input = grid.createEl("textarea", { cls: "notelens-table-cell" });
				if (table.header && row === 0) input.addClass("is-header");
				if (table.headerColumn && col === 0) input.addClass("is-header-column");
				input.placeholder = table.header && row === 0 ? tr("Título") : "";
				input.value = table.cells[row]?.[col] ?? "";
				input.setAttr("aria-label", `Fila ${row + 1}, columna ${col + 1}`);
				input.addEventListener("pointerdown", (event) => event.stopPropagation());
				input.addEventListener("input", () => {
					table.cells[row][col] = input.value;
					this.save();
				});
				input.addEventListener("contextmenu", (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.showTableCellMenu(event, table, row, col);
				});
			}
		}

		// Borders between columns and rows can be dragged, like in OneNote.
		let offset = 0;
		for (let col = 0; col < table.cols - 1; col++) {
			offset += widths[col];
			const handle = grid.createDiv({ cls: "notelens-table-col-handle" });
			handle.style.left = `${offset}px`;
			handle.title = tr("Arrastra para cambiar el ancho de la columna");
			handle.addEventListener("pointerdown", (event) => this.startTableColumnResize(event, table, col));
		}
		offset = 0;
		for (let row = 0; row < table.rows - 1; row++) {
			offset += heights[row];
			const handle = grid.createDiv({ cls: "notelens-table-row-handle" });
			handle.style.top = `${offset}px`;
			handle.title = tr("Arrastra para cambiar el alto de la fila");
			handle.addEventListener("pointerdown", (event) => this.startTableRowResize(event, table, row));
		}

		const resize = el.createDiv({ cls: "notelens-table-resize" });
		resize.title = tr("Redimensionar tabla");
		resize.addEventListener("pointerdown", (event) => this.startTableResize(event, table, el));
		el.addEventListener("dblclick", (event) => {
			if (this.currentTool !== "select") return;
			event.stopPropagation();
			this.selectAt(this.getSceneCoords(event.clientX, event.clientY), table.id);
		});
		el.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			this.showTableCellMenu(event, table, -1, -1);
		});
		return el;
	}

	private showTableCellMenu(event: MouseEvent, table: CanvasTable, row: number, col: number): void {
		const menu = new Menu();
		if (row >= 0) {
			menu.addItem(item => item.setTitle(tr("Insertar fila arriba")).setIcon("arrow-up-to-line").onClick(() => this.insertTableRow(table, row)));
			menu.addItem(item => item.setTitle(tr("Insertar fila debajo")).setIcon("arrow-down-to-line").onClick(() => this.insertTableRow(table, row + 1)));
			menu.addItem(item => item.setTitle(tr("Insertar columna a la izquierda")).setIcon("arrow-left-to-line").onClick(() => this.insertTableColumn(table, col)));
			menu.addItem(item => item.setTitle(tr("Insertar columna a la derecha")).setIcon("arrow-right-to-line").onClick(() => this.insertTableColumn(table, col + 1)));
			menu.addSeparator();
			menu.addItem(item => item.setTitle(tr("Eliminar esta fila")).setIcon("minus").onClick(() => this.deleteTableRow(table, row)));
			menu.addItem(item => item.setTitle(tr("Eliminar esta columna")).setIcon("minus").onClick(() => this.deleteTableColumn(table, col)));
			menu.addSeparator();
		}
		menu.addItem(item => item.setTitle(table.header ? "Quitar fila de encabezado" : "Primera fila como encabezado").setIcon("heading").onClick(() => {
			this.history.push();
			table.header = !table.header;
			this.renderAll();
			this.save();
		}));
		menu.addItem(item => item.setTitle(table.headerColumn ? "Quitar columna de encabezado" : "Primera columna como encabezado").setIcon("panel-left").onClick(() => {
			this.history.push();
			table.headerColumn = !table.headerColumn;
			this.renderAll();
			this.save();
		}));
		menu.addItem(item => item.setTitle(tr("Repartir columnas por igual")).setIcon("columns-3").onClick(() => {
			this.history.push();
			table.colWidths = undefined;
			table.rowHeights = undefined;
			this.renderAll();
			this.save();
		}));
		menu.addItem(item => item.setTitle(tr("Renombrar tabla")).setIcon("pencil").onClick(() => {
			const titleEl = this.domLayerEl.querySelector(`[data-id="${table.id}"] .notelens-table-title`) as HTMLElement | null;
			if (titleEl) this.renameTable(table, titleEl);
		}));
		menu.addItem(item => item.setTitle(tr("Crear gráfico con estos datos")).setIcon("bar-chart-3").onClick(() => this.chartFromTable(table)));
		menu.addSeparator();
		menu.addItem(item => item.setTitle(tr("Eliminar tabla")).setIcon("trash-2").onClick(() => {
			this.history.push();
			this.data.tables.remove(table);
			this.renderAll();
			this.save();
		}));
		menu.showAtMouseEvent(event);
	}

	private insertTableRow(table: CanvasTable, at: number): void {
		if (table.rows >= 40) return;
		this.history.push();
		const heights = this.tableRowHeights(table);
		const index = clamp(at, 0, table.rows);
		table.cells.splice(index, 0, Array.from({ length: table.cols }, () => ""));
		heights.splice(index, 0, 36);
		table.rows++;
		table.rowHeights = heights;
		table.h = 30 + heights.reduce((n, h) => n + h, 0);
		this.renderAll();
		this.save();
	}

	private insertTableColumn(table: CanvasTable, at: number): void {
		if (table.cols >= 24) return;
		this.history.push();
		const widths = this.tableColumnWidths(table);
		const index = clamp(at, 0, table.cols);
		for (const row of table.cells) row.splice(index, 0, "");
		const width = clamp(table.w / (table.cols + 1), 60, 240);
		widths.splice(index, 0, width);
		table.cols++;
		table.colWidths = widths;
		table.w = widths.reduce((n, w) => n + w, 0);
		this.renderAll();
		this.save();
	}

	private deleteTableRow(table: CanvasTable, row: number): void {
		if (table.rows <= 1) return;
		this.history.push();
		const heights = this.tableRowHeights(table);
		table.cells.splice(row, 1);
		heights.splice(row, 1);
		table.rows--;
		table.rowHeights = heights;
		table.h = 30 + heights.reduce((n, h) => n + h, 0);
		this.renderAll();
		this.save();
	}

	private deleteTableColumn(table: CanvasTable, col: number): void {
		if (table.cols <= 1) return;
		this.history.push();
		const widths = this.tableColumnWidths(table);
		for (const row of table.cells) row.splice(col, 1);
		widths.splice(col, 1);
		table.cols--;
		table.colWidths = widths;
		table.w = widths.reduce((n, w) => n + w, 0);
		this.renderAll();
		this.save();
	}

	private startTableColumnResize(event: PointerEvent, table: CanvasTable, col: number): void {
		event.stopPropagation();
		event.preventDefault();
		this.history.push();
		const widths = [...this.tableColumnWidths(table)];
		const startX = event.clientX;
		const scale = this.data.viewTransform.scale;
		const el = this.domLayerEl.querySelector(`[data-id="${table.id}"]`) as HTMLElement | null;
		const grid = el?.querySelector(".notelens-table-grid") as HTMLElement | null;
		const onMove = (move: PointerEvent) => {
			const delta = (move.clientX - startX) / scale;
			const next = [...widths];
			next[col] = clamp(widths[col] + delta, 40, 800);
			table.colWidths = next;
			table.w = next.reduce((n, w) => n + w, 0);
			if (grid) grid.style.gridTemplateColumns = next.map(w => `${w}px`).join(" ");
			if (el) el.style.width = `${table.w}px`;
			this.renderSelectionBox();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove, { capture: true });
			window.removeEventListener("pointerup", onUp, { capture: true });
			this.renderAll();
			this.save();
		};
		window.addEventListener("pointermove", onMove, { capture: true });
		window.addEventListener("pointerup", onUp, { capture: true });
	}

	private startTableRowResize(event: PointerEvent, table: CanvasTable, row: number): void {
		event.stopPropagation();
		event.preventDefault();
		this.history.push();
		const heights = [...this.tableRowHeights(table)];
		const startY = event.clientY;
		const scale = this.data.viewTransform.scale;
		const el = this.domLayerEl.querySelector(`[data-id="${table.id}"]`) as HTMLElement | null;
		const grid = el?.querySelector(".notelens-table-grid") as HTMLElement | null;
		const onMove = (move: PointerEvent) => {
			const delta = (move.clientY - startY) / scale;
			const next = [...heights];
			next[row] = clamp(heights[row] + delta, 28, 600);
			table.rowHeights = next;
			table.h = 30 + next.reduce((n, h) => n + h, 0);
			if (grid) grid.style.gridTemplateRows = next.map(h => `minmax(${h}px, auto)`).join(" ");
			if (el) el.style.height = `${table.h}px`;
			this.renderSelectionBox();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove, { capture: true });
			window.removeEventListener("pointerup", onUp, { capture: true });
			this.renderAll();
			this.save();
		};
		window.addEventListener("pointermove", onMove, { capture: true });
		window.addEventListener("pointerup", onUp, { capture: true });
	}

	private startTableResize(event: PointerEvent, table: CanvasTable, el: HTMLElement): void {
		event.stopPropagation();
		event.preventDefault();
		this.history.push();
		const startX = event.clientX;
		const startY = event.clientY;
		const startW = table.w;
		const startH = table.h;
		const widths = [...this.tableColumnWidths(table)];
		const heights = [...this.tableRowHeights(table)];
		const scale = this.data.viewTransform.scale;
		const grid = el.querySelector(".notelens-table-grid") as HTMLElement | null;
		const onMove = (move: PointerEvent) => {
			table.w = clamp(startW + (move.clientX - startX) / scale, 220, 1400);
			table.h = clamp(startH + (move.clientY - startY) / scale, 120, 1200);
			// Columns and rows keep their proportions while the whole table scales.
			table.colWidths = widths.map(w => w * table.w / startW);
			table.rowHeights = heights.map(h => h * (table.h - 30) / Math.max(1, startH - 30));
			if (grid) {
				grid.style.gridTemplateColumns = table.colWidths.map(w => `${w}px`).join(" ");
				grid.style.gridTemplateRows = table.rowHeights.map(h => `minmax(${h}px, auto)`).join(" ");
			}
			el.style.width = `${table.w}px`;
			el.style.height = `${table.h}px`;
			this.renderSelectionBox();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove, { capture: true });
			window.removeEventListener("pointerup", onUp, { capture: true });
			this.renderAll();
			this.save();
		};
		window.addEventListener("pointermove", onMove, { capture: true });
		window.addEventListener("pointerup", onUp, { capture: true });
	}

	// ------------------------------------------------------------------
	// Charts
	// ------------------------------------------------------------------

	insertChart(): void {
		new ChartEditorModal(this.app, DEFAULT_CHART, (spec) => this.placeChart(spec)).open();
	}

	/** Inline rename of a table: the header label turns into an input; Enter saves, Esc cancels. */
	private renameTable(table: CanvasTable, titleEl: HTMLElement): void {
		const input = createEl("input", { cls: "notelens-table-rename", type: "text", value: table.title?.trim() || "Tabla" });
		titleEl.replaceWith(input);
		for (const type of ["pointerdown", "pointerup", "dblclick"]) input.addEventListener(type, (event) => event.stopPropagation());
		let done = false;
		const finish = (commit: boolean) => {
			if (done) return;
			done = true;
			const label = input.value.trim();
			if (commit && label && label !== (table.title ?? "Tabla")) {
				this.history.push();
				table.title = label === "Tabla" ? undefined : label;
				this.save();
			}
			titleEl.setText(table.title?.trim() || "Tabla");
			input.replaceWith(titleEl);
		};
		input.addEventListener("keydown", (event) => {
			event.stopPropagation();
			if (event.key === "Enter") { event.preventDefault(); finish(true); }
			else if (event.key === "Escape") { event.preventDefault(); finish(false); }
		});
		input.addEventListener("blur", () => finish(true));
		input.focus();
		input.select();
	}

	private chartFromTable(table: CanvasTable): void {
		const spec = specFromTable(table);
		if (table.title?.trim()) spec.title = table.title.trim();
		new ChartEditorModal(this.app, spec, (saved) => this.placeChart(saved, { x: table.x, y: table.y + table.h + 16 })).open();
	}

	private placeChart(spec: ChartData, at?: { x: number; y: number }): void {
		this.history.push();
		const size = { w: 460, h: 300 };
		const pos = at ?? this.getInsertionPoint(size.w, size.h);
		const embed: Embed = { id: genId("embed"), pageId: this.data.activePageId, kind: "chart", src: "chart", chart: spec, x: pos.x, y: pos.y, w: size.w, h: size.h };
		this.data.embeds.push(embed);
		renderEmbedFrame(this, this.domLayerEl, embed);
		this.clearSelection(false);
		this.selEmbeds.add(embed.id);
		this.renderSelectionBox();
		this.save();
	}

	editChart(embed: Embed): void {
		new ChartEditorModal(this.app, embed.chart ?? DEFAULT_CHART, (spec) => {
			this.history.push();
			embed.chart = spec;
			const el = this.domLayerEl.querySelector(`[data-id="${embed.id}"]`);
			el?.remove();
			renderEmbedFrame(this, this.domLayerEl, embed);
			this.renderSelectionBox();
			this.save();
		}).open();
	}

	private renderTextBox(tb: TextBox): HTMLElement {
		const el = this.domLayerEl.createDiv({ cls: "onenote-textbox" });
		if (tb.stickyColor) el.addClass("notelens-sticky-note");
		if (tb.variant === "code") {
			el.addClass("notelens-code-block");
			el.setAttr("data-language", tb.language || "plaintext");
		}
		if (tb.variant === "math") el.addClass("notelens-math-block");
		el.setAttr("data-id", tb.id);
		el.style.left = `${tb.x}px`;
		el.style.top = `${tb.y}px`;
		el.style.transform = tb.rotation
			? `rotate(${tb.rotation}deg)`
			: tb.stickyColor ? `rotate(var(--sticky-tilt, 0deg))` : "";
		el.contentEditable = "false";
		el.setAttr("role", "textbox");
		// Styles first: a run only writes down what it changes about the box.
		this.applyTextStyles(el, tb);
		this.paintTextContent(el, tb);
		this.syncFittedSize(el, tb);

		this.attachBoxChrome(el, tb);

		el.addEventListener("pointerdown", (e) => {
			if (this.currentTool === "select" && e.button === 0) {
				e.stopPropagation();
				e.preventDefault();
				this.routeElementDrag(e, "text", tb.id);
			} else if (this.currentTool === "text" && e.button === 0) {
				e.stopPropagation();
				e.preventDefault();
				this.beginTextEdit(tb, el);
			}
		});

		// Double-click edits with any tool that lets the box receive the pointer
		// (select or text). A single click with the select tool selects or drags it.
		el.addEventListener("dblclick", (e) => {
			e.stopPropagation();
			e.preventDefault();
			this.beginTextEdit(tb, el);
		});

		el.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

		el.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const menu = new Menu();
			menu.addItem(item => item
				.setTitle(tr("Eliminar cuadro de texto"))
				.setIcon("trash")
				.onClick(() => {
					this.history.push();
					this.hideFormatBar();
					el.remove();
					this.data.texts.remove(tb);
					this.save();
				}));
			menu.showAtMouseEvent(e);
		});

		return el;
	}

	/**
	 * Writing on a phone. The tap that makes a box is also what raises the
	 * keyboard, so the focus has to survive the rest of that gesture; and the
	 * keyboard then covers the bottom half of the screen, which is exactly where
	 * a box tapped low on the board sits. The board slides up so what is being
	 * written stays in sight, and slides back when the keyboard goes away.
	 */
	private keepEditorUsableOnTouch(editor: HTMLElement): void {
		if (!Platform.isMobile) return;
		// A synthesised tap can move focus away right after it was given.
		window.setTimeout(() => {
			if (editor.isConnected && document.activeElement !== editor) editor.focus();
		}, 0);

		const viewport = window.visualViewport;
		if (!viewport) return;
		let lifted = 0;
		const settle = () => {
			if (!editor.isConnected) return;
			const covered = window.innerHeight - (viewport.height + viewport.offsetTop);
			const keyboard = covered > 120 ? covered : 0;
			const box = editor.getBoundingClientRect();
			const room = window.innerHeight - keyboard - 12;
			// Measured from where the box would sit with no lift at all, or the
			// answer would change the moment it moved and the board would jitter.
			const restingBottom = box.bottom + lifted;
			const restingTop = box.top + lifted;
			// Only ever move by what is needed, and never past the top docks.
			const wanted = restingBottom > room ? Math.min(restingBottom - room, Math.max(0, restingTop - 150)) : 0;
			const delta = wanted - lifted;
			if (Math.abs(delta) < 1) return;
			lifted = wanted;
			this.data.viewTransform.y -= delta;
			this.applyStageTransform();
			this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
		};
		const stop = () => {
			viewport.removeEventListener("resize", settle);
			viewport.removeEventListener("scroll", settle);
			if (lifted) {
				this.data.viewTransform.y += lifted;
				lifted = 0;
				this.applyStageTransform();
				this.renderer.renderAll(this.pageStrokes, this.pageShapes, this.data.viewTransform);
			}
		};
		viewport.addEventListener("resize", settle);
		viewport.addEventListener("scroll", settle);
		editor.addEventListener("blur", stop, { once: true });
		this.register(stop);
		window.setTimeout(settle, 250);
	}

	private beginTextEdit(tb: TextBox, el: HTMLElement): void {
		if (this.activeTextSourceEl === el && this.activeTextEditor) {
			this.activeTextEditor.focus();
			return;
		}
		this.commitTextEditor();
		this.hideTextPlacementHint();
		this.editSessionPushed = false;
		// Prose is edited as it will look; code and formulas keep their source.
		if (tb.variant !== "code" && tb.variant !== "math") { this.beginRichEdit(tb, el); return; }
		const editor = this.domLayerEl.createEl("textarea", { cls: "notelens-text-editor" });
		if (tb.variant === "code") {
			editor.addClass("notelens-code-editor");
			editor.setAttr("wrap", "off");
			editor.spellcheck = false;
			editor.placeholder = tr("Escribe o pega código. Tab indenta, Ctrl+Enter termina.");
		}
		if (tb.variant === "math") {
			editor.addClass("notelens-math-editor");
			editor.placeholder = tr("Escribe como en la calculadora: x^2/2 + sqrt(x), sum_(i=1)^n i, int_0^1 x^2 dx, [[a,b],[c,d]]. También vale LaTeX.");
			this.mathPreviewEl = this.domLayerEl.createDiv({ cls: "notelens-math-preview" });
			this.mathPreviewEl.style.left = `${tb.x}px`;
			this.mathPreviewEl.style.top = `${tb.y + (tb.h ?? 60) + 8}px`;
			this.mathPreviewEl.style.minWidth = `${tb.w ?? 320}px`;
		}
		editor.value = tb.text;
		editor.style.left = `${tb.x}px`;
		editor.style.top = `${tb.y}px`;
		this.applyTextStyles(editor, tb);
		if (tb.variant === "math") {
			editor.style.width = `${Math.max(320, tb.w ?? 320)}px`;
			this.refreshMathPreview(tb);
		}
		editor.style.height = `${Math.max(tb.h ?? 48, editor.scrollHeight + 4)}px`;
		el.setCssStyles({ visibility: "hidden" });
		this.activeTextEditor = editor;
		this.activeTextSourceEl = el;
		const openedAt = performance.now();
		editor.focus();
		editor.setSelectionRange(editor.value.length, editor.value.length);
		this.keepEditorUsableOnTouch(editor);
		editor.addEventListener("pointerdown", (e) => e.stopPropagation());
		editor.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
		editor.addEventListener("input", () => {
			this.pushEditSession();
			tb.text = editor.value;
			if (tb.variant === "math") this.refreshMathPreview(tb);
			if (tb.autoWidth) {
				tb.w = this.measureAutoWidth(tb);
				editor.style.width = `${tb.w}px`;
			}
			editor.setCssStyles({ height: "auto" });
			tb.h = Math.max(48, editor.scrollHeight + 4);
			editor.style.height = `${tb.h}px`;
			this.save();
		});
		editor.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				this.commitTextEditor();
			} else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
				e.preventDefault();
				// An explicit finish must not be mistaken for the short focus-steal guard used just after opening.
				this.commitTextEditor();
			} else if (e.key === "Tab") {
				// Tab must never leave the editor: it indents (Shift+Tab outdents).
				e.preventDefault();
				this.indentInEditor(editor, e.shiftKey, tb.variant === "code" ? "    " : "\t");
				editor.dispatchEvent(new Event("input"));
			} else if (e.key === "Enter" && tb.variant === "code" && !e.shiftKey) {
				e.preventDefault();
				this.newlineKeepingIndent(editor);
				editor.dispatchEvent(new Event("input"));
			} else if (e.key === "Enter" && tb.variant !== "code" && !e.shiftKey && continueList(editor)) {
				e.preventDefault();
				editor.dispatchEvent(new Event("input"));
			}
		});
		editor.addEventListener("blur", (event) => {
			const next = event.relatedTarget as Node | null;
			if (next && this.formatBarEl?.contains(next)) return;
			// A focus steal in the same click that opened the editor is not
			// the user leaving: take the focus back instead of committing.
			if (!next && editor.isConnected && performance.now() - openedAt < 250) {
				window.requestAnimationFrame(() => { if (this.activeTextEditor === editor) editor.focus(); });
				return;
			}
			this.commitTextEditor();
		});
		this.showFormatBar(tb, editor);
	}

	/**
	 * Opens a text box for editing in place: the words carry their own weight,
	 * underline, colour and highlight while they are typed, because the box being
	 * edited is the same rich element the board paints.
	 */
	private beginRichEdit(tb: TextBox, el: HTMLElement): void {
		const editor = this.domLayerEl.createDiv({ cls: "notelens-text-editor notelens-rich-editor" });
		editor.contentEditable = "true";
		editor.setAttr("role", "textbox");
		editor.setAttr("aria-multiline", "true");
		editor.setAttr("data-placeholder", tr("Escribe aquí"));
		editor.style.left = `${tb.x}px`;
		editor.style.top = `${tb.y}px`;
		this.applyTextStyles(editor, tb);
		this.fillRichEditor(editor, tb);
		editor.toggleClass("is-empty", !editableText(editor).trim());
		editor.style.height = `${Math.max(tb.h ?? 48, editor.scrollHeight + 4)}px`;
		el.setCssStyles({ visibility: "hidden" });
		this.activeTextEditor = editor;
		this.activeTextSourceEl = el;
		const openedAt = performance.now();
		// Formatting as inline styles rather than <b>/<font>: one shape to read back.
		try { document.execCommand("styleWithCSS", false, "true"); } catch { /* older builds format with tags; the reader copes */ }
		editor.focus();
		const end = editableText(editor).length;
		selectOffsets(editor, end, end);
		this.keepEditorUsableOnTouch(editor);

		editor.addEventListener("pointerdown", (e) => e.stopPropagation());
		editor.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
		editor.addEventListener("paste", (e) => {
			// The words only: pasted HTML would drag foreign fonts and colours onto the board.
			e.preventDefault();
			const text = e.clipboardData?.getData("text/plain") ?? "";
			if (text) document.execCommand("insertText", false, text);
		});
		editor.addEventListener("input", () => {
			this.pushEditSession();
			this.syncRichText(tb, editor);
			this.resizeRichEditor(tb, editor);
			this.save();
		});
		editor.addEventListener("keydown", (e) => this.richEditorKey(e, editor));
		editor.addEventListener("blur", (event) => {
			const next = event.relatedTarget as Node | null;
			if (next && this.formatBarEl?.contains(next)) return;
			if (!next && editor.isConnected && performance.now() - openedAt < 250) {
				window.requestAnimationFrame(() => { if (this.activeTextEditor === editor) editor.focus(); });
				return;
			}
			this.commitTextEditor();
		});
		this.showFormatBar(tb, editor);
	}

	/** Fills the editor with the runs of the box, or with what its old marks meant. */
	private fillRichEditor(editor: HTMLElement, tb: TextBox): void {
		editor.empty();
		const runs = tb.runs?.length ? tb.runs : runsFromInline(tb.text, tb.highlight || DEFAULT_TEXT_HIGHLIGHT);
		renderRuns(editor, runs, this.baseStyle(editor, tb), (parent, text) => parent.appendText(text));
	}

	/** What the box looks like before any run overrides it. */
	private baseStyle(el: HTMLElement, tb: TextBox): BaseStyle {
		return {
			bold: !!tb.bold,
			italic: !!tb.italic,
			underline: !!tb.underline,
			strike: !!tb.strike,
			color: getComputedStyle(el).color
		};
	}

	/**
	 * Stores what is on screen. The runs are the truth; `text` keeps the same
	 * words with Markdown marks so search, the summary tools and the exports go
	 * on reading a box as text.
	 */
	private syncRichText(tb: TextBox, editor: HTMLElement): void {
		const runs = readRuns(editor, this.baseStyle(editor, tb));
		tb.runs = runs.length ? runs : undefined;
		tb.text = runs.length ? runsToMarked(runs) : "";
	}

	private resizeRichEditor(tb: TextBox, editor: HTMLElement): void {
		// A box the browser left a stray <br> in is still empty to the eye, so the
		// hint is decided by the words rather than by the markup.
		editor.toggleClass("is-empty", !editableText(editor).trim());
		if (tb.autoWidth) {
			tb.w = this.measureAutoWidth(tb);
			editor.style.width = `${tb.w}px`;
		}
		editor.setCssStyles({ height: "auto" });
		tb.h = Math.max(48, editor.scrollHeight + 4);
		editor.style.height = `${tb.h}px`;
	}

	private richEditorKey(e: KeyboardEvent, editor: HTMLElement): void {
		const mod = e.ctrlKey || e.metaKey;
		if (e.key === "Escape" || (mod && e.key === "Enter")) {
			e.preventDefault();
			this.commitTextEditor();
			return;
		}
		// Ctrl+B, Ctrl+I and Ctrl+U are the browser's own: let them through, but
		// keep them from reaching Obsidian's shortcuts behind the board.
		if (mod && !e.altKey && ["b", "i", "u"].includes(e.key.toLowerCase())) {
			e.stopPropagation();
			return;
		}
		if (e.key === "Tab") {
			e.preventDefault();
			document.execCommand("insertText", false, "\t");
			return;
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (!this.continueRichList(editor)) document.execCommand("insertLineBreak");
		}
	}

	/** Enter inside a list item starts the next one; on an empty item it leaves the list. */
	private continueRichList(editor: HTMLElement): boolean {
		const text = editableText(editor);
		const { from, to } = selectionOffsets(editor);
		if (from !== to) return false;
		const lineStart = text.lastIndexOf("\n", from - 1) + 1;
		const line = text.slice(lineStart, from);
		const kind = listKindOf(line);
		if (!kind) return false;
		if (!line.replace(LIST_PREFIX, "").trim()) {
			selectOffsets(editor, lineStart, from);
			document.execCommand("delete");
			return true;
		}
		const indent = /^\s*/.exec(line)?.[0] ?? "";
		const numbered = kind === "number" ? parseInt(line.trim(), 10) : NaN;
		const mark = Number.isFinite(numbered) ? `${numbered + 1}. ` : LIST_MARK[kind];
		document.execCommand("insertLineBreak");
		document.execCommand("insertText", false, indent + mark);
		return true;
	}

	/** Puts the list prefix in, or takes it out, on every line the selection touches. */
	private toggleRichList(tb: TextBox, editor: HTMLElement, kind: ListKind): void {
		const { from, to } = selectionOffsets(editor);
		const wholeBox = from === to;
		const edits = planListToggle(editableText(editor), from, to, kind);
		if (!edits.length) return;
		this.pushEditSession();
		// Back to front: an edit never moves the ones still to come.
		for (const edit of edits.reverse()) {
			selectOffsets(editor, edit.from, edit.to);
			if (edit.text) document.execCommand("insertText", false, edit.text);
			else document.execCommand("delete");
		}
		editor.focus();
		// Bulleting the whole box leaves the caret at the end, ready to write the next item.
		if (wholeBox) {
			const end = editableText(editor).length;
			selectOffsets(editor, end, end);
		}
		this.syncRichText(tb, editor);
		this.resizeRichEditor(tb, editor);
		this.save();
	}

	/** The words in the editor, whichever kind it is. */
	private editorPlainText(editor: HTMLElement): string {
		return editor instanceof HTMLTextAreaElement ? editor.value : editableText(editor);
	}

	private commitTextEditor(): void {
		const editor = this.activeTextEditor;
		const source = this.activeTextSourceEl;
		if (!editor || !source) return;
		const id = source.getAttribute("data-id");
		const tb = this.data.texts.find(text => text.id === id);
		this.activeTextEditor = null;
		this.activeTextSourceEl = null;
		this.mathPreviewEl?.remove();
		this.mathPreviewEl = null;
		editor.remove();
		source.setCssStyles({ visibility: "" });
		this.editSessionPushed = false;
		this.hideFormatBar();
		if (!tb) return;

		const raw = this.editorPlainText(editor);
		// A fenced block (```lang … ```) pasted into a plain box turns it into a
		// code block with that language; inside a code block it just sets the language.
		let replacement: string | null = null;
		const fence = /^```([\w+#.-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(raw);
		if (fence && (tb.variant === "code" || tb.variant === "text") && !tb.stickyColor) {
			if (tb.variant !== "code") {
				tb.variant = "code";
				tb.fontFamily = "mono";
				tb.autoWidth = false;
				tb.w = Math.max(tb.w ?? 0, 440);
				tb.color = "#e2e8f0";
				source.addClass("notelens-code-block");
			}
			if (fence[1]) tb.language = normalizeLanguage(fence[1]);
			replacement = fence[2];
		} else if (tb.variant === "code") {
			// Inside a code block an opening fence alone (```python) is enough to pick the language.
			const openFence = /^```([\w+#.-]+)[ \t]*\r?\n([\s\S]*)$/.exec(raw);
			if (openFence) {
				tb.language = normalizeLanguage(openFence[1]);
				replacement = openFence[2];
			}
		}

		const empty = (replacement ?? raw).trim() === "" && !tb.stickyColor;
		if (empty) {
			// An abandoned click must not leave an invisible box behind.
			source.remove();
			this.data.texts.remove(tb);
			this.selTexts.delete(tb.id);
			this.renderSelectionBox();
			this.save();
			return;
		}
		if (replacement !== null) {
			// Fenced source replaced the prose: the runs of the old box mean nothing now.
			tb.text = replacement;
			tb.runs = undefined;
		} else if (editor instanceof HTMLTextAreaElement) {
			tb.text = editor.value;
		}
		this.applyTextStyles(source, tb);
		this.paintTextContent(source, tb);
		this.syncFittedSize(source, tb);
		if (tb.variant === "code") {
			// A code block hugs its lines instead of keeping the editor's spare height.
			source.setCssStyles({ minHeight: "" });
			tb.h = Math.max(72, source.offsetHeight);
			source.style.minHeight = `${tb.h}px`;
		}
		this.attachBoxChrome(source, tb);
		// The box stays selected so size, font and color changes still apply to it.
		this.clearSelection(false);
		this.selTexts.add(tb.id);
		this.renderSelectionBox();
		this.save();
	}

	/**
	 * Paints a text box: math boxes render their LaTeX; plain boxes render
	 * text with inline $...$ and display $...$ segments typeset by MathJax.
	 */
	private paintTextContent(el: HTMLElement, tb: TextBox): void {
		el.empty();
		if (tb.variant === "math") {
			const src = tb.text.trim();
			if (!src) { el.createSpan({ cls: "notelens-math-placeholder", text: tr("Fórmula") }); return; }
			el.appendChild(this.renderMathSafe(toRenderableLatex(src), true));
			void finishRenderMath();
			return;
		}
		if (tb.variant === "code") { this.paintCode(el, tb); return; }
		// What the rich editor wrote wins; a box that never went through it still
		// carries its formatting as marks in the text.
		if (tb.runs?.length) {
			renderRuns(el, tb.runs, this.baseStyle(el, tb), (parent, text) => this.paintFragment(parent, text));
			return;
		}
		this.appendRich(el, tb.text);
	}

	/** A piece of plain text: inline $…$ and display $$…$$ typeset, links made clickable. */
	private paintFragment(parent: HTMLElement, text: string): void {
		if (!text.includes("$")) { this.appendLinkified(parent, text); return; }
		let typeset = false;
		for (const part of text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g)) {
			if (!part) continue;
			if (part.length > 4 && part.startsWith("$$") && part.endsWith("$$")) {
				parent.appendChild(this.renderMathSafe(toRenderableLatex(part.slice(2, -2)), true));
				typeset = true;
			} else if (part.length > 2 && part.startsWith("$") && part.endsWith("$")) {
				parent.appendChild(this.renderMathSafe(toRenderableLatex(part.slice(1, -1)), false));
				typeset = true;
			} else {
				this.appendLinkified(parent, part);
			}
		}
		if (typeset) void finishRenderMath();
	}

	/**
	 * Text with its inline marks turned into real formatting: `**negrita**`,
	 * `*cursiva*`, `__subrayado__`, `~~tachado~~`, `==resaltado==` and
	 * `` `código` ``. The marks stay in the stored text, so the box still saves
	 * as plain Markdown and the editor shows exactly what will be exported.
	 */
	private appendRich(el: HTMLElement, text: string): void {
		for (const run of parseInline(text)) {
			if (!run.text) continue;
			const classes = ["notelens-run"];
			if (run.bold) classes.push("is-bold");
			if (run.italic) classes.push("is-italic");
			if (run.underline) classes.push("is-underline");
			if (run.strike) classes.push("is-strike");
			if (run.mark) classes.push("is-mark");
			if (run.code) classes.push("is-code");
			if (classes.length === 1) { this.paintFragment(el, run.text); continue; }
			const span = el.createSpan({ cls: classes.join(" ") });
			// Code is shown verbatim: a URL inside backticks is a sample, not a link.
			if (run.code) span.setText(run.text);
			else this.paintFragment(span, run.text);
		}
	}

	/** Text with [[notas de la bóveda]] and http(s) URLs turned into clickable links. */
	private appendLinkified(el: HTMLElement, text: string): void {
		const pattern = /\[\[([^\]\n]+)\]\]|https?:\/\/[^\s<>"')\]]+/g;
		let last = 0;
		for (const m of text.matchAll(pattern)) {
			const index = m.index ?? 0;
			if (index > last) el.appendChild(document.createTextNode(text.slice(last, index)));
			const isWiki = !!m[1];
			const target = isWiki ? m[1].split("|")[0].trim() : m[0];
			const label = isWiki ? (m[1].split("|")[1] ?? m[1]).trim() : m[0];
			const a = el.createEl("a", { cls: isWiki ? "notelens-link internal-link" : "notelens-link external-link", text: label });
			a.title = isWiki ? `Abrir «${target}»` : target;
			a.addEventListener("pointerdown", (e) => e.stopPropagation());
			a.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this.openVaultFile(target); });
			last = index + m[0].length;
		}
		if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
	}

	/** Header with language and copy button, line-number gutter, Prism-highlighted source. */
	private paintCode(el: HTMLElement, tb: TextBox): void {
		const lang = normalizeLanguage(tb.language);
		tb.language = lang;
		el.setAttr("data-language", lang);
		const header = el.createDiv({ cls: "notelens-code-header" });
		header.createSpan({ cls: "notelens-code-lang", text: CODE_LANGUAGES.find(([id]) => id === lang)?.[1] ?? lang });
		const copy = header.createEl("button", { cls: "notelens-code-copy" });
		setIcon(copy, "copy");
		copy.title = tr("Copiar código");
		copy.addEventListener("pointerdown", (e) => e.stopPropagation());
		copy.addEventListener("click", (e) => {
			e.stopPropagation();
			void navigator.clipboard?.writeText(tb.text).then(() => new Notice(tr("Código copiado")));
		});
		const closeCode = header.createEl("button", { cls: "notelens-code-copy" });
		setIcon(closeCode, "x");
		closeCode.title = tr("Eliminar bloque");
		closeCode.addEventListener("pointerdown", (e) => e.stopPropagation());
		closeCode.addEventListener("click", (e) => { e.stopPropagation(); this.removeTextBox(tb); });

		const body = el.createDiv({ cls: "notelens-code-body" });
		const lines = tb.text.split("\n");
		const gutter = body.createDiv({ cls: "notelens-code-gutter" });
		for (let i = 1; i <= lines.length; i++) gutter.createDiv({ text: String(i) });
		const code = body.createEl("code", { cls: "notelens-code-source" });
		if (!tb.text) {
			code.createSpan({ cls: "notelens-math-placeholder", text: tr("Bloque de código vacío") });
			return;
		}
		const grammar = lang !== "plaintext" ? this.prism?.languages?.[lang] : undefined;
		if (grammar && this.prism) {
			// Tokenize rather than highlight: the tokens become real elements, so no
			// markup is ever parsed out of the code the user typed.
			paintPrismTokens(code, this.prism.tokenize(tb.text, grammar));
		} else {
			code.setText(tb.text);
		}
	}

	/** Indents (or outdents) the current line or every selected line. */
	private indentInEditor(editor: HTMLTextAreaElement, outdent: boolean, unit: string): void {
		const value = editor.value;
		const start = editor.selectionStart;
		const end = editor.selectionEnd;
		const lineStart = value.lastIndexOf("\n", start - 1) + 1;
		if (!outdent && start === end) {
			editor.setRangeText(unit, start, end, "end");
			return;
		}
		const lineEnd = value.indexOf("\n", end);
		const blockEnd = lineEnd === -1 ? value.length : lineEnd;
		const block = value.slice(lineStart, blockEnd);
		const changed = block.split("\n").map(line => {
			if (outdent) return line.startsWith(unit) ? line.slice(unit.length) : line.replace(/^(\t| {1,4})/, "");
			return unit + line;
		}).join("\n");
		editor.setRangeText(changed, lineStart, blockEnd, "preserve");
		editor.setSelectionRange(lineStart, lineStart + changed.length);
	}

	/** Enter keeps the indentation of the current line and adds one level after an opening bracket or colon. */
	private newlineKeepingIndent(editor: HTMLTextAreaElement): void {
		const value = editor.value;
		const start = editor.selectionStart;
		const lineStart = value.lastIndexOf("\n", start - 1) + 1;
		const line = value.slice(lineStart, start);
		const indent = /^[\t ]*/.exec(line)?.[0] ?? "";
		const opens = /[{([:]\s*$/.test(line) ? "    " : "";
		editor.setRangeText("\n" + indent + opens, start, editor.selectionEnd, "end");
	}

	private renderMathSafe(source: string, display: boolean): HTMLElement {
		try {
			return renderMath(source, display);
		} catch {
			const fallback = createEl("span");
			fallback.className = "notelens-math-error";
			fallback.textContent = source;
			return fallback;
		}
	}

	private refreshMathPreview(tb: TextBox): void {
		const preview = this.mathPreviewEl;
		if (!preview) return;
		preview.empty();
		const src = tb.text.trim();
		if (!src) { preview.createSpan({ cls: "notelens-math-placeholder", text: tr("Vista previa de la fórmula") }); return; }
		preview.appendChild(this.renderMathSafe(toRenderableLatex(src), true));
		void finishRenderMath();
	}

	/** Width that fits the longest line, like OneNote boxes that grow as you type. */
	private measureAutoWidth(tb: TextBox): number {
		const ctx = this.textMeasurer ?? (this.textMeasurer = createEl("canvas").getContext("2d"));
		if (!ctx) return tb.w ?? 260;
		ctx.font = `${tb.italic ? "italic " : ""}${tb.bold ? "700" : "400"} ${tb.fontSize}px ${fontStack(tb.fontFamily ?? "sans")}`;
		let widest = 0;
		const words = tb.runs?.length ? runsToPlain(tb.runs) : tb.text;
		for (const line of words.split("\n")) widest = Math.max(widest, ctx.measureText(line).width);
		return clamp(Math.ceil(widest) + 24, 160, 640);
	}

	/** Resize handle and close button every text box carries. */
	private attachBoxChrome(el: HTMLElement, tb: TextBox): void {
		const resizeHandle = el.createDiv({ cls: "notelens-text-resize" });
		resizeHandle.title = tr("Redimensionar");
		resizeHandle.addEventListener("pointerdown", (e) => this.startTextResize(e, tb, el));
		const closeBtn = el.createEl("button", { cls: "notelens-box-close" });
		setIcon(closeBtn, "x");
		closeBtn.title = tr("Eliminar");
		closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
		closeBtn.addEventListener("click", (e) => { e.stopPropagation(); this.removeTextBox(tb); });
	}

	private removeTextBox(tb: TextBox): void {
		if (this.activeTextSourceEl?.getAttribute("data-id") === tb.id) this.commitTextEditor();
		this.history.push();
		this.hideFormatBar();
		this.data.texts.remove(tb);
		this.selTexts.delete(tb.id);
		(this.domLayerEl.querySelector(`[data-id="${tb.id}"]`) as HTMLElement | null)?.remove();
		this.renderSelectionBox();
		this.save();
	}

	private startTextResize(e: PointerEvent, tb: TextBox, el: HTMLElement): void {
		e.stopPropagation();
		e.preventDefault();
		tb.autoWidth = false;
		this.history.push();
		const startX = e.clientX;
		const startY = e.clientY;
		const originalW = tb.w ?? el.offsetWidth;
		const originalH = tb.h ?? el.offsetHeight;
		const scale = this.data.viewTransform.scale;
		const onMove = (event: PointerEvent) => {
			tb.w = clamp(originalW + (event.clientX - startX) / scale, 120, 900);
			tb.h = clamp(originalH + (event.clientY - startY) / scale, 34, 900);
			this.applyTextStyles(el, tb);
			this.renderSelectionBox();
			this.save();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			this.save();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	private updateToolPointerPreview(e: PointerEvent): void {
		const target = e.target instanceof Element ? e.target : null;
		const focused = document.activeElement as HTMLElement | null;
		const typing = !!focused && (focused.isContentEditable || focused.tagName === "TEXTAREA" || focused.tagName === "INPUT");
		const overPage = !!target && this.workspaceEl.contains(target)
			&& (target === this.workspaceEl || target === this.renderer.canvas || target === this.stageEl || this.stageEl.contains(target))
			&& !target.closest("button, input, textarea, select, [contenteditable='true']");

		if (this.currentTool === "text" && !this.activeTextEditor && !typing && overPage && !this.isPanning) {
			this.hideEraserCursor();
			this.updateTextPlacementHint(e);
			return;
		}
		// While the rubber is actually on the paper it stays drawn, even if the
		// pointer passes over a dock button on its way.
		if ((this.currentTool === "eraser" || this.isErasing) && (overPage || this.isErasing) && !typing && !this.isPanning) {
			this.hideTextPlacementHint();
			this.updateEraserCursor(e);
			return;
		}
		this.hideTextPlacementHint();
		this.hideEraserCursor();
	}

	private updateTextPlacementHint(e: PointerEvent): void {
		if (!this.textPlacementHintEl) {
			this.textPlacementHintEl = this.workspaceEl.createDiv({ cls: "notelens-text-placement-hint" });
			this.textPlacementHintEl.setAttr("aria-hidden", "true");
			this.textPlacementHintEl.createDiv({ cls: "notelens-text-placement-caret" });
			const tool = this.textPlacementHintEl.createDiv({ cls: "notelens-text-placement-tool" });
			setIcon(tool, "type");
		}
		const rect = this.workspaceEl.getBoundingClientRect();
		this.textPlacementHintEl.style.left = `${e.clientX - rect.left}px`;
		this.textPlacementHintEl.style.top = `${e.clientY - rect.top}px`;
	}

	private hideTextPlacementHint(): void {
		this.textPlacementHintEl?.remove();
		this.textPlacementHintEl = null;
	}

	private updateEraserCursor(e: PointerEvent): void {
		if (!this.eraserCursorEl) {
			this.eraserCursorEl = this.workspaceEl.createDiv({ cls: "notelens-eraser-pointer" });
			this.eraserCursorEl.setAttr("aria-hidden", "true");
			this.eraserCursorEl.createDiv({ cls: "notelens-eraser-pointer-area" });
			const tool = this.eraserCursorEl.createDiv({ cls: "notelens-eraser-pointer-tool" });
			setEraserIcon(tool, 30);
		}
		this.syncEraserCursorSize();
		this.eraserCursorEl.toggleClass("is-active", this.isErasing);
		const rect = this.workspaceEl.getBoundingClientRect();
		this.eraserCursorEl.style.left = `${e.clientX - rect.left}px`;
		this.eraserCursorEl.style.top = `${e.clientY - rect.top}px`;
	}

	private syncEraserCursorSize(): void {
		if (!this.eraserCursorEl) return;
		this.eraserCursorEl.style.setProperty("--eraser-diameter", `${clamp(this.eraserSize * 2, 8, 120)}px`);
		this.eraserCursorEl.setAttr("data-mode", this.eraserMode);
	}

	private hideEraserCursor(): void {
		this.eraserCursorEl?.remove();
		this.eraserCursorEl = null;
	}

	private applyTextStyles(el: HTMLElement, tb: TextBox): void {
		el.style.fontSize = `${tb.fontSize}px`;
		el.style.color = tb.color;
		el.style.fontWeight = tb.bold ? "700" : "400";
		el.style.fontStyle = tb.italic ? "italic" : "normal";
		el.style.textDecoration = [tb.underline ? "underline" : "", tb.strike ? "line-through" : ""].filter(Boolean).join(" ") || "none";
		el.style.setProperty("--notelens-mark", tb.highlight || DEFAULT_TEXT_HIGHLIGHT);
		// Highlight tints are pale, so near-white ink written on a dark board
		// would disappear inside them: those runs get dark ink instead.
		el.style.setProperty("--notelens-mark-ink", isLightColor(tb.color) ? "#1f2937" : "");
		el.style.textAlign = tb.align ?? "left";
		el.style.backgroundColor = tb.stickyColor ?? "";
		if (tb.stickyColor) {
			// The fold and the shadow are tinted from the paper colour, and every
			// note leans a little so a wall of them looks hand-placed.
			el.style.setProperty("--sticky-color", tb.stickyColor);
			el.style.setProperty("--sticky-shade", shadeColor(tb.stickyColor, -0.16));
			el.style.setProperty("--sticky-deep", shadeColor(tb.stickyColor, -0.32));
			el.style.setProperty("--sticky-tilt", `${stickyTilt(tb.id)}deg`);
		}
		el.style.fontFamily = fontStack(tb.fontFamily ?? (tb.variant === "code" ? "mono" : "sans"));
		// A formula grows with what it shows unless the user resized it by hand.
		const fitsContent = tb.variant === "math" && tb.autoWidth !== false;
		el.style.width = fitsContent ? "max-content" : tb.w ? `${tb.w}px` : "";
		el.style.minHeight = tb.h && !fitsContent ? `${tb.h}px` : "";
	}

	/** Records the size a content-fitted box took, so selection and export see its real bounds. */
	private syncFittedSize(el: HTMLElement, tb: TextBox): void {
		if (tb.variant !== "math" || tb.autoWidth === false) return;
		if (el.offsetWidth > 0) tb.w = el.offsetWidth;
		if (el.offsetHeight > 0) tb.h = el.offsetHeight;
	}

	// ------------------------------------------------------------------
	// Floating text format bar
	// ------------------------------------------------------------------

	private formatBarEl: HTMLElement | null = null;
	private formatBarWatch: (() => void) | null = null;
	private editSessionPushed = false;

	private pushEditSession(): void {
		if (!this.editSessionPushed) {
			this.history.push();
			this.editSessionPushed = true;
		}
	}

	/**
	 * Runs one formatting command on the selection of a rich box and stores the
	 * result. With nothing selected the command arms the style for what gets
	 * typed next, the way it works in any editor.
	 */
	private formatRich(tb: TextBox, editor: HTMLElement, command: string, value?: string): void {
		this.pushEditSession();
		editor.focus();
		document.execCommand(command, false, value);
		this.syncRichText(tb, editor);
		this.resizeRichEditor(tb, editor);
		this.save();
	}

	/** The highlight tint under the caret, or none when the text is not highlighted. */
	private markUnderCaret(): string {
		try {
			const value = document.queryCommandValue("hiliteColor");
			return !value || value === "transparent" || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(value) ? "" : value;
		} catch {
			return "";
		}
	}

	private showFormatBar(tb: TextBox, el: HTMLElement): void {
		this.hideFormatBar();

		const bar = this.workspaceEl.createDiv({ cls: "notelens-format-bar" });
		// Keep the textbox focused while interacting with the bar.
		bar.addEventListener("pointerdown", (e) => {
			// Never reaches the canvas: with the text tool active that click
			// would otherwise end the edit (or open a new box) instead of formatting.
			e.stopPropagation();
			if (!(e.target instanceof HTMLSelectElement)) e.preventDefault();
		});
		// After picking a font or a language the caret goes back where it was.
		bar.addEventListener("change", () => el.focus());

		const apply = (mutate: () => void) => {
			this.pushEditSession();
			mutate();
			this.applyTextStyles(el, tb);
			refreshStates();
			this.save();
		};

		const toggleButtons = new Map<string, HTMLElement>();
		const mkToggle = (key: string, icon: string, title: string, toggle: () => void) => {
			const b = bar.createEl("button", { cls: "onenote-dock-btn notelens-format-btn" });
			setIcon(b, icon);
			b.title = tr(title);
			b.onclick = () => apply(toggle);
			toggleButtons.set(key, b);
		};

		// Code and math boxes have no use for weight, style or typeface controls.
		const plainText = tb.variant !== "code" && tb.variant !== "math";
		// Prose is edited in a rich element; only there can a single word carry its
		// own weight, underline, colour or tint.
		const rich = plainText && !el.instanceOf(HTMLTextAreaElement) ? el : null;
		const command = (key: string, icon: string, title: string, run: () => void) => {
			const b = bar.createEl("button", { cls: "onenote-dock-btn notelens-format-btn" });
			setIcon(b, icon);
			b.title = tr(title);
			b.onclick = () => { run(); refreshStates(); };
			toggleButtons.set(key, b);
		};

		if (rich) {
			command("bold", "bold", "Negrita (Ctrl+B)", () => this.formatRich(tb, rich, "bold"));
			command("italic", "italic", "Cursiva (Ctrl+I)", () => this.formatRich(tb, rich, "italic"));
			command("underline", "underline", "Subrayado (Ctrl+U)", () => this.formatRich(tb, rich, "underline"));
			command("strike", "strikethrough", "Tachado", () => this.formatRich(tb, rich, "strikeThrough"));
			command("mark", "highlighter", "Resaltar lo seleccionado", () => {
				rich.focus();
				const tint = this.markUnderCaret() ? "transparent" : (tb.highlight || DEFAULT_TEXT_HIGHLIGHT);
				this.formatRich(tb, rich, "hiliteColor", tint);
			});
			command("code", "code", "Código en línea", () => {
				this.pushEditSession();
				rich.focus();
				if (!unwrapCode(rich)) surroundSelection(rich, "code");
				this.syncRichText(tb, rich);
				this.resizeRichEditor(tb, rich);
				this.save();
			});
			command("clear", "remove-formatting", "Quitar el formato de lo seleccionado", () => {
				unwrapCode(rich);
				this.formatRich(tb, rich, "removeFormat");
			});
			bar.createDiv({ cls: "onenote-divider" });
		}
		if (plainText) {
			mkToggle("align-left", "align-left", "Alinear a la izquierda", () => { tb.align = "left"; });
			mkToggle("align-center", "align-center", "Centrar", () => { tb.align = "center"; });
			mkToggle("align-right", "align-right", "Alinear a la derecha", () => { tb.align = "right"; });
			bar.createDiv({ cls: "onenote-divider" });
			if (rich) {
				const listButton = (icon: string, title: string, kind: ListKind) => {
					const b = bar.createEl("button", { cls: "onenote-dock-btn notelens-format-btn" });
					setIcon(b, icon);
					b.title = tr(title);
					b.onclick = () => this.toggleRichList(tb, rich, kind);
				};
				listButton("list", "Lista con viñetas (•)", "bullet");
				listButton("list-ordered", "Lista numerada (1. 2. 3.)", "number");
				listButton("arrow-right", "Lista con flechas (→)", "arrow");
				listButton("minus", "Lista con guiones (-)", "dash");
				bar.createDiv({ cls: "onenote-divider" });
			}
		}
		const fontSelect = bar.createEl("select", { cls: "notelens-format-font" });
		for (const font of CANVAS_FONTS) {
			const option = fontSelect.createEl("option", { value: font.id, text: tr(font.label) });
			option.style.fontFamily = font.css;
		}
		fontSelect.value = tb.fontFamily ?? "sans";
		fontSelect.onchange = () => apply(() => { tb.fontFamily = fontSelect.value as CanvasFont; });
		if (!plainText) fontSelect.hide();

		const minusBtn = bar.createEl("button", { cls: "onenote-dock-btn notelens-format-btn" });
		setIcon(minusBtn, "minus");
		minusBtn.title = tr("Reducir tamaño");
		minusBtn.onclick = () => apply(() => { tb.fontSize = Math.max(10, tb.fontSize - 2); });

		const sizeLabel = bar.createSpan({ cls: "notelens-format-size" });

		if (plainText) {
			const translateBtn = bar.createEl("button", { cls: "onenote-dock-btn notelens-format-btn" });
			setIcon(translateBtn, "languages");
			translateBtn.title = tr("Traducir este cuadro");
			translateBtn.onclick = () => this.translateText();
		}

		const plusBtn = bar.createEl("button", { cls: "onenote-dock-btn notelens-format-btn" });
		setIcon(plusBtn, "plus");
		plusBtn.title = tr("Aumentar tamaño");
		plusBtn.onclick = () => apply(() => { tb.fontSize = Math.min(96, tb.fontSize + 2); });

		if (tb.variant !== "code") {
			bar.createDiv({ cls: "onenote-divider" });
			// First in the row, the way back: paints the selection in the colour of the
			// box again, which is what "no colour" means for a fragment.
			if (rich) {
				addPlainSwatch(bar, "Color normal del cuadro", () => this.formatRich(tb, rich, "foreColor", getComputedStyle(rich).color));
			}
			for (const c of TEXT_COLORS) {
				const dot = bar.createDiv({ cls: "onenote-color-dot notelens-format-color" });
				dot.style.backgroundColor = c;
				// In a rich box the colour paints what is selected; the box keeps its own
				// colour for whatever is typed outside that.
				dot.title = rich ? tr("Color del texto seleccionado") : c;
				dot.onclick = () => {
					if (rich) this.formatRich(tb, rich, "foreColor", c);
					else apply(() => { tb.color = c; });
				};
			}
		}

		if (plainText) {
			bar.createDiv({ cls: "onenote-divider" });
			if (rich) {
				addPlainSwatch(bar, "Sin resaltado", () => this.formatRich(tb, rich, "hiliteColor", "transparent"), true);
			}
			for (const c of TEXT_HIGHLIGHTS) {
				const dot = bar.createDiv({ cls: "onenote-color-dot notelens-format-color notelens-format-mark-color" });
				dot.style.backgroundColor = c;
				dot.title = tr("Color del resaltado");
				dot.onclick = () => {
					tb.highlight = c;
					if (rich) this.formatRich(tb, rich, "hiliteColor", c);
					else apply(() => { tb.highlight = c; });
				};
			}
		}

		if (tb.stickyColor) {
			bar.createDiv({ cls: "onenote-divider" });
			for (const c of STICKY_COLORS) {
				const dot = bar.createDiv({ cls: "onenote-color-dot notelens-format-color" });
				dot.style.backgroundColor = c;
				dot.title = tr("Color de la nota");
				dot.onclick = () => apply(() => { tb.stickyColor = c; });
			}
		}

		if (tb.variant === "code") {
			bar.createDiv({ cls: "onenote-divider" });
			const languageSelect = bar.createEl("select", { cls: "notelens-format-language" });
			for (const [id, label] of CODE_LANGUAGES) languageSelect.createEl("option", { value: id, text: label });
			languageSelect.value = normalizeLanguage(tb.language);
			if (!CODE_LANGUAGES.some(([id]) => id === languageSelect.value)) languageSelect.createEl("option", { value: languageSelect.value, text: languageSelect.value });
			languageSelect.value = normalizeLanguage(tb.language);
			languageSelect.onchange = () => apply(() => {
				tb.language = languageSelect.value;
				el.setAttr("data-language", tb.language);
			});
		}

		const refreshStates = () => {
			// In a rich box the buttons show the style of the selection, not of the box.
			const state = (cmd: string) => { try { return document.queryCommandState(cmd); } catch { return false; } };
			toggleButtons.get("bold")?.toggleClass("active", rich ? state("bold") : !!tb.bold);
			toggleButtons.get("italic")?.toggleClass("active", rich ? state("italic") : !!tb.italic);
			toggleButtons.get("underline")?.toggleClass("active", rich ? state("underline") : !!tb.underline);
			toggleButtons.get("strike")?.toggleClass("active", rich ? state("strikeThrough") : !!tb.strike);
			toggleButtons.get("mark")?.toggleClass("active", !!rich && !!this.markUnderCaret());
			toggleButtons.get("align-left")?.toggleClass("active", (tb.align ?? "left") === "left");
			toggleButtons.get("align-center")?.toggleClass("active", tb.align === "center");
			toggleButtons.get("align-right")?.toggleClass("active", tb.align === "right");
			sizeLabel.setText(`${tb.fontSize}`);
		};
		refreshStates();

		if (tb.variant === "math" && el.instanceOf(HTMLTextAreaElement)) {
			bar.addClass("is-math");
			const palette = bar.createDiv({ cls: "notelens-math-palette" });
			// Grouped so a long list stays findable: the tabs swap the keys below.
			const keys = bar.createDiv({ cls: "notelens-math-keys" });
			const tabs = palette.createDiv({ cls: "notelens-math-groups" });
			const insertSnippet = (snippet: string) => {
				insertMathSnippet(el, snippet);
				el.dispatchEvent(new Event("input"));
			};
			const showGroup = (name: string) => {
				keys.empty();
				for (const item of MATH_GROUPS.find(group => group.name === name)?.keys ?? []) {
					const key = keys.createEl("button", { cls: "notelens-math-key", text: item.glyph });
					key.title = tr(item.name);
					key.onclick = () => insertSnippet(item.snippet);
				}
				for (const tab of Array.from(tabs.children)) tab.toggleClass("active", tab.getAttribute("data-group") === name);
			};
			for (const group of MATH_GROUPS) {
				const tab = tabs.createEl("button", { cls: "notelens-math-group", text: tr(group.name) });
				tab.setAttr("data-group", group.name);
				tab.onclick = () => showGroup(group.name);
			}
			showGroup(MATH_GROUPS[0].name);
			palette.appendChild(keys);
		}

		// A glyph, not an icon lookup: on some Obsidian builds the icon came out
		// as an empty square and the bar looked like it had no way to close.
		const closeBar = bar.createEl("button", { cls: "notelens-embed-close notelens-format-close is-glyph", text: "✕" });
		closeBar.title = tr("Terminar de editar (Esc)");
		closeBar.onclick = () => this.commitTextEditor();

		// Above the textbox (below it when there is no room), using the bar's
		// real size so it never overlaps the text being edited.
		const r = el.getBoundingClientRect();
		const wr = this.workspaceEl.getBoundingClientRect();
		const barW = bar.offsetWidth || 420;
		const barH = bar.offsetHeight || 40;
		bar.style.left = `${clamp(r.left - wr.left, 8, Math.max(8, wr.width - barW - 8))}px`;
		const above = r.top - wr.top - barH - 10;
		bar.style.top = `${above >= 8 ? above : Math.min(wr.height - barH - 8, r.bottom - wr.top + 10)}px`;

		this.formatBarEl = bar;
		if (rich) {
			// The buttons light up for wherever the caret is now.
			this.formatBarWatch = () => { if (this.formatBarEl === bar) refreshStates(); };
			document.addEventListener("selectionchange", this.formatBarWatch);
		}
	}

	private hideFormatBar(): void {
		if (this.formatBarWatch) {
			document.removeEventListener("selectionchange", this.formatBarWatch);
			this.formatBarWatch = null;
		}
		this.formatBarEl?.remove();
		this.formatBarEl = null;
	}

	// ------------------------------------------------------------------
	// Element dragging routes through the selection system
	// ------------------------------------------------------------------

	private routeElementDrag(e: PointerEvent, kind: "badge" | "text" | "table", id: string): void {
		const set = kind === "badge" ? this.selBadges : kind === "table" ? this.selTables : this.selTexts;
		if (!set.has(id)) {
			this.clearSelection(false);
			set.add(id);
		}
		this.renderSelectionBox();
		this.startSelectionDrag(e);
	}

	/** EmbedHost: frames/stacks delegate dragging here. Returns true if handled. */
	startEmbedDrag(e: PointerEvent, _el: HTMLElement, embed: Embed, force = false): boolean {
		if (e.button !== 0) return false;
		if (this.currentTool !== "select") {
			if (!force) return false; // let it bubble → draw/pan
			e.stopPropagation();
			e.preventDefault();
			this.startSingleEmbedDrag(e, embed);
			return true;
		}
		e.stopPropagation();
		e.preventDefault();
		if (!this.selEmbeds.has(embed.id)) {
			this.clearSelection(false);
			this.selEmbeds.add(embed.id);
		}
		this.renderSelectionBox();
		this.startSelectionDrag(e);
		return true;
	}

	/** Direct drag of one embed (frame headers work with any tool active). */
	private startSingleEmbedDrag(e: PointerEvent, embed: Embed): void {
		this.history.push();
		const el = this.domLayerEl.querySelector(`[data-id="${embed.id}"]`) as HTMLElement | null;
		const startX = e.clientX;
		const startY = e.clientY;
		const origX = embed.x;
		const origY = embed.y;
		const scale = this.data.viewTransform.scale;

		const onMove = (ev: PointerEvent) => {
			embed.x = origX + (ev.clientX - startX) / scale;
			embed.y = origY + (ev.clientY - startY) / scale;
			if (el) {
				el.style.left = `${embed.x}px`;
				el.style.top = `${embed.y}px`;
			}
			this.save();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			this.save();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	// ------------------------------------------------------------------

	save(): void {
		this.syncActivePageMeta();
		this.saver?.scheduleSave(this.data);
	}
}

/** Minimal text-input modal (window.prompt is unavailable in Obsidian). */
/**
 * Cleans up what OCR returns for a formula. Tesseract is trained on prose, so
 * it reliably confuses a few characters in maths; fixing them here saves the
 * user most of the corrections.
 */
export function tidyFormulaText(raw: string): string {
	let value = raw
		.replace(/\r/g, "")
		.split("\n").map(line => line.trim()).filter(Boolean).join(" ")
		.replace(/```(?:latex|tex|math)?|```/gi, "")
		.replace(/^\$+|\$+$/g, "")
		.replace(/[\u2212\u2013\u2014]/g, "-")
		.replace(/[\u00D7\u22C5\u00B7]/g, "*")
		.replace(/[\u00F7]/g, "/")
		.replace(/\u221A/g, "sqrt")
		.replace(/\u03C0/g, "pi")
		.replace(/\u2211/g, "sum")
		.replace(/\u222B/g, "int")
		.replace(/\u221E/g, "infty")
		.replace(/\u2264/g, "<=").replace(/\u2265/g, ">=").replace(/\u2260/g, "!=")
		.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, digits => `^${[...digits].map(digit => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(digit)).join("")}`)
		// A lone letter next to digits is nearly always a misread symbol.
		.replace(/\bO\b/g, "0")
		.replace(/(\d)\s*[lI]\s*(\d)/g, "$1 1 $2")
		.replace(/\s{2,}/g, " ")
		.trim();

	// Common OCR failure for a printed caret: `x^2` can arrive as `Xx2`.
	value = value.replace(/\b([A-Z])x\*?(\d+)\b/g, (_match, base: string, exponent: string) => `${base.toLowerCase()}^${exponent}`);
	// Promote easy notation to real LaTeX so mixed structures (for example a
	// superscript inside a detected fraction) render consistently.
	for (let i = 0; i < 3; i++) {
		value = value.replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, "\\frac{$1}{$2}");
	}
	value = value
		.replace(/\bsqrt\s*[({]\s*([^)}]+)\s*[)}]/gi, "\\sqrt{$1}")
		.replace(/\bsqrt\s*([A-Za-z0-9]+)/gi, "\\sqrt{$1}")
		.replace(/([A-Za-z0-9)\]])\s*\^\s*(?:\(([^()]+)\)|([A-Za-z0-9]+))/g, (_match, base: string, grouped: string, simple: string) => `${base}^{${grouped || simple}}`)
		.replace(/([A-Za-z0-9)\]])\s*_\s*(?:\(([^()]+)\)|([A-Za-z0-9]+))/g, (_match, base: string, grouped: string, simple: string) => `${base}_{${grouped || simple}}`)
		.replace(/\bpi\b/g, "\\pi")
		.replace(/\binfty\b|\boo\b/g, "\\infty")
		.replace(/\bsum\b/g, "\\sum")
		.replace(/\bint\b/g, "\\int")
		.replace(/\s*<=\s*/g, " \\le ")
		.replace(/\s*>=\s*/g, " \\ge ")
		.replace(/\s*!=\s*/g, " \\ne ")
		.replace(/\s+/g, " ")
		.trim();
	return value;
}

/** Classic sticky-note paper colours, warmest first. */
/** The crossed-out dot that takes a colour or a highlight back off a fragment. */
function addPlainSwatch(bar: HTMLElement, title: string, clear: () => void, square = false): void {
	const dot = bar.createDiv({ cls: "onenote-color-dot notelens-format-color notelens-format-none" });
	if (square) dot.addClass("notelens-format-mark-color");
	dot.title = tr(title);
	dot.onclick = clear;
}

const STICKY_COLORS = ["#fff2a8", "#ffd9a0", "#ffd7e5", "#d8f5c9", "#cde8ff", "#eadbff", "#f4f1e8"];

/** Same colour, lighter (amount > 0) or darker (amount < 0). */
function shadeColor(hex: string, amount: number): string {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) return hex;
	const value = parseInt(match[1], 16);
	const mix = (channel: number) => {
		const target = amount < 0 ? 0 : 255;
		return Math.round(channel + (target - channel) * Math.abs(amount));
	};
	const r = mix((value >> 16) & 255), g = mix((value >> 8) & 255), b = mix(value & 255);
	return `rgb(${r}, ${g}, ${b})`;
}

/** A stable lean between -2.2 and 2.2 degrees, derived from the note's id. */
function stickyTilt(id: string): string {
	let hash = 0;
	for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffff;
	return ((hash % 45) / 10 - 2.2).toFixed(1);
}
