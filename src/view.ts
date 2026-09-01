import { FileView, Menu, Modal, Notice, Setting, TFile, WorkspaceLeaf, finishRenderMath, loadMathJax, loadPrism, renderMath, setIcon } from "obsidian";
import { AngleUnit, createCalculatorPanel } from "./calculator";
import { createRecorderPanel } from "./recorder";
import { toRenderableLatex } from "./asciimath";
import { buildSharePackage, importSharePackage as importShareArchive } from "./exchange";
import { TranslationSource, createTranslatorPanel } from "./translator";
import { createA4Pdf, getCanvasContentBounds } from "./pdf-export";
import type OneNotePlugin from "./main";
import { CanvasRenderer } from "./renderer";
import { HistoryManager } from "./history";
import { PersistenceManager } from "./persistence";
import {
	Badge, CanvasFont, CanvasTable, Embed, EmbedKind, OneNoteDocument, Shape, ShapeKind, Stroke, TextBox, ViewportBookmark,
	ChartData, StrokePoint, createEmptyDocument, genId, migrateDocument
} from "./types";
import { clamp, distPointToSegment, hexToRgba, hitTestStrokes, isLightColor, setColorAlpha } from "./tools";
import { EmbedHost, ImagePickModal, NoteOrBoardPickModal, PdfModeModal, PdfPickModal, VaultFilePickModal, VideoInsertModal, renderEmbedFrame } from "./embeds";
import { createNavigatorPanel, isBoardFile } from "./navigator";
import { recognizeImage } from "./ocr";
import { ChartEditorModal, DEFAULT_CHART, specFromTable } from "./charts";
import { EraserMode, QUICK_TAGS, QuickTag, SelectionMode, ToolId, ToolbarHost, createBookmarksControl, createFocusModeControl, createNavigationControls, createQuickTagsBar, createSettingsPanel, createToolbar, quickTagById } from "./ui";
import { BackgroundPattern, DEFAULT_BG_COLOR, DEFAULT_LINE_COLOR, GridSize } from "./types";

export const VIEW_TYPE_ONENOTE = "onenote-canvas-view";

const ERASER_SLOP_PX = 10;
const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const GRID_CELLS: Record<GridSize, number> = { small: 18, medium: 26, large: 40 };
const MARGIN_SCENE_X = 72;
const A4_SCENE_W = 794;
const A4_SCENE_H = 1123;
const TEXT_COLORS = ["#f8fafc", "#111827", "#38bdf8", "#ef4444", "#22c55e", "#a855f7", "#eab308"];

// ---------------------------------------------------------------------------
// Lists in plain text boxes: bullets, numbers, arrows and dashes as line prefixes
// ---------------------------------------------------------------------------

type ListKind = "bullet" | "number" | "arrow" | "dash";
const LIST_PREFIX = /^(\s*)(?:[•·]|\d+[.)]|→|-->|->|[-–])\s+/;
const LIST_MARK: Record<ListKind, string> = { bullet: "• ", number: "1. ", arrow: "→ ", dash: "- " };

function listKindOf(line: string): ListKind | null {
	const m = /^\s*(?:([•·])|(\d+[.)])|(→|-->|->)|([-–]))\s+/.exec(line);
	if (!m) return null;
	return m[1] ? "bullet" : m[2] ? "number" : m[3] ? "arrow" : "dash";
}

/** Adds the list prefix to the selected lines (all lines if nothing is selected); removes it when every line already has it. */
function toggleListPrefix(editor: HTMLTextAreaElement, kind: ListKind): void {
	const value = editor.value;
	const selStart = editor.selectionStart;
	const selEnd = editor.selectionEnd;
	const wholeBox = selStart === selEnd;
	const from = wholeBox ? 0 : value.lastIndexOf("\n", selStart - 1) + 1;
	const toIdx = wholeBox ? value.length : (value.indexOf("\n", selEnd) === -1 ? value.length : value.indexOf("\n", selEnd));
	const lines = value.slice(from, toIdx).split("\n");
	const allHave = lines.every(l => !l.trim() || listKindOf(l) === kind);
	let counter = 1;
	const changed = lines.map(line => {
		const indent = /^\s*/.exec(line)?.[0] ?? "";
		const bare = line.replace(LIST_PREFIX, "$1").trimStart();
		if (!line.trim()) return line;
		if (allHave) return indent + bare;
		const mark = kind === "number" ? `${counter++}. ` : LIST_MARK[kind];
		return indent + mark + bare;
	}).join("\n");
	editor.setRangeText(changed, from, toIdx, "select");
	if (wholeBox) editor.setSelectionRange(editor.value.length, editor.value.length);
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
	allowNoFile = false;
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
	get backgroundColor(): string { return this.data.backgroundColor; }
	get lineColor(): string { return this.data.lineColor; }
	get gridSize(): GridSize { return this.data.gridSize ?? "medium"; }
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
	private panStart = { x: 0, y: 0 };
	private pinchStart: { d: number; cx: number; cy: number; vt: { x: number; y: number; scale: number } } | null = null;
	private isDrawing = false;
	private currentStroke: Stroke | null = null;
	private renderedPoints = 0;
	private isShaping = false;
	private currentShape: Shape | null = null;
	private isErasing = false;
	private erasedAny = false;
	private eraseHistoryPushed = false;
	private hoverTooltipEl: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private marginEl: HTMLElement | null = null;
	private textPlacementHintEl: HTMLElement | null = null;
	private textMeasurer: CanvasRenderingContext2D | null = null;
	/** Obsidian's Prism instance once loaded; code blocks repaint when it arrives. */
	private prism: { highlight: (code: string, grammar: unknown, lang: string) => string; languages: Record<string, unknown> } | null = null;
	private focusModeEnabled = false;
	private activeTextEditor: HTMLTextAreaElement | null = null;
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

	getViewType(): string { return VIEW_TYPE_ONENOTE; }
	getDisplayText(): string { return this.file ? this.file.basename : "Pizarra NoteLens"; }
	getIcon(): string { return "pencil"; }

	// ------------------------------------------------------------------
	// Lifecycle
	// ------------------------------------------------------------------

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("onenote-workspace-host");

		this.workspaceEl = container.createDiv({ cls: "onenote-workspace" });
		this.workspaceEl.setAttr("data-bg", this.data.background);
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
				this.save();
			},
			() => this.saver?.currentPayload() ?? null
		);
		this.saver = new PersistenceManager(this.app, () => this.file);
		this.applySettings();

		createToolbar(this, this.workspaceEl);
		createQuickTagsBar(this.workspaceEl, (tag) => this.onPickTag(tag), () => this.toggleTagSummary());
		createSettingsPanel(this, this.workspaceEl);
		createNavigationControls(this, this.workspaceEl);
		createBookmarksControl(this, this.workspaceEl);
		createFocusModeControl(this, this.workspaceEl);
		this.calculator = createCalculatorPanel(this, this.workspaceEl);
		this.recorder = createRecorderPanel(this, this.workspaceEl);
		this.translator = createTranslatorPanel(this, this.workspaceEl);
		this.navigator = createNavigatorPanel(this, this.workspaceEl);
		void loadMathJax();
		void loadPrism().then(prism => {
			this.prism = prism;
			for (const tb of this.data.texts) {
				if (tb.variant !== "code") continue;
				const el = this.domLayerEl.querySelector(`[data-id="${tb.id}"]`) as HTMLElement | null;
				if (el && el !== this.activeTextSourceEl) {
					this.paintTextContent(el, tb);
					this.attachBoxChrome(el, tb);
				}
			}
		}).catch(() => { /* highlighting is optional */ });
		this.createMiniMap();
		this.createRuler();
		this.setupEvents();
		this.registerDomEvent(document, "visibilitychange", () => {
			if (document.visibilityState === "hidden") void this.saver?.flush(this.data);
		});
		this.registerDomEvent(window, "pagehide", () => void this.saver?.flush(this.data));
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

	async onClose(): Promise<void> {
		this.commitTextEditor();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		if (this.saver) await this.saver.flush(this.data);
	}

	async onLoadFile(file: TFile): Promise<void> {
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
		}
	}

	async onUnloadFile(file: TFile): Promise<void> {
		if (this.file?.path === file.path && this.saver) await this.saver.flush(this.data);
		await super.onUnloadFile(file);
	}

	private handleResize(): void {
		if (!this.workspaceEl || !this.renderer) return;
		const rect = this.workspaceEl.getBoundingClientRect();
		this.renderer.resize(rect.width, rect.height);
		this.applyStageTransform();
		this.renderInk();
	}

	// ------------------------------------------------------------------
	// Rendering
	// ------------------------------------------------------------------

	/** Ink-only refresh: PDFs, videos and an open text editor stay untouched. */
	private renderInk(): void {
		if (!this.renderer) return;
		this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
		this.renderMiniMap();
	}

	/** Full rebuild of ink and objects; only for structural document changes. */
	renderAll(): void {
		if (!this.renderer || !this.domLayerEl) return;
		this.applyStageTransform();
		this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
		this.renderDomLayer();
		this.renderA4Guides();
		this.renderMiniMap();
	}

	private renderDomLayer(): void {
		this.domLayerEl.empty();
		for (const b of this.data.badges) this.renderBadge(b);
		for (const t of this.data.texts) this.renderTextBox(t);
		for (const table of this.data.tables) this.renderTable(table);
		for (const e of this.data.embeds) renderEmbedFrame(this, this.domLayerEl, e);
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
				ws.style.backgroundImage = "none";
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

	/** Margin rule is a screen overlay whose x position follows the scene transform. */
	private updateMarginLine(): void {
		if (this.data.background === "margin") {
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
			this.workspaceEl.style.backgroundSize = "";
			this.workspaceEl.style.backgroundPosition = "";
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
		const { x, scale } = this.data.viewTransform;
		this.marginEl.style.left = `${x + MARGIN_SCENE_X * scale}px`;
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
		modeBtn.title = "Alternar regla y transportador";
		modeBtn.onclick = (event) => {
			event.stopPropagation();
			this.rulerState.mode = this.rulerState.mode === "ruler" ? "protractor" : "ruler";
			this.renderRuler();
		};
		const closeRuler = this.rulerEl.createEl("button", { cls: "notelens-embed-close notelens-ruler-close" });
		setIcon(closeRuler, "x");
		closeRuler.title = "Ocultar la regla";
		closeRuler.addEventListener("pointerdown", (event) => event.stopPropagation());
		closeRuler.onclick = (event) => { event.stopPropagation(); this.toggleRuler(); };
		const rotate = this.rulerEl.createDiv({ cls: "notelens-ruler-rotate" });
		rotate.title = "Girar regla";
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
			mode.setText(isProtractor ? `Ángulos ${angle}°` : "Regla");
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
			void target.requestFullscreen().catch(() => new Notice("Obsidian no permite pantalla completa aquí."));
		} else {
			new Notice("Este dispositivo no permite pantalla completa.");
		}
	}

	isFullscreen(): boolean { return document.fullscreenElement === this.containerEl; }

	/** Region capture for the translator: drag a rectangle, then read everything inside it. */
	captureBoardText(langCode: string, onProgress: (message: string) => void): Promise<string> {
		return new Promise((resolve, reject) => {
			this.commitTextEditor();
			const overlay = this.workspaceEl.createDiv({ cls: "notelens-capture-overlay" });
			const box = overlay.createDiv({ cls: "notelens-capture-box" });
			overlay.createDiv({ cls: "notelens-capture-hint", text: "Arrastra para elegir la zona que quieres leer. Esc cancela." });
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
				box.style.display = "block";
				box.style.left = `${start.x}px`; box.style.top = `${start.y}px`; box.style.width = "0px"; box.style.height = "0px";
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
		const typed = this.data.texts
			.filter(t => t.variant !== "math" && within(t.x, t.y, t.w ?? 200, t.h ?? 40) && t.text.trim())
			.map(t => t.text.trim());
		for (const table of this.data.tables) {
			if (within(table.x, table.y, table.w, table.h)) typed.push(table.cells.map(r => r.filter(c => c.trim()).join(" · ")).filter(Boolean).join("\n"));
		}

		// Rasterise the region: page colour, then images and PDF pages, then ink.
		const scale = clamp(1800 / Math.max(rect.w, rect.h), 1, 4);
		const canvas = document.createElement("canvas");
		canvas.width = Math.ceil(rect.w * scale);
		canvas.height = Math.ceil(rect.h * scale);
		const ctx = canvas.getContext("2d");
		if (!ctx) return typed.join("\n\n");
		ctx.fillStyle = isLightColor(this.data.backgroundColor) ? "#ffffff" : this.data.backgroundColor;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
		const ws = this.workspaceEl.getBoundingClientRect();
		const vt = this.data.viewTransform;
		let painted = 0;
		for (const el of Array.from(this.domLayerEl.querySelectorAll<HTMLCanvasElement | HTMLImageElement>("canvas.notelens-pdf-canvas, img.notelens-embed-img"))) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			const x = (r.left - ws.left - vt.x) / vt.scale;
			const y = (r.top - ws.top - vt.y) / vt.scale;
			const w = r.width / vt.scale;
			const h = r.height / vt.scale;
			if (!within(x, y, w, h)) continue;
			try { ctx.drawImage(el, x, y, w, h); painted++; } catch { /* cross-origin image */ }
		}
		const dark = !isLightColor(this.data.backgroundColor);
		for (const s of this.data.strokes) {
			const pts = s.points;
			if (!pts.some(p => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h)) continue;
			ctx.strokeStyle = s.type === "highlighter" ? "rgba(250, 204, 21, 0.35)" : dark ? "#f8fafc" : "#111111";
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
		if (painted > 0) {
			onProgress("Preparando el reconocimiento…");
			recognized = await recognizeImage(canvas, langCode, onProgress);
		}
		const parts = [...typed, recognized].filter(p => p.trim());
		onProgress(parts.length ? "Texto capturado." : "");
		return parts.join("\n\n");
	}

	toggleMiniMap(): void {
		this.miniMapVisible = !this.miniMapVisible;
		try { localStorage.setItem("notelens-minimap", this.miniMapVisible ? "1" : "0"); } catch { /* storage may be unavailable */ }
		this.miniMapEl?.toggleClass("hidden", !this.miniMapVisible);
		this.renderMiniMap();
		this.syncToolbar();
	}

	/** Tool defaults and behaviour switches from the plugin settings tab. */
	private applySettings(): void {
		const s = this.plugin.settings;
		this.strokeWidth = s.penWidth;
		if (s.penColor !== "auto") { this.penColorHex = s.penColor; this.penColorChosen = true; }
		this.highlighterColorHex = s.highlighterColor;
		this.highlighterWidth = s.highlighterWidth;
		this.highlighterIntensity = s.highlighterOpacity;
		this.textSize = s.textSize;
		this.calculatorUnit = s.calculatorDegrees ? "deg" : "rad";
		this.updateDerivedColors();
		this.workspaceEl.toggleClass("is-compact", s.compactUi);
		this.workspaceEl.toggleClass("hide-quick-tags", !s.showQuickTags);
	}

	private createMiniMap(): void {
		try {
			const stored = localStorage.getItem("notelens-minimap");
			this.miniMapVisible = stored === null ? this.plugin.settings.showMinimap : stored === "1";
		} catch { this.miniMapVisible = this.plugin.settings.showMinimap; }
		const wrap = this.workspaceEl.createDiv({ cls: "notelens-minimap" });
		wrap.toggleClass("hidden", !this.miniMapVisible);
		const header = wrap.createDiv({ cls: "notelens-minimap-header" });
		setIcon(header.createSpan({ cls: "notelens-minimap-icon" }), "map");
		header.createSpan({ cls: "notelens-minimap-title", text: "Mapa" });
		const closeBtn = header.createEl("button", { cls: "notelens-embed-close" });
		setIcon(closeBtn, "x");
		closeBtn.title = "Ocultar el mapa";
		closeBtn.onclick = () => this.toggleMiniMap();
		const canvas = wrap.createEl("canvas");
		canvas.width = 400;
		canvas.height = 240;
		canvas.setAttr("aria-label", "Minimapa de la pizarra");
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
				this.renderer.renderAll(this.data.strokes, this.data.shapes, vt);
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
		const content = getCanvasContentBounds(this.data, viewport);
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
		for (const shape of this.data.shapes) {
			rounded(mapX(Math.min(shape.x, shape.x + shape.w)), mapY(Math.min(shape.y, shape.y + shape.h)), Math.max(2, Math.abs(shape.w) * sx), Math.max(2, Math.abs(shape.h) * sy), shape.fill ? hexToRgba(shape.fill, 0.35) : "rgba(0,0,0,0)", shape.color);
		}
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const stroke of this.data.strokes) {
			if (stroke.points.length < 2) continue;
			ctx.beginPath();
			ctx.strokeStyle = stroke.color;
			ctx.lineWidth = Math.max(stroke.type === "highlighter" ? 4 : 2, stroke.width * Math.min(sx, sy));
			ctx.moveTo(mapX(stroke.points[0].x), mapY(stroke.points[0].y));
			for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(mapX(stroke.points[i].x), mapY(stroke.points[i].y));
			ctx.stroke();
		}
		for (const t of this.data.texts) {
			const el = this.domLayerEl.querySelector(`[data-id="${t.id}"]`) as HTMLElement | null;
			const w = el?.offsetWidth || t.w || 200;
			const h = el?.offsetHeight || t.h || 40;
			const fill = t.stickyColor ? hexToRgba(t.stickyColor, 0.9) : t.variant === "code" ? "rgba(125, 211, 252, 0.45)" : t.variant === "math" ? "rgba(167, 139, 250, 0.55)" : light ? "rgba(15, 23, 42, 0.3)" : "rgba(226, 232, 240, 0.5)";
			const edge = t.stickyColor ? "rgba(113, 87, 15, 0.8)" : t.variant === "code" ? "#7dd3fc" : t.variant === "math" ? "#c4b5fd" : light ? "rgba(15, 23, 42, 0.7)" : "rgba(241, 245, 249, 0.9)";
			rounded(mapX(t.x), mapY(t.y), Math.max(6, w * sx), Math.max(4, h * sy), fill, edge);
		}
		for (const table of this.data.tables) rounded(mapX(table.x), mapY(table.y), Math.max(6, table.w * sx), Math.max(4, table.h * sy), "rgba(56, 189, 248, 0.3)", "#38bdf8");
		for (const em of this.data.embeds) rounded(mapX(em.x), mapY(em.y), Math.max(6, em.w * sx), Math.max(4, em.h * sy), "rgba(148, 163, 184, 0.4)", "#cbd5e1");
		for (const b of this.data.badges) {
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

		this.registerDomEvent(this.workspaceEl, "wheel", (e) => this.onWheel(e), { passive: false });

		this.registerDomEvent(this.workspaceEl, "contextmenu", (e) => {
			if ((e.target as HTMLElement).closest(".onenote-placed-badge, .onenote-textbox, .notelens-embed, .notelens-pdf-stack, .notelens-loose-image")) return;
			e.preventDefault();
			this.showCanvasMenu(e);
		});

		this.registerDomEvent(window, "keydown", (e) => this.onKeyDown(e));
		this.registerDomEvent(window, "paste", (e) => void this.onPaste(e));
		this.registerDomEvent(this.workspaceEl, "dblclick", (e) => this.onDoubleClick(e));
		this.registerDomEvent(this.workspaceEl, "pointerleave", () => this.hideTextPlacementHint());
	}

	private showCanvasMenu(e: MouseEvent): void {
		const pt = this.getSceneCoords(e.clientX, e.clientY);
		const menu = new Menu();

		menu.addItem(item => item
			.setTitle("Cuadro de texto aquí")
			.setIcon("type")
			.onClick(() => this.createTextBoxAt(pt.x, pt.y)));

		menu.addItem(item => item
			.setTitle("Nota adhesiva aquí")
			.setIcon("sticky-note")
			.onClick(() => this.createStickyNoteAt(pt.x, pt.y)));

		menu.addItem(item => item
			.setTitle("Tabla aquí")
			.setIcon("table-2")
			.onClick(() => this.insertTableAt(pt.x, pt.y)));

		menu.addItem(item => item
			.setTitle("Bloque de código aquí")
			.setIcon("code-2")
			.onClick(() => this.createTextBoxAt(pt.x, pt.y, undefined, "code")));

		menu.addItem(item => item
			.setTitle("Dibujar forma")
			.setIcon("shapes")
			.onClick(() => this.setTool("shape")));

		menu.addItem(item => item
			.setTitle("Insertar PDF")
			.setIcon("file-text")
			.onClick(() => this.insertPdf()));

		menu.addItem(item => item
			.setTitle("Insertar vídeo")
			.setIcon("play-circle")
			.onClick(() => this.insertVideo()));

		menu.addItem(item => item
			.setTitle("Insertar imagen")
			.setIcon("image-plus")
			.onClick(() => this.insertImage()));

		menu.addItem(item => item
			.setTitle("Adjuntar archivo de la bóveda")
			.setIcon("paperclip")
			.onClick(() => this.insertFile()));

		menu.addItem(item => item
			.setTitle("Subir archivo desde el dispositivo")
			.setIcon("upload")
			.onClick(() => this.uploadFileFromDevice()));

		menu.addSeparator();

		menu.addItem(item => item
			.setTitle("Seleccionar")
			.setIcon("mouse-pointer-2")
			.onClick(() => this.setTool("select")));

		menu.addItem(item => item
			.setTitle("Lápiz")
			.setIcon("pencil")
			.onClick(() => this.setTool("pen")));

		menu.addSeparator();

		menu.addItem(item => item
			.setTitle("Restablecer vista")
			.setIcon("maximize")
			.onClick(() => this.resetView()));

		if (this.data.strokes.length || this.data.shapes.length || this.data.badges.length || this.data.texts.length || this.data.tables.length || this.data.embeds.length) {
			menu.addItem(item => item
				.setTitle("Limpiar pizarra")
				.setIcon("trash-2")
				.onClick(() => this.clearCanvas()));
		}

		menu.showAtMouseEvent(e);
	}

	/** Paste images from the clipboard straight onto the canvas. */
	private async onPaste(e: ClipboardEvent): Promise<void> {
		if (this.app.workspace.getActiveViewOfType(OneNoteCanvasView) !== this) return;
		const target = e.target as HTMLElement | null;
		if (target && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

		// Objects copied from a board (this one or another vault window).
		const text = e.clipboardData?.getData("text/plain") ?? "";
		if (text.startsWith(CLIP_PREFIX)) {
			e.preventDefault();
			try { this.pasteObjects(JSON.parse(text.slice(CLIP_PREFIX.length)) as ClipboardPayload); }
			catch (err) { console.error("NoteLens: paste failed", err); new Notice("No se pudo pegar la selección."); }
			return;
		}

		const files = e.clipboardData?.files;
		const img = files && files.length ? Array.from(files).find(f => f.type.startsWith("image/")) : undefined;
		if (!img) {
			if (!text.trim() && this.clipboardPayload) { e.preventDefault(); this.pasteObjects(this.clipboardPayload); return; }
			if (text.trim()) {
				// Plain text from anywhere becomes a text box under the pointer.
				e.preventDefault();
				this.history.push();
				this.clearSelection(false);
				const tb: TextBox = { id: genId("text"), x: 0, y: 0, text: text.trim(), fontSize: this.textSize, color: this.textColor, fontFamily: this.textFont, variant: "text", autoWidth: true, h: 48 };
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
				id: genId("embed"), kind: "image", src: tfile.path,
				x: c.x - 240, y: c.y - 180, w: 480, h: 0
			};
			this.data.embeds.push(embed);
			renderEmbedFrame(this, this.domLayerEl, embed);
			this.save();
			new Notice("Imagen pegada en la pizarra");
		} catch (err) {
			console.error("NoteLens: paste failed", err);
			new Notice("NoteLens: no se pudo pegar la imagen.");
		}
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (this.app.workspace.getActiveViewOfType(OneNoteCanvasView) !== this) return;
		const target = e.target as HTMLElement | null;
		if (target && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

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
			v: "select", p: "pen", h: "highlighter", e: "eraser", t: "text", s: "shape"
		};
		if (map[key]) {
			if (map[key] === "select") this.setSelectionMode("rect"); else this.setTool(map[key]);
		}
	}

	/** Double-click with the selection tool picks the topmost ink or shape. */
	private onDoubleClick(e: MouseEvent): void {
		if (this.currentTool !== "select") return;
		const target = e.target as HTMLElement;
		if (target.closest(".onenote-ribbon-dock, .notelens-insert-dock, .notelens-document-dock, .onenote-quick-tags, .notelens-pen-panel, .notelens-settings-panel, .notelens-settings-btn, .notelens-navigation-controls, .notelens-bookmarks-dock, .notelens-focus-toggle")) return;
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
			const strokeIdx = hitTestStrokes(this.data.strokes, pt.x, pt.y, 9);
			if (strokeIdx >= 0) this.selStrokes.add(this.data.strokes[strokeIdx].id);
			else {
				const shape = [...this.data.shapes].reverse().find(item => this.pointHitsShape(item, pt.x, pt.y, 8));
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
			this.renderer.renderAll(this.data.strokes, this.data.shapes, vt);
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
		this.renderer.renderAll(this.data.strokes, this.data.shapes, vt);
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
		const rects = [...this.data.texts, ...this.data.tables, ...this.data.embeds]
			.map(item => ({ x: item.x, y: item.y, w: item.w ?? 260, h: item.h ?? 60 }));
		let x = c.x - w / 2;
		let y = c.y - h / 2;
		const overlaps = () => rects.some(r => x < r.x + r.w + 12 && x + w + 12 > r.x && y < r.y + r.h + 12 && y + h + 12 > r.y);
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

		// Palm rejection: fingers only pan unless the settings allow finger inking.
		if ((e.pointerType === "touch" && !this.plugin.settings.fingerDraws) || e.button === 1) {
			this.startPan(e);
			return;
		}
		if (e.button !== 0) return;

		const pt = this.getSceneCoords(e.clientX, e.clientY);

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
				this.lassoEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
				this.lassoEl.setAttribute("class", "onenote-lasso");
				this.lassoEl.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "polygon"));
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
			e.preventDefault();
			// Like OneNote: the first click outside only finishes the edit.
			if (wasEditing) return;
			this.createTextBoxAt(pt.x, pt.y);
			return;
		}

		if (this.currentTool === "shape") {
			this.history.push();
			this.isShaping = true;
			this.currentShape = {
				id: genId("shape"), kind: this.shapeKind, x: pt.x, y: pt.y, w: 0, h: 0,
				color: this.derivedColorFor("pen"), width: Math.max(1.5, this.strokeWidth),
				fill: this.isFillableShape(this.shapeKind) && this.shapeFillEnabled ? this.shapeFillColor : undefined,
				fillOpacity: this.isFillableShape(this.shapeKind) && this.shapeFillEnabled ? this.shapeFillOpacity : 0
			};
			this.data.shapes.push(this.currentShape);
			this.save();
			return;
		}

		if (this.currentTool === "eraser") {
			this.isErasing = true;
			this.erasedAny = false;
			this.eraseHistoryPushed = false;
			this.eraseAt(pt.x, pt.y);
			return;
		}

		if (this.currentTool === "pen" || this.currentTool === "highlighter") {
			this.history.push();
			this.isDrawing = true;
			const isHighlighter = this.currentTool === "highlighter";
			const type = isHighlighter ? "highlighter" as const : "pen" as const;
			this.currentStroke = {
				id: genId("stroke"),
				type,
				color: this.derivedColorFor(type),
				width: isHighlighter ? this.highlighterWidth : this.strokeWidth,
				points: [{ ...this.getDrawingSceneCoords(e.clientX, e.clientY), p: e.pressure > 0 ? e.pressure : 0.5 }]
			};
			this.data.strokes.push(this.currentStroke);
			this.renderedPoints = 1;
			this.save();
		}
	}

	private onPointerMove(e: PointerEvent): void {
		this.lastPointerClient = { x: e.clientX, y: e.clientY };
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
			this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
			return;
		}

		if (this.isDrawing && this.currentStroke) {
			const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
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
			this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
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

		if (this.currentTool === "text" && !this.activeTextEditor) {
			// The "A" marker only makes sense over the page itself, never over a dock or panel.
			const target = e.target as HTMLElement | null;
			const focused = document.activeElement as HTMLElement | null;
			const typing = !!focused && (focused.isContentEditable || focused.tagName === "TEXTAREA" || focused.tagName === "INPUT");
			const overPage = !!target && (target === this.workspaceEl || target === this.renderer.canvas || this.stageEl.contains(target));
			if (overPage && !typing) this.updateTextPlacementHint(e); else this.hideTextPlacementHint();
		}
	}

	private onPointerUp(e: PointerEvent): void {
		this.pointers.delete(e.pointerId);

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
			if (this.erasedAny) this.save();
		}
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
			this.currentStroke = null;
			this.renderedPoints = 0;
			this.renderer.endLive();
			this.renderInk();
			this.save();
		}
		this.isPanning = false;
		this.workspaceEl.removeClass("is-panning");
		this.isErasing = false;

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
		this.renderer.renderAll(this.data.strokes, this.data.shapes, vt);
		this.syncToolbar();
	}

	private eraseAt(x: number, y: number): void {
		const slop = this.eraserSize / this.data.viewTransform.scale;
		if (this.eraserMode === "partial") {
			this.erasePartialAt(x, y, slop);
			return;
		}
		const idx = hitTestStrokes(this.data.strokes, x, y, slop);
		const shapeIdx = idx < 0
			? this.data.shapes.findIndex(shape => this.pointHitsShape(shape, x, y, slop))
			: -1;
		if (idx < 0 && shapeIdx < 0) return;
		if (!this.eraseHistoryPushed) {
			this.history.push();
			this.eraseHistoryPushed = true;
		}
		if (idx >= 0) this.data.strokes.splice(idx, 1);
		else this.data.shapes.splice(shapeIdx, 1);
		this.erasedAny = true;
		this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
	}

	/**
	 * Partial eraser: every stroke under the eraser loses the points it touches
	 * and the remaining pieces live on as separate strokes, so you can cut a
	 * line in two or trim its end instead of losing the whole thing.
	 */
	private erasePartialAt(x: number, y: number, radius: number): void {
		const next: Stroke[] = [];
		let changed = false;
		for (const stroke of this.data.strokes) {
			const pts = stroke.points;
			const reach = radius + stroke.width / 2;
			const hit = new Array<boolean>(pts.length).fill(false);
			let any = false;
			for (let i = 0; i < pts.length; i++) {
				if (Math.hypot(pts[i].x - x, pts[i].y - y) <= reach) { hit[i] = true; any = true; }
				if (i < pts.length - 1 && distPointToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= reach) {
					hit[i] = true; hit[i + 1] = true; any = true;
				}
			}
			if (!any) { next.push(stroke); continue; }
			changed = true;
			let run: StrokePoint[] = [];
			const flush = () => {
				if (run.length >= 2) next.push({ ...stroke, id: genId("stroke"), points: run });
				run = [];
			};
			for (let i = 0; i < pts.length; i++) {
				if (hit[i]) flush(); else run.push(pts[i]);
			}
			flush();
		}
		if (!changed) return;
		if (!this.eraseHistoryPushed) {
			this.history.push();
			this.eraseHistoryPushed = true;
		}
		this.data.strokes = next;
		this.erasedAny = true;
		this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
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
		for (const s of this.data.strokes) {
			const within = s.points.filter(p => inside(p.x, p.y)).length;
			if (within > 0 && within >= s.points.length * 0.5) this.selStrokes.add(s.id);
		}
		for (const shape of this.data.shapes) {
			if (inside(shape.x + shape.w / 2, shape.y + shape.h / 2)) this.selShapes.add(shape.id);
		}
		const centreInside = (id: string): boolean => {
			const r = this.elementSceneRect(id);
			return !!r && inside(r.x + r.w / 2, r.y + r.h / 2);
		};
		for (const b of this.data.badges) if (centreInside(b.id)) this.selBadges.add(b.id);
		for (const t of this.data.texts) if (centreInside(t.id)) this.selTexts.add(t.id);
		for (const table of this.data.tables) if (centreInside(table.id)) this.selTables.add(table.id);
		for (const em of this.data.embeds) if (centreInside(em.id)) this.selEmbeds.add(em.id);
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

		for (const s of this.data.strokes) {
			if (s.points.some(p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)) {
				this.selStrokes.add(s.id);
			}
		}
		for (const shape of this.data.shapes) {
			if (this.shapeIntersects(shape, x0, y0, x1, y1)) this.selShapes.add(shape.id);
		}
		for (const b of this.data.badges) {
			if (this.elementIntersects(b.id, x0, y0, x1, y1)) this.selBadges.add(b.id);
		}
		for (const t of this.data.texts) {
			if (this.elementIntersects(t.id, x0, y0, x1, y1)) this.selTexts.add(t.id);
		}
		for (const table of this.data.tables) {
			if (this.elementIntersects(table.id, x0, y0, x1, y1)) this.selTables.add(table.id);
		}
		for (const em of this.data.embeds) {
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

	private selectionBounds(): { x: number; y: number; w: number; h: number; contains: (px: number, py: number) => boolean } | null {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

		for (const s of this.data.strokes) {
			if (!this.selStrokes.has(s.id)) continue;
			for (const p of s.points) {
				minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
				maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
			}
		}
		for (const shape of this.data.shapes) {
			if (!this.selShapes.has(shape.id)) continue;
			minX = Math.min(minX, shape.x, shape.x + shape.w);
			minY = Math.min(minY, shape.y, shape.y + shape.h);
			maxX = Math.max(maxX, shape.x, shape.x + shape.w);
			maxY = Math.max(maxY, shape.y, shape.y + shape.h);
		}
		for (const id of [...this.selBadges, ...this.selTexts, ...this.selTables, ...this.selEmbeds]) {
			const r = this.elementSceneRect(id);
			if (!r) continue;
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
		const resize = box.createDiv({ cls: "notelens-selection-resize" });
		resize.title = "Redimensionar selección";
		// Compact action bar above the frame: duplicate and delete, nothing else in the way.
		const bar = box.createDiv({ cls: "notelens-selection-bar" });
		bar.addEventListener("pointerdown", (event) => { event.stopPropagation(); event.preventDefault(); });
		const action = (icon: string, title: string, run: () => void) => {
			const button = bar.createEl("button", { cls: "notelens-selection-action" });
			setIcon(button, icon);
			button.title = title;
			button.addEventListener("click", (event) => { event.stopPropagation(); run(); });
		};
		action("copy", "Duplicar (Ctrl+D)", () => this.duplicateSelection());
		action("x", "Eliminar (Supr)", () => this.deleteSelection());
		resize.addEventListener("pointerdown", (event) => this.startSelectionResize(event));
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

	private moveSelectionBy(dx: number, dy: number): void {
		let strokesMoved = false;

		for (const s of this.data.strokes) {
			if (!this.selStrokes.has(s.id)) continue;
			for (const p of s.points) { p.x += dx; p.y += dy; }
			strokesMoved = true;
		}
		for (const shape of this.data.shapes) {
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

		for (const b of this.data.badges) if (this.selBadges.has(b.id)) moveDom(b, b.id);
		for (const t of this.data.texts) if (this.selTexts.has(t.id)) moveDom(t, t.id);
		for (const table of this.data.tables) if (this.selTables.has(table.id)) moveDom(table, table.id);
		for (const em of this.data.embeds) if (this.selEmbeds.has(em.id)) moveDom(em, em.id);

		if (strokesMoved) {
			this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
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
		for (const text of this.data.texts) {
			if (!this.selTexts.has(text.id)) continue;
			const rect = this.elementSceneRect(text.id);
			texts.set(text.id, { x: text.x, y: text.y, w: text.w ?? rect?.w ?? 260, h: text.h ?? rect?.h ?? 48 });
		}
		return {
			bounds: { x: bounds.x, y: bounds.y, w: Math.max(bounds.w, 12), h: Math.max(bounds.h, 12) },
			strokes: new Map(this.data.strokes.filter(item => this.selStrokes.has(item.id)).map(item => [item.id, {
				points: item.points.map(point => ({ x: point.x, y: point.y })), width: item.width
			}])),
			shapes: new Map(this.data.shapes.filter(item => this.selShapes.has(item.id)).map(item => [item.id, {
				x: item.x, y: item.y, w: item.w, h: item.h, width: item.width
			}])),
			badges: new Map(this.data.badges.filter(item => this.selBadges.has(item.id)).map(item => [item.id, {
				x: item.x, y: item.y, scale: item.scale ?? 1
			}])),
			texts,
			tables: new Map(this.data.tables.filter(item => this.selTables.has(item.id)).map(item => [item.id, {
				x: item.x, y: item.y, w: item.w, h: item.h
			}])),
			embeds: new Map(this.data.embeds.filter(item => this.selEmbeds.has(item.id)).map(item => [item.id, {
				x: item.x, y: item.y, w: item.w, h: item.h
			}]))
		};
	}

	private applySelectionScale(snapshot: SelectionResizeSnapshot, sx: number, sy: number): void {
		const { x, y } = snapshot.bounds;
		const mapX = (value: number) => x + (value - x) * sx;
		const mapY = (value: number) => y + (value - y) * sy;
		const lineScale = Math.sqrt(sx * sy);
		for (const stroke of this.data.strokes) {
			const original = snapshot.strokes.get(stroke.id);
			if (!original) continue;
			for (let index = 0; index < stroke.points.length; index++) {
				stroke.points[index].x = mapX(original.points[index].x);
				stroke.points[index].y = mapY(original.points[index].y);
			}
			stroke.width = clamp(original.width * lineScale, 0.5, 48);
		}
		for (const shape of this.data.shapes) {
			const original = snapshot.shapes.get(shape.id);
			if (!original) continue;
			shape.x = mapX(original.x); shape.y = mapY(original.y);
			shape.w = original.w * sx; shape.h = original.h * sy;
			shape.width = clamp(original.width * lineScale, 0.5, 48);
		}
		for (const badge of this.data.badges) {
			const original = snapshot.badges.get(badge.id);
			if (!original) continue;
			badge.x = mapX(original.x); badge.y = mapY(original.y);
			badge.scale = clamp(original.scale * lineScale, 0.5, 3);
		}
		for (const text of this.data.texts) {
			const original = snapshot.texts.get(text.id);
			if (!original) continue;
			text.x = mapX(original.x); text.y = mapY(original.y);
			text.w = clamp(original.w * sx, text.stickyColor ? 180 : 120, 1800);
			text.h = clamp(original.h * sy, text.stickyColor ? 100 : 34, 1800);
		}
		for (const table of this.data.tables) {
			const original = snapshot.tables.get(table.id);
			if (!original) continue;
			table.x = mapX(original.x); table.y = mapY(original.y);
			table.w = clamp(original.w * sx, 160, 2200); table.h = clamp(original.h * sy, 96, 1800);
		}
		for (const embed of this.data.embeds) {
			const original = snapshot.embeds.get(embed.id);
			if (!original) continue;
			embed.x = mapX(original.x); embed.y = mapY(original.y);
			embed.w = clamp(original.w * sx, 80, 2400);
			embed.h = original.h > 0 ? clamp(original.h * sy, 80, 1800) : 0;
		}
		this.syncSelectedGeometry();
		this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
		this.renderSelectionBox();
	}

	private syncSelectedGeometry(): void {
		for (const badge of this.data.badges) {
			if (!this.selBadges.has(badge.id)) continue;
			const el = this.domLayerEl.querySelector(`[data-id="${badge.id}"]`) as HTMLElement | null;
			if (el) {
				el.style.left = `${badge.x}px`; el.style.top = `${badge.y}px`;
				el.style.transform = `scale(${badge.scale ?? 1})`;
			}
		}
		for (const text of this.data.texts) {
			if (!this.selTexts.has(text.id)) continue;
			const el = this.domLayerEl.querySelector(`[data-id="${text.id}"]`) as HTMLElement | null;
			if (el) { el.style.left = `${text.x}px`; el.style.top = `${text.y}px`; this.applyTextStyles(el, text); }
		}
		for (const table of this.data.tables) {
			if (!this.selTables.has(table.id)) continue;
			const el = this.domLayerEl.querySelector(`[data-id="${table.id}"]`) as HTMLElement | null;
			if (el) { el.style.left = `${table.x}px`; el.style.top = `${table.y}px`; el.style.width = `${table.w}px`; el.style.height = `${table.h}px`; }
		}
		for (const embed of this.data.embeds) {
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
		input.placeholder = "Buscar en la pizarra…";
		const count = bar.createSpan({ cls: "notelens-search-count", text: "" });
		const prev = bar.createEl("button", { cls: "notelens-nav-btn" });
		setIcon(prev, "chevron-up");
		prev.title = "Anterior (Shift+Enter)";
		const next = bar.createEl("button", { cls: "notelens-nav-btn" });
		setIcon(next, "chevron-down");
		next.title = "Siguiente (Enter)";
		const closeBtn = bar.createEl("button", { cls: "notelens-nav-btn" });
		setIcon(closeBtn, "x");
		closeBtn.title = "Cerrar (Esc)";
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
		for (const t of this.data.texts) {
			if (t.text.toLowerCase().includes(q)) hits.push({ id: t.id, x: t.x + (t.w ?? 200) / 2, y: t.y + (t.h ?? 40) / 2 });
		}
		for (const table of this.data.tables) {
			if (table.cells.some(row => row.some(cell => cell.toLowerCase().includes(q)))) hits.push({ id: table.id, x: table.x + table.w / 2, y: table.y + table.h / 2 });
		}
		for (const b of this.data.badges) {
			if (b.label.toLowerCase().includes(q) || (b.tooltip ?? "").toLowerCase().includes(q)) hits.push({ id: b.id, x: b.x, y: b.y });
		}
		for (const em of this.data.embeds) {
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
			if (el && (this.workspaceEl.contains(el)) && !el.closest(".onenote-ribbon-dock, .notelens-insert-dock, .notelens-document-dock, .onenote-quick-tags, .notelens-pen-panel, .notelens-calculator, .notelens-translator, .notelens-recorder, .notelens-navigator, .notelens-shortcuts, .notelens-tag-summary, .notelens-minimap, .notelens-settings-panel")) {
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
		new Notice(`${cut ? "Cortado" : "Copiado"}: ${count} ${count === 1 ? "objeto" : "objetos"}. Ctrl+V pega donde esté el ratón.`);
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
		const remap = <T extends { id: string; x?: number; y?: number }>(item: T, prefix: string): T => {
			const copy = JSON.parse(JSON.stringify(item)) as T;
			copy.id = genId(prefix);
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
		for (const s of this.data.strokes) this.selStrokes.add(s.id);
		for (const s of this.data.shapes) this.selShapes.add(s.id);
		for (const b of this.data.badges) this.selBadges.add(b.id);
		for (const t of this.data.texts) this.selTexts.add(t.id);
		for (const t of this.data.tables) this.selTables.add(t.id);
		for (const em of this.data.embeds) this.selEmbeds.add(em.id);
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
		if (tool !== "place_badge") (this.workspaceEl as any).__clearActiveTag?.();
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
	}

	private syncToolCursor(): void {
		if (!this.workspaceEl) return;
		this.workspaceEl.setAttr("data-tool", this.currentTool);
		this.workspaceEl.setAttr("data-pass-ink", ["pen", "highlighter", "eraser", "shape"].includes(this.currentTool) ? "true" : "false");
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
		this.syncToolbar();
	}

	setEraserMode(mode: EraserMode): void {
		this.eraserMode = mode;
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
		const bounds = getCanvasContentBounds(this.data, { x: 0, y: 0, w: 0, h: 0 });
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
		for (const s of this.data.strokes) {
			if (this.selStrokes.has(s.id)) { mutate(s); touched = true; }
		}
		if (!touched) return;
		this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
		this.save();
	}

	private applyToSelectedShapes(mutate: (shape: Shape) => void): void {
		if (this.selShapes.size === 0) return;
		this.history.push();
		let touched = false;
		for (const shape of this.data.shapes) {
			if (!this.selShapes.has(shape.id)) continue;
			mutate(shape);
			touched = true;
		}
		if (!touched) return;
		this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
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
		for (const t of this.data.texts) {
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
		this.syncToolbar();
	}

	isCalculatorOpen(): boolean { return this.calculator?.isOpen() ?? false; }

	toggleRecorder(): void {
		this.recorder?.toggle();
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
		new Notice(`Grabación guardada (${Math.round(seconds)} s): ${saved.name}`);
	}

	setCalculatorUnit(unit: AngleUnit): void { this.calculatorUnit = unit; }

	/** Drops "expresión = resultado" on the board as a text box. */
	insertCalculation(expression: string, result: string): void {
		this.history.push();
		const tb: TextBox = {
			id: genId("text"), x: 0, y: 0, text: `${expression} = ${result}`,
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
		const c = this.getInsertionPoint(320, 70);
		this.createTextBoxAt(c.x, c.y, undefined, "math");
	}

	setBackground(p: BackgroundPattern): void {
		this.history.push();
		this.data.background = p;
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
		this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
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
		this.renderer.renderAll(this.data.strokes, this.data.shapes, vt);
		this.syncToolbar();
		this.save();
	}

	private clearCanvas(): void {
		this.history.push();
		this.data.strokes = [];
		this.data.shapes = [];
		this.data.badges = [];
		this.data.texts = [];
		this.data.tables = [];
		this.data.embeds = [];
		this.data.bookmarks = [];
		this.clearSelection(false);
		this.hideFormatBar();
		this.renderAll();
		(this.workspaceEl as any).__refreshBookmarks?.();
		this.save();
		new Notice("Pizarra limpiada");
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
				id: genId("embed"), kind: "pdf", src: file.path,
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
				id: genId("embed"), kind: "image", src: file.path,
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
		const picker = document.createElement("input");
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
				new Notice(`Archivo añadido: ${saved.name}`);
			} catch (error) {
				console.error("NoteLens: device upload failed", error);
				new Notice("NoteLens: no se pudo añadir el archivo.");
			}
		};
		picker.click();
	}

	private insertVaultFile(file: TFile): void {
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
		const at = this.getInsertionPoint(dimensions.w, dimensions.h || 120);
		const embed: Embed = {
			id: genId("embed"), kind, src: file.path,
			x: kind === "note" || kind === "board" ? at.x : c.x - dimensions.w / 2,
			y: kind === "note" || kind === "board" ? at.y : c.y - dimensions.h / 2,
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
		this.hideTextPlacementHint();
		(this.workspaceEl as any).__closePenPanel?.();
		this.syncToolCursor();
		this.syncToolbar();
		new Notice(`Toca en el lienzo para colocar: ${tag.label}`);
	}

	private createBadgeAt(x: number, y: number, tag: QuickTag): void {
		const place = (tooltip: string) => {
			this.history.push();
			const badge: Badge = { id: genId("badge"), x, y, tagId: tag.id, label: tag.label, tooltip };
			this.data.badges.push(badge);
			this.renderBadge(badge);
			this.save();
			this.currentTool = "pen";
			this.activeBadgeTag = null;
			(this.workspaceEl as any).__clearActiveTag?.();
			this.syncToolCursor();
			this.syncToolbar();
		};

		if (tag.id === "tag_hover") {
			// The placeholder used to be passed as the initial value, so every note started with it.
			new TextPromptModal(this.app, "Nota flotante", "", (text) => {
				if (text.trim()) place(text.trim());
			}, "Escribe la nota que aparecerá al pasar el cursor por la etiqueta. Enter añade líneas; Ctrl+Enter acepta.").open();
		} else {
			place("");
		}
	}

	private renderBadge(badge: Badge): void {
		const tag = quickTagById(badge.tagId);
		const el = this.domLayerEl.createDiv({ cls: "onenote-placed-badge" });
		el.setAttr("data-id", badge.id);
		el.style.left = `${badge.x}px`;
		el.style.top = `${badge.y}px`;
		el.style.transformOrigin = "top left";
		el.style.transform = `scale(${badge.scale ?? 1})`;
		el.style.setProperty("--tag-color", tag.color);
		const checkable = badge.tagId === "tag_todo" || badge.tagId === "tag_question";
		el.toggleClass("is-checkable", checkable);
		el.toggleClass("is-done", !!badge.done);
		const iconEl = el.createSpan({ cls: "onenote-tag-icon" });
		setIcon(iconEl, badge.done ? "check-circle-2" : tag.icon);
		// Floating notes show their own text; other tags show their label (emoji prefixes from old files stripped).
		const excerpt = badge.tagId === "tag_hover" && badge.tooltip ? badge.tooltip.split("\n")[0].slice(0, 48) + (badge.tooltip.length > 48 ? "…" : "") : badge.label.replace(/^[\p{Extended_Pictographic}‍️\s]+/u, "");
		el.createSpan({ cls: "onenote-badge-label", text: excerpt });
		const badgeClose = el.createEl("button", { cls: "onenote-badge-close" });
		setIcon(badgeClose, "x");
		badgeClose.title = "Quitar etiqueta";
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
		if (checkable) el.title = badge.done ? "Hecho. Clic para volver a marcar como pendiente" : (badge.tagId === "tag_todo" ? "Clic para marcar la tarea como hecha" : "Clic para marcar la duda como resuelta");
		else if (badge.tagId === "tag_hover") el.title = "Nota flotante. Doble clic para editarla";
		else el.title = `${tag.label}. Clic para ver el resumen de etiquetas`;

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
			if (checkable) this.toggleBadgeDone(badge);
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
				.setTitle(badge.tagId === "tag_hover" ? "Editar la nota" : "Añadir una explicación")
				.setIcon("pencil")
				.onClick(() => this.editBadgeNote(badge)));
			if (badge.tagId === "tag_todo" || badge.tagId === "tag_question") {
				menu.addItem(item => item
					.setTitle(badge.done ? "Marcar como pendiente" : (badge.tagId === "tag_todo" ? "Marcar como hecha" : "Marcar como resuelta"))
					.setIcon(badge.done ? "circle" : "check-circle-2")
					.onClick(() => this.toggleBadgeDone(badge)));
			}
			menu.addItem(item => item
				.setTitle("Eliminar etiqueta")
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

		el.addEventListener("pointerenter", () => {
			if (badge.tooltip) this.showHoverTooltip(badge);
		});
		el.addEventListener("pointerleave", () => this.hideHoverTooltip());
	}

	private toggleBadgeDone(badge: Badge): void {
		this.history.push();
		badge.done = !badge.done;
		const el = this.domLayerEl.querySelector(`[data-id="${badge.id}"]`) as HTMLElement | null;
		el?.remove();
		this.renderBadge(badge);
		this.refreshTagSummary();
		this.save();
	}

	private editBadgeNote(badge: Badge): void {
		new TextPromptModal(this.app, badge.tagId === "tag_hover" ? "Nota flotante" : "Explicación de la etiqueta", badge.tooltip ?? "", (text) => {
			this.history.push();
			badge.tooltip = text.trim() || undefined;
			const el = this.domLayerEl.querySelector(`[data-id="${badge.id}"]`) as HTMLElement | null;
			el?.remove();
			this.renderBadge(badge);
			this.refreshTagSummary();
			this.save();
		}).open();
	}

	// ------------------------------------------------------------------
	// Tag summary (OneNote's "Find tags" pane)
	// ------------------------------------------------------------------

	private tagSummaryEl: HTMLElement | null = null;
	private tagSummaryFilter: string | null = null;
	private tagSummaryPendingOnly = false;

	toggleTagSummary(tagId?: string): void {
		if (this.tagSummaryEl && (!tagId || tagId === this.tagSummaryFilter)) {
			this.tagSummaryEl.remove();
			this.tagSummaryEl = null;
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
		let best: { text: string; d: number } | null = null;
		for (const t of this.data.texts) {
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
		header.createSpan({ text: "Etiquetas de la pizarra" });
		const closeBtn = header.createEl("button", { cls: "notelens-embed-close" });
		setIcon(closeBtn, "x");
		closeBtn.onclick = () => this.toggleTagSummary();

		const filters = panel.createDiv({ cls: "notelens-tag-summary-filters" });
		const allBtn = filters.createEl("button", { cls: "onenote-tag-chip", text: "Todas" });
		allBtn.toggleClass("active", this.tagSummaryFilter === null);
		allBtn.onclick = () => { this.tagSummaryFilter = null; this.refreshTagSummary(); };
		for (const tag of QUICK_TAGS) {
			const count = this.data.badges.filter(b => b.tagId === tag.id).length;
			const chip = filters.createEl("button", { cls: "onenote-tag-chip" });
			chip.style.setProperty("--tag-color", tag.color);
			setIcon(chip.createSpan({ cls: "onenote-tag-icon" }), tag.icon);
			chip.createSpan({ text: `${tag.label} ${count}` });
			chip.toggleClass("active", this.tagSummaryFilter === tag.id);
			chip.onclick = () => { this.tagSummaryFilter = tag.id; this.refreshTagSummary(); };
		}
		const pendingRow = panel.createEl("label", { cls: "notelens-fill-toggle" });
		const pendingToggle = pendingRow.createEl("input");
		pendingToggle.type = "checkbox";
		pendingToggle.checked = this.tagSummaryPendingOnly;
		pendingRow.createSpan({ text: "Solo pendientes" });
		pendingToggle.onchange = () => { this.tagSummaryPendingOnly = pendingToggle.checked; this.refreshTagSummary(); };

		const list = panel.createDiv({ cls: "notelens-tag-summary-list" });
		const items = this.data.badges
			.filter(b => (this.tagSummaryFilter === null || b.tagId === this.tagSummaryFilter) && !(this.tagSummaryPendingOnly && b.done));
		if (items.length === 0) {
			list.createDiv({ cls: "notelens-bookmarks-empty", text: this.data.badges.length ? "Nada que mostrar con este filtro." : "Coloca etiquetas desde la fila superior: Importante, Duda, Idea clave, Tarea o Nota flotante." });
		}
		for (const badge of items) {
			const tag = quickTagById(badge.tagId);
			const row = list.createDiv({ cls: "notelens-tag-summary-item" });
			row.style.setProperty("--tag-color", tag.color);
			row.toggleClass("is-done", !!badge.done);
			if (badge.tagId === "tag_todo" || badge.tagId === "tag_question") {
				const box = row.createEl("input");
				box.type = "checkbox";
				box.checked = !!badge.done;
				box.title = badge.tagId === "tag_todo" ? "Tarea hecha" : "Duda resuelta";
				box.onclick = (e) => { e.stopPropagation(); this.toggleBadgeDone(badge); };
			} else {
				setIcon(row.createSpan({ cls: "onenote-tag-icon" }), tag.icon);
			}
			const body = row.createDiv({ cls: "notelens-tag-summary-body" });
			body.createDiv({ cls: "notelens-tag-summary-kind", text: tag.label });
			const context = this.badgeContext(badge);
			body.createDiv({ cls: "notelens-tag-summary-text", text: context || "Sin texto cerca. Doble clic en la etiqueta para añadir una nota." });
			row.onclick = () => {
				this.panToScene(badge.x, badge.y, Math.max(this.data.viewTransform.scale, 1));
				this.clearSelection(false);
				this.selBadges.add(badge.id);
				this.renderSelectionBox();
			};
		}
		const pending = this.data.badges.filter(b => (b.tagId === "tag_todo" || b.tagId === "tag_question") && !b.done).length;
		panel.createDiv({ cls: "notelens-calculator-help", text: pending ? `${pending} pendiente${pending === 1 ? "" : "s"} entre tareas y dudas.` : "No hay tareas ni dudas pendientes." });
	}

	private showHoverTooltip(badge: Badge): void {
		this.hideHoverTooltip();
		const el = this.domLayerEl.createDiv({ cls: "onenote-top-tooltip" });
		el.setText(badge.tooltip ?? "");
		el.style.left = `${badge.x}px`;
		el.style.top = `${badge.y - 10}px`;
		this.hoverTooltipEl = el;
	}

	private hideHoverTooltip(): void {
		this.hoverTooltipEl?.remove();
		this.hoverTooltipEl = null;
	}

	// ------------------------------------------------------------------
	// Text boxes
	// ------------------------------------------------------------------

	private createTextBoxAt(x: number, y: number, stickyColor?: string, variant: "text" | "code" | "math" = "text"): void {
		this.history.push();
		this.clearSelection();
		const tb: TextBox = {
			id: genId("text"), x, y,
			text: "", fontSize: this.textSize,
			color: stickyColor ? "#302b19" : variant === "code" ? "#e2e8f0" : this.textColor || (isLightColor(this.data.backgroundColor) ? "#111827" : "#f8fafc"),
			stickyColor,
			w: stickyColor ? 220 : variant === "code" ? 440 : variant === "math" ? 320 : 160,
			h: stickyColor ? 150 : variant === "code" ? 180 : variant === "math" ? 60 : 48,
			autoWidth: !stickyColor && variant === "text",
			fontFamily: variant === "code" ? "mono" : this.textFont,
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
			id: genId("table"), x, y,
			w: 520, h: 220, rows: 3, cols: 3, header: false,
			cells: [["", "", ""], ["", "", ""], ["", "", ""]]
		};
		this.data.tables.push(table);
		this.renderTable(table);
		this.save();
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
		const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
		const shortcut = isMac ? "pulsa Fn dos veces (o Control dos veces)" : "pulsa Win+H";
		const hint = this.domLayerEl.createDiv({ cls: "notelens-dictation-hint" });
		setIcon(hint.createSpan(), "mic");
		hint.createSpan({ text: ` Dictado: ${shortcut} y habla. Se escribe aquí. Esc termina.` });
		hint.style.left = `${at.x}px`;
		hint.style.top = `${at.y + 56}px`;
		const remove = () => { hint.remove(); editor.removeEventListener("blur", remove); };
		editor.addEventListener("blur", remove);
		editor.focus();
		new Notice(`Dictado del sistema: ${shortcut} con el cuadro de texto activo. Funciona sin conexión.`, 7000);
	}

	getViewportBookmarks(): ViewportBookmark[] {
		return this.data.bookmarks;
	}

	addViewportBookmark(): void {
		const defaultLabel = `Sección ${this.data.bookmarks.length + 1}`;
		new TextPromptModal(this.app, "Guardar marcador", defaultLabel, (label) => {
			const c = this.getViewportCenterScene();
			this.history.push();
			this.data.bookmarks.push({
				id: genId("bookmark"),
				label: label.trim() || defaultLabel,
				x: c.x,
				y: c.y,
				scale: this.data.viewTransform.scale
			});
			(this.workspaceEl as any).__refreshBookmarks?.();
			this.save();
		}).open();
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
		this.panToScene(bookmark.x, bookmark.y, bookmark.scale);
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
			this.renderer.renderAll(this.data.strokes, this.data.shapes, this.data.viewTransform);
			if (t < 1) requestAnimationFrame(animate);
			else {
				this.syncToolbar();
				this.save();
			}
		};
		requestAnimationFrame(animate);
	}

	async exportA4Pdf(): Promise<void> {
		try {
			const bytes = createA4Pdf(this.data, this.getViewportSceneBounds());
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
			new Notice(`PDF A4 creado: ${saved.name}`);
			void this.app.workspace.openLinkText(saved.path, this.file?.path ?? "", true);
		} catch (error) {
			console.error("NoteLens: PDF export failed", error);
			new Notice("No se pudo exportar el PDF A4.");
		}
	}

	async exportSharePackage(): Promise<void> {
		try {
			new Notice("Preparando paquete editable de NoteLens...");
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
			new Notice(`Paquete editable creado: ${saved.name}${skipped}`);
		} catch (error) {
			console.error("NoteLens: share export failed", error);
			new Notice("No se pudo crear el paquete para compartir.");
		}
	}

	async importSharePackage(): Promise<void> {
		const picker = document.createElement("input");
		picker.type = "file";
		picker.accept = ".nlshare,application/zip,application/x-notelens";
		picker.onchange = async () => {
			const source = picker.files?.[0];
			if (!source) return;
			try {
				new Notice("Importando pizarra editable de NoteLens...");
				const result = await importShareArchive(this.app, source, this.file?.parent?.path ?? "");
				const missing = result.missingAssets.length ? ` (${result.missingAssets.length} adjunto(s) no se pudieron recuperar)` : "";
				new Notice(`Pizarra importada: ${result.file.basename}${missing}`);
				const leaf = this.app.workspace.getLeaf(true);
				await leaf.openFile(result.file);
			} catch (error) {
				console.error("NoteLens: share import failed", error);
				new Notice("No se pudo importar el paquete de NoteLens.");
			}
		};
		picker.click();
	}

	/** Translate button: opens the floating translator, preloaded with the selection or the box being edited. */
	translateText(): void {
		this.translator?.open();
		this.syncToolbar();
	}

	setTranslateLanguages(from: string, to: string): void {
		this.plugin.settings.translateFrom = from;
		this.plugin.settings.translateTo = to;
		void this.plugin.saveSettings();
	}

	getTranslationSource(): TranslationSource {
		const editor = this.activeTextEditor;
		if (editor) return { text: editor.value, kind: "editor", count: 1 };
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
			editor.value = text;
			editor.dispatchEvent(new Event("input"));
			return;
		}
		const targets = this.translatableSelection();
		if (targets.length === 0) { new Notice("Selecciona el cuadro de texto que quieres sustituir."); return; }
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
			id: genId("text"), x: 0, y: 0, text, fontSize: this.textSize, color: anchor?.color ?? this.textColor,
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

	private createStickyNoteAt(x: number, y: number): void {
		this.createTextBoxAt(x, y, "#fff2a8");
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

		const header = el.createDiv({ cls: "notelens-table-header" });
		header.createSpan({ cls: "notelens-table-title", text: "Tabla" });
		const controls = header.createDiv({ cls: "notelens-table-controls" });
		const control = (icon: string, title: string, action: () => void) => {
			const button = controls.createEl("button", { cls: "notelens-table-control" });
			setIcon(button, icon);
			button.title = title;
			button.addEventListener("pointerdown", (event) => event.stopPropagation());
			button.onclick = (event) => { event.stopPropagation(); action(); };
		};
		const headerBtn = controls.createEl("button", { cls: "notelens-table-control" });
		setIcon(headerBtn, "heading");
		headerBtn.title = table.header ? "Quitar la fila de encabezado" : "Usar la primera fila como encabezado";
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
				input.placeholder = table.header && row === 0 ? "Título" : "";
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
			handle.title = "Arrastra para cambiar el ancho de la columna";
			handle.addEventListener("pointerdown", (event) => this.startTableColumnResize(event, table, col));
		}
		offset = 0;
		for (let row = 0; row < table.rows - 1; row++) {
			offset += heights[row];
			const handle = grid.createDiv({ cls: "notelens-table-row-handle" });
			handle.style.top = `${offset}px`;
			handle.title = "Arrastra para cambiar el alto de la fila";
			handle.addEventListener("pointerdown", (event) => this.startTableRowResize(event, table, row));
		}

		const resize = el.createDiv({ cls: "notelens-table-resize" });
		resize.title = "Redimensionar tabla";
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
			menu.addItem(item => item.setTitle("Insertar fila arriba").setIcon("arrow-up-to-line").onClick(() => this.insertTableRow(table, row)));
			menu.addItem(item => item.setTitle("Insertar fila debajo").setIcon("arrow-down-to-line").onClick(() => this.insertTableRow(table, row + 1)));
			menu.addItem(item => item.setTitle("Insertar columna a la izquierda").setIcon("arrow-left-to-line").onClick(() => this.insertTableColumn(table, col)));
			menu.addItem(item => item.setTitle("Insertar columna a la derecha").setIcon("arrow-right-to-line").onClick(() => this.insertTableColumn(table, col + 1)));
			menu.addSeparator();
			menu.addItem(item => item.setTitle("Eliminar esta fila").setIcon("minus").onClick(() => this.deleteTableRow(table, row)));
			menu.addItem(item => item.setTitle("Eliminar esta columna").setIcon("minus").onClick(() => this.deleteTableColumn(table, col)));
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
		menu.addItem(item => item.setTitle("Repartir columnas por igual").setIcon("columns-3").onClick(() => {
			this.history.push();
			table.colWidths = undefined;
			table.rowHeights = undefined;
			this.renderAll();
			this.save();
		}));
		menu.addItem(item => item.setTitle("Crear gráfico con estos datos").setIcon("bar-chart-3").onClick(() => this.chartFromTable(table)));
		menu.addSeparator();
		menu.addItem(item => item.setTitle("Eliminar tabla").setIcon("trash-2").onClick(() => {
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

	private chartFromTable(table: CanvasTable): void {
		const spec = specFromTable(table);
		new ChartEditorModal(this.app, spec, (saved) => this.placeChart(saved, { x: table.x, y: table.y + table.h + 16 })).open();
	}

	private placeChart(spec: ChartData, at?: { x: number; y: number }): void {
		this.history.push();
		const size = { w: 460, h: 300 };
		const pos = at ?? this.getInsertionPoint(size.w, size.h);
		const embed: Embed = { id: genId("embed"), kind: "chart", src: "chart", chart: spec, x: pos.x, y: pos.y, w: size.w, h: size.h };
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
		el.contentEditable = "false";
		el.setAttr("role", "textbox");
		this.paintTextContent(el, tb);
		this.applyTextStyles(el, tb);

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
				.setTitle("Eliminar cuadro de texto")
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

	private beginTextEdit(tb: TextBox, el: HTMLElement): void {
		if (this.activeTextSourceEl === el && this.activeTextEditor) {
			this.activeTextEditor.focus();
			return;
		}
		this.commitTextEditor();
		this.hideTextPlacementHint();
		this.editSessionPushed = false;
		const editor = this.domLayerEl.createEl("textarea", { cls: "notelens-text-editor" });
		if (tb.variant === "code") {
			editor.addClass("notelens-code-editor");
			editor.setAttr("wrap", "off");
			editor.spellcheck = false;
			editor.placeholder = "Escribe o pega código. Tab indenta, Ctrl+Enter termina.";
		}
		if (tb.variant === "math") {
			editor.addClass("notelens-math-editor");
			editor.placeholder = "Escribe como en la calculadora: x^2/2 + sqrt(x), sum_(i=1)^n i, int_0^1 x^2 dx, [[a,b],[c,d]]. También vale LaTeX.";
			this.mathPreviewEl = this.domLayerEl.createDiv({ cls: "notelens-math-preview" });
			this.mathPreviewEl.style.left = `${tb.x}px`;
			this.mathPreviewEl.style.top = `${tb.y + (tb.h ?? 60) + 8}px`;
			this.mathPreviewEl.style.minWidth = `${tb.w ?? 320}px`;
		}
		editor.value = tb.text;
		editor.style.left = `${tb.x}px`;
		editor.style.top = `${tb.y}px`;
		this.applyTextStyles(editor, tb);
		editor.style.height = `${Math.max(tb.h ?? 48, editor.scrollHeight + 4)}px`;
		el.style.visibility = "hidden";
		this.activeTextEditor = editor;
		this.activeTextSourceEl = el;
		const openedAt = performance.now();
		editor.focus();
		editor.setSelectionRange(editor.value.length, editor.value.length);
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
			editor.style.height = "auto";
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
				editor.blur();
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
				requestAnimationFrame(() => { if (this.activeTextEditor === editor) editor.focus(); });
				return;
			}
			this.commitTextEditor();
		});
		this.showFormatBar(tb, editor);
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
		source.style.visibility = "";
		this.editSessionPushed = false;
		this.hideFormatBar();
		if (!tb) return;

		// A fenced block (```lang … ```) pasted into a plain box turns it into a
		// code block with that language; inside a code block it just sets the language.
		const fence = /^```([\w+#.-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(editor.value);
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
			editor.value = fence[2];
		}

		const empty = editor.value.trim() === "" && !tb.stickyColor && tb.variant !== "code";
		if (empty) {
			// An abandoned click must not leave an invisible box behind.
			source.remove();
			this.data.texts.remove(tb);
			this.selTexts.delete(tb.id);
			this.renderSelectionBox();
			this.save();
			return;
		}
		tb.text = editor.value;
		this.applyTextStyles(source, tb);
		this.paintTextContent(source, tb);
		if (tb.variant === "code") {
			// A code block hugs its lines instead of keeping the editor's spare height.
			source.style.minHeight = "";
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
			if (!src) { el.createSpan({ cls: "notelens-math-placeholder", text: "Fórmula" }); return; }
			el.appendChild(this.renderMathSafe(toRenderableLatex(src), true));
			void finishRenderMath();
			return;
		}
		if (tb.variant === "code") { this.paintCode(el, tb); return; }
		if (!tb.text.includes("$")) { this.appendLinkified(el, tb.text); return; }
		let typeset = false;
		for (const part of tb.text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g)) {
			if (!part) continue;
			if (part.length > 4 && part.startsWith("$$") && part.endsWith("$$")) {
				el.appendChild(this.renderMathSafe(toRenderableLatex(part.slice(2, -2)), true));
				typeset = true;
			} else if (part.length > 2 && part.startsWith("$") && part.endsWith("$")) {
				el.appendChild(this.renderMathSafe(toRenderableLatex(part.slice(1, -1)), false));
				typeset = true;
			} else {
				this.appendLinkified(el, part);
			}
		}
		if (typeset) void finishRenderMath();
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
		copy.title = "Copiar código";
		copy.addEventListener("pointerdown", (e) => e.stopPropagation());
		copy.addEventListener("click", (e) => {
			e.stopPropagation();
			void navigator.clipboard?.writeText(tb.text).then(() => new Notice("Código copiado"));
		});
		const closeCode = header.createEl("button", { cls: "notelens-code-copy" });
		setIcon(closeCode, "x");
		closeCode.title = "Eliminar bloque";
		closeCode.addEventListener("pointerdown", (e) => e.stopPropagation());
		closeCode.addEventListener("click", (e) => { e.stopPropagation(); this.removeTextBox(tb); });

		const body = el.createDiv({ cls: "notelens-code-body" });
		const lines = tb.text.split("\n");
		const gutter = body.createDiv({ cls: "notelens-code-gutter" });
		for (let i = 1; i <= lines.length; i++) gutter.createDiv({ text: String(i) });
		const code = body.createEl("code", { cls: "notelens-code-source" });
		if (!tb.text) {
			code.createSpan({ cls: "notelens-math-placeholder", text: "Bloque de código vacío" });
			return;
		}
		const grammar = lang !== "plaintext" ? this.prism?.languages?.[lang] : undefined;
		if (grammar && this.prism) {
			// Prism escapes the source itself; only its own markup goes in.
			code.innerHTML = this.prism.highlight(tb.text, grammar, lang);
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
		const opens = /[{(\[:]\s*$/.test(line) ? "    " : "";
		editor.setRangeText("\n" + indent + opens, start, editor.selectionEnd, "end");
	}

	private renderMathSafe(source: string, display: boolean): HTMLElement {
		try {
			return renderMath(source, display);
		} catch {
			const fallback = document.createElement("span");
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
		if (!src) { preview.createSpan({ cls: "notelens-math-placeholder", text: "Vista previa de la fórmula" }); return; }
		preview.appendChild(this.renderMathSafe(toRenderableLatex(src), true));
		void finishRenderMath();
	}

	/** Width that fits the longest line, like OneNote boxes that grow as you type. */
	private measureAutoWidth(tb: TextBox): number {
		const ctx = this.textMeasurer ?? (this.textMeasurer = document.createElement("canvas").getContext("2d"));
		if (!ctx) return tb.w ?? 260;
		ctx.font = `${tb.italic ? "italic " : ""}${tb.bold ? "700" : "400"} ${tb.fontSize}px ${this.fontStack(tb.fontFamily ?? "sans")}`;
		let widest = 0;
		for (const line of tb.text.split("\n")) widest = Math.max(widest, ctx.measureText(line).width);
		return clamp(Math.ceil(widest) + 24, 160, 640);
	}

	/** Resize handle and close button every text box carries. */
	private attachBoxChrome(el: HTMLElement, tb: TextBox): void {
		const resizeHandle = el.createDiv({ cls: "notelens-text-resize" });
		resizeHandle.title = "Redimensionar";
		resizeHandle.addEventListener("pointerdown", (e) => this.startTextResize(e, tb, el));
		const closeBtn = el.createEl("button", { cls: "notelens-box-close" });
		setIcon(closeBtn, "x");
		closeBtn.title = "Eliminar";
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

	private updateTextPlacementHint(e: PointerEvent): void {
		if (!this.textPlacementHintEl) {
			this.textPlacementHintEl = this.workspaceEl.createDiv({ cls: "notelens-text-placement-hint" });
			this.textPlacementHintEl.createSpan({ text: "A" });
			this.textPlacementHintEl.createDiv({ cls: "notelens-text-placement-line" });
		}
		const rect = this.workspaceEl.getBoundingClientRect();
		this.textPlacementHintEl.style.left = `${e.clientX - rect.left}px`;
		this.textPlacementHintEl.style.top = `${e.clientY - rect.top}px`;
	}

	private hideTextPlacementHint(): void {
		this.textPlacementHintEl?.remove();
		this.textPlacementHintEl = null;
	}

	private applyTextStyles(el: HTMLElement, tb: TextBox): void {
		el.style.fontSize = `${tb.fontSize}px`;
		el.style.color = tb.color;
		el.style.fontWeight = tb.bold ? "700" : "400";
		el.style.fontStyle = tb.italic ? "italic" : "normal";
		el.style.textDecoration = tb.underline ? "underline" : "none";
		el.style.textAlign = tb.align ?? "left";
		el.style.backgroundColor = tb.stickyColor ?? "";
		el.style.fontFamily = this.fontStack(tb.fontFamily ?? (tb.variant === "code" ? "mono" : "sans"));
		el.style.width = tb.w ? `${tb.w}px` : "";
		el.style.minHeight = tb.h ? `${tb.h}px` : "";
	}

	private fontStack(font: CanvasFont): string {
		switch (font) {
			case "serif": return "Georgia, 'Times New Roman', serif";
			case "rounded": return "'Trebuchet MS', 'Segoe UI', sans-serif";
			case "mono": return "ui-monospace, SFMono-Regular, Consolas, monospace";
			default: return "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
		}
	}

	// ------------------------------------------------------------------
	// Floating text format bar
	// ------------------------------------------------------------------

	private formatBarEl: HTMLElement | null = null;
	private editSessionPushed = false;

	private pushEditSession(): void {
		if (!this.editSessionPushed) {
			this.history.push();
			this.editSessionPushed = true;
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
		bar.addEventListener("change", () => { if (el instanceof HTMLTextAreaElement) el.focus(); });

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
			b.title = title;
			b.onclick = () => apply(toggle);
			toggleButtons.set(key, b);
		};

		// Code and math boxes have no use for weight, style or typeface controls.
		const plainText = tb.variant !== "code" && tb.variant !== "math";
		if (plainText) {
			mkToggle("bold", "bold", "Negrita", () => { tb.bold = !tb.bold; });
			mkToggle("italic", "italic", "Cursiva", () => { tb.italic = !tb.italic; });
			mkToggle("underline", "underline", "Subrayado", () => { tb.underline = !tb.underline; });
			bar.createDiv({ cls: "onenote-divider" });
			mkToggle("align-left", "align-left", "Alinear a la izquierda", () => { tb.align = "left"; });
			mkToggle("align-center", "align-center", "Centrar", () => { tb.align = "center"; });
			mkToggle("align-right", "align-right", "Alinear a la derecha", () => { tb.align = "right"; });
			bar.createDiv({ cls: "onenote-divider" });
			if (el instanceof HTMLTextAreaElement) {
				const listButton = (icon: string, title: string, kind: ListKind) => {
					const b = bar.createEl("button", { cls: "onenote-dock-btn notelens-format-btn" });
					setIcon(b, icon);
					b.title = title;
					b.onclick = () => { this.pushEditSession(); toggleListPrefix(el, kind); el.dispatchEvent(new Event("input")); el.focus(); };
				};
				listButton("list", "Lista con viñetas (•)", "bullet");
				listButton("list-ordered", "Lista numerada (1. 2. 3.)", "number");
				listButton("arrow-right", "Lista con flechas (→)", "arrow");
				listButton("minus", "Lista con guiones (-)", "dash");
				bar.createDiv({ cls: "onenote-divider" });
			}
		}
		const fontSelect = bar.createEl("select", { cls: "notelens-format-font" });
		for (const [value, label] of [["sans", "Interfaz"], ["serif", "Clásica"], ["rounded", "Redondeada"], ["mono", "Mono"]] as [CanvasFont, string][]) {
			fontSelect.createEl("option", { value, text: label });
		}
		fontSelect.value = tb.fontFamily ?? "sans";
		fontSelect.onchange = () => apply(() => { tb.fontFamily = fontSelect.value as CanvasFont; });
		if (!plainText) fontSelect.hide();

		const minusBtn = bar.createEl("button", { cls: "onenote-dock-btn notelens-format-btn" });
		setIcon(minusBtn, "minus");
		minusBtn.title = "Reducir tamaño";
		minusBtn.onclick = () => apply(() => { tb.fontSize = Math.max(10, tb.fontSize - 2); });

		const sizeLabel = bar.createSpan({ cls: "notelens-format-size" });

		if (plainText) {
			const translateBtn = bar.createEl("button", { cls: "onenote-dock-btn notelens-format-btn" });
			setIcon(translateBtn, "languages");
			translateBtn.title = "Traducir este cuadro";
			translateBtn.onclick = () => this.translateText();
		}

		const plusBtn = bar.createEl("button", { cls: "onenote-dock-btn notelens-format-btn" });
		setIcon(plusBtn, "plus");
		plusBtn.title = "Aumentar tamaño";
		plusBtn.onclick = () => apply(() => { tb.fontSize = Math.min(96, tb.fontSize + 2); });

		if (tb.variant !== "code") {
			bar.createDiv({ cls: "onenote-divider" });
			for (const c of TEXT_COLORS) {
				const dot = bar.createDiv({ cls: "onenote-color-dot notelens-format-color" });
				dot.style.backgroundColor = c;
				dot.title = c;
				dot.onclick = () => apply(() => { tb.color = c; });
			}
		}

		if (tb.stickyColor) {
			bar.createDiv({ cls: "onenote-divider" });
			for (const c of ["#fff2a8", "#c9f5d6", "#cde8ff", "#ffd7e5", "#eadbff"]) {
				const dot = bar.createDiv({ cls: "onenote-color-dot notelens-format-color" });
				dot.style.backgroundColor = c;
				dot.title = "Color de la nota";
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
			toggleButtons.get("bold")?.toggleClass("active", !!tb.bold);
			toggleButtons.get("italic")?.toggleClass("active", !!tb.italic);
			toggleButtons.get("underline")?.toggleClass("active", !!tb.underline);
			toggleButtons.get("align-left")?.toggleClass("active", (tb.align ?? "left") === "left");
			toggleButtons.get("align-center")?.toggleClass("active", tb.align === "center");
			toggleButtons.get("align-right")?.toggleClass("active", tb.align === "right");
			sizeLabel.setText(`${tb.fontSize}`);
		};
		refreshStates();

		if (tb.variant === "math" && el instanceof HTMLTextAreaElement) {
			bar.addClass("is-math");
			const palette = bar.createDiv({ cls: "notelens-math-palette" });
			const snippets: [string, string, string][] = [
				["a/b", "Fracción", "(a)/(b)"], ["√", "Raíz", "sqrt(x)"], ["xⁿ", "Potencia", "x^(n)"], ["xₙ", "Subíndice", "x_(n)"],
				["Σ", "Sumatorio", "sum_(i=1)^n "], ["∫", "Integral", "int_a^b  dx"], ["lim", "Límite", "lim_(x->oo) "], ["∞", "Infinito", "oo"],
				["π", "Pi", "pi"], ["α", "Alfa", "alpha"], ["θ", "Theta", "theta"], ["±", "Más menos", "+-"], ["≤", "Menor o igual", "<="], ["≠", "Distinto", "!="],
				["→", "Flecha", "->"], ["·", "Producto", "*"], ["|x|", "Valor absoluto", "abs(x)"], ["[ ]", "Matriz 2×2", "[[a,b],[c,d]]"], ["\\", "Nueva línea", "\n"]
			];
			for (const [label, title, snippet] of snippets) {
				const b = palette.createEl("button", { cls: "notelens-math-key", text: label });
				b.title = title;
				b.onclick = () => {
					const insert = snippet === "\\n" ? "\n" : snippet;
					const start = el.selectionStart ?? el.value.length;
					el.setRangeText(insert, start, el.selectionEnd ?? start, "end");
					// Leave the caret where the argument goes, if the snippet has an empty slot.
					const slot = insert.indexOf("()") >= 0 ? insert.indexOf("()") + 1 : insert.indexOf("  ") >= 0 ? insert.indexOf("  ") + 1 : -1;
					if (slot >= 0) el.setSelectionRange(start + slot, start + slot);
					el.focus();
					el.dispatchEvent(new Event("input"));
				};
			}
		}

		const closeBar = bar.createEl("button", { cls: "notelens-embed-close notelens-format-close" });
		setIcon(closeBar, "x");
		closeBar.title = "Terminar de editar (Esc)";
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
	}

	private hideFormatBar(): void {
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
		this.saver?.scheduleSave(this.data);
	}
}

/** Minimal text-input modal (window.prompt is unavailable in Obsidian). */
class TextPromptModal extends Modal {
	constructor(
		app: OneNoteCanvasView["app"],
		private title: string,
		private initial: string,
		private onSubmit: (text: string) => void,
		private placeholder = "Escribe aquí. Enter añade líneas; Ctrl+Enter acepta."
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.title });

		let value = this.initial;
		const submit = () => {
			this.close();
			this.onSubmit(value);
		};
		// A full multi-line editor: the whole note is visible while you write it.
		const area = contentEl.createEl("textarea", { cls: "notelens-prompt-textarea" });
		area.value = this.initial;
		area.placeholder = this.placeholder;
		area.rows = 8;
		area.addEventListener("input", () => { value = area.value; });
		area.addEventListener("keydown", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(); }
			if (e.key === "Escape") { e.preventDefault(); this.close(); }
		});
		const counter = contentEl.createDiv({ cls: "setting-item-description notelens-prompt-counter" });
		const updateCounter = () => { counter.setText(`${area.value.length} caracteres`); };
		area.addEventListener("input", updateCounter);
		updateCounter();
		window.setTimeout(() => { area.focus(); area.setSelectionRange(area.value.length, area.value.length); }, 50);

		new Setting(contentEl)
			.addButton(btn => btn.setButtonText("Aceptar").setCta().onClick(submit))
			.addButton(btn => btn.setButtonText("Cancelar").onClick(() => this.close()));
	}
}
