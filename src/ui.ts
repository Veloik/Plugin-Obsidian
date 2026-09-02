import { setIcon } from "obsidian";
import { BackgroundPattern, CanvasFont, DocumentPage, GridSize, ShapeKind, ViewportBookmark, PenStyle, Stroke } from "./types";
import { CanvasRenderer } from "./renderer";
import { tr } from "./i18n";

export type ToolId = "select" | "pen" | "highlighter" | "eraser" | "text" | "shape" | "place_badge";
/** "stroke" removes whole strokes; "partial" cuts only what the eraser touches. */
export type EraserMode = "stroke" | "partial";
/** Rectangle drag or a free-hand lasso, like OneNote's lasso select. */
export type SelectionMode = "rect" | "lasso";

export interface QuickTag {
	id: string;
	label: string;
	icon: string;
	color: string;
}

export const QUICK_TAGS: QuickTag[] = [
	{ id: "tag_star", label: "Importante", icon: "star", color: "#eab308" },
	{ id: "tag_question", label: "Duda", icon: "help-circle", color: "#a855f7" },
	{ id: "tag_idea", label: "Idea clave", icon: "lightbulb", color: "#facc15" },
	{ id: "tag_todo", label: "Tarea", icon: "check-square", color: "#22c55e" },
	{ id: "tag_hover", label: "Nota flotante", icon: "message-square", color: "#38bdf8" }
];

const TAG_HINTS: Record<string, string> = {
	tag_star: "Importante: márcalo para encontrarlo al repasar",
	tag_question: "Duda: algo que preguntar o aclarar",
	tag_idea: "Idea clave: el concepto que hay que recordar",
	tag_todo: "Tarea: pendiente con casilla; clic para completarla",
	tag_hover: "Nota flotante: un aviso que aparece al pasar el ratón"
};

export function quickTagById(id: string): QuickTag {
	return QUICK_TAGS.find(t => t.id === id) ?? QUICK_TAGS[0];
}

export const PALETTE_COLORS = [
	"#e5e7eb", "#f8fafc", "#93c5fd", "#38bdf8", "#22d3ee",
	"#34d399", "#86efac", "#fde047", "#fbbf24", "#fb923c",
	"#f87171", "#fb7185", "#c084fc", "#a78bfa", "#94a3b8"
];

export const HIGHLIGHTER_COLORS = [
	"#facc15", "#fde047", "#bef264", "#86efac", "#5eead4",
	"#67e8f9", "#93c5fd", "#c4b5fd", "#f0abfc", "#fda4af"
];

const WIDTH_PRESETS = [1, 2, 3.5, 5, 8, 12, 18];

/** Pen nibs: icon shown on the ribbon, label and a one-line description for the panel. */
export const PEN_STYLES: { id: PenStyle; icon: string; label: string; hint: string }[] = [
	{ id: "ballpoint", icon: "pen", label: "Bolígrafo", hint: "Trazo limpio y uniforme; la presión lo afina un poco." },
	{ id: "pencil", icon: "pencil", label: "Lápiz", hint: "Grafito suave con grano, ideal para bocetos y apuntes rápidos." },
	{ id: "fountain", icon: "feather", label: "Pluma", hint: "Engorda cuando vas despacio y se afina al correr, como una plumilla." },
	{ id: "marker", icon: "pen-line", label: "Rotulador", hint: "Punta de fieltro: grosor constante, sin importar la presión." },
	{ id: "brush", icon: "brush", label: "Pincel", hint: "La presión manda y los extremos se afinan; con ratón queda caligráfico." }
];
export const penStyleById = (id: PenStyle) => PEN_STYLES.find(p => p.id === id) ?? PEN_STYLES[0];
const HIGHLIGHTER_WIDTHS = [12, 18, 24, 32, 40];
const ERASER_SIZES: { label: string; value: number }[] = [
	{ label: "S", value: 6 },
	{ label: "M", value: 10 },
	{ label: "L", value: 22 },
	{ label: "XL", value: 36 }
];
const TEXT_SIZES = [12, 16, 20, 28, 36, 48];
const TEXT_COLORS = ["#f8fafc", "#111827", "#38bdf8", "#ef4444", "#22c55e", "#a855f7", "#eab308"];
const FONT_OPTIONS: { id: CanvasFont; label: string; css: string }[] = [
	{ id: "sans", label: "Interfaz", css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
	{ id: "serif", label: "Clásica", css: "Georgia, 'Times New Roman', serif" },
	{ id: "rounded", label: "Redondeada", css: "'Trebuchet MS', 'Segoe UI', sans-serif" },
	{ id: "mono", label: "Monoespaciada", css: "ui-monospace, SFMono-Regular, Consolas, monospace" }
];

const BG_OPTIONS: { id: BackgroundPattern; label: string; icon: string }[] = [
	{ id: "blank", label: "Liso", icon: "square" },
	{ id: "dots", label: "Puntos", icon: "grip" },
	{ id: "grid", label: "Rejilla", icon: "layout-grid" },
	{ id: "lines", label: "Rayas", icon: "align-justify" }
];

const LINE_COLORS = [
	"#475569", "#64748b", "#94a3b8", "#cbd5e1", "#dbeafe", "#bfdbfe",
	"#38bdf8", "#2563eb", "#22c55e", "#eab308", "#f97316", "#ef4444",
	"#a855f7", "#ec4899", "#14b8a6", "#0f172a"
];

const PAGE_COLORS = [
	"#0b0e14", "#111827", "#0f172a", "#172033", "#052f3d", "#123229",
	"#2b1d3f", "#3a2028", "#fff8ed", "#f1f5f9", "#e8f2ff", "#e8f7ee",
	"#f7ecff", "#ffe8ee", "#ffedd6", "#f2eadf", "#dfeeff", "#dff3ea",
	"#ece2fb", "#ffdfe9", "#ffe5c9", "#dff3f2", "#e5e6f7", "#ebe5da"
];

/** Tools that open the contextual options panel. */
const TOOLS_WITH_PANEL: ToolId[] = ["select", "pen", "highlighter", "eraser", "text", "shape"];

/** UI surface the panels need from the view. */
export interface ToolbarHost {
	currentTool: ToolId;
	strokeColor: string;
	penColorHex: string;
	highlighterColor: string;
	strokeWidth: number;
	strokeIntensity: number;
	penStyle: PenStyle;
	highlighterColorHex: string;
	highlighterWidth: number;
	highlighterIntensity: number;
	eraserSize: number;
	eraserMode: EraserMode;
	selectionMode: SelectionMode;
	textSize: number;
	textColor: string;
	textFont: CanvasFont;
	shapeKind: ShapeKind;
	shapeFillColor: string;
	shapeFillOpacity: number;
	shapeFillEnabled: boolean;
	background: BackgroundPattern;
	marginEnabled: boolean;
	backgroundColor: string;
	lineColor: string;
	gridSize: GridSize;
	recentColors: string[];
	setTool(tool: ToolId): void;
	setPenColor(hex: string): void;
	setHighlighterColor(hex: string): void;
	setStrokeWidth(w: number): void;
	setPenStyle(style: PenStyle): void;
	setStrokeIntensity(v: number): void;
	setEraserSize(v: number): void;
	setEraserMode(mode: EraserMode): void;
	setSelectionMode(mode: SelectionMode): void;
	fitToContent(): void;
	toggleTagSummary(): void;
	setTextSize(v: number): void;
	setTextColor(hex: string): void;
	setTextFont(font: CanvasFont): void;
	setShapeKind(kind: ShapeKind): void;
	setShapeFillColor(hex: string): void;
	setShapeFillOpacity(opacity: number): void;
	setShapeFillEnabled(enabled: boolean): void;
	setBackground(p: BackgroundPattern): void;
	setMarginEnabled(enabled: boolean): void;
	/** Opens NoteLens's own tab in Obsidian's settings window. */
	openPluginSettings(): void;
	setBackgroundColor(hex: string): void;
	setLineColor(hex: string): void;
	setGridSize(size: GridSize): void;
	insertMathBlock(): void;
	toggleCalculator(): void;
	isCalculatorOpen(): boolean;
	resetView(): void;
	undo(): void;
	redo(): void;
	insertPdf(): void;
	insertVideo(): void;
	insertImage(): void;
	insertFile(): void;
	insertLink(): void;
	insertChart(): void;
	toggleNavigator(): void;
	isNavigatorOpen(): boolean;
	uploadFileFromDevice(): void;
	insertTable(): void;
	insertCodeBlock(): void;
	startDictation(): void;
	toggleRecorder(): void;
	isRecorderOpen(): boolean;
	toggleRuler(): void;
	isRulerVisible(): boolean;
	addViewportBookmark(): void;
	getViewportBookmarks(): ViewportBookmark[];
	goToViewportBookmark(id: string): void;
	renameViewportBookmark(id: string, label: string): void;
	deleteViewportBookmark(id: string): void;
	getDocumentPages(): DocumentPage[];
	getActivePageId(): string;
	getPageTitle(id?: string): string;
	addDocumentPage(): void;
	goToDocumentPage(id: string): void;
	renameDocumentPage(id: string, title: string): void;
	deleteDocumentPage(id: string): void;
	toggleA4Guides(): void;
	getA4GuidesEnabled(): boolean;
	exportA4Pdf(): void;
	exportSharePackage(): void;
	importSharePackage(): void;
	translateText(): void;
	isTranslatorOpen(): boolean;
	addStickyNote(): void;
	zoomIn(): void;
	zoomOut(): void;
	getZoomPercent(): number;
	toggleFocusMode(): void;
	getFocusModeEnabled(): boolean;
	toggleMiniMap(): void;
	getMiniMapVisible(): boolean;
	toggleFullscreen(): void;
	isFullscreen(): boolean;
}

/** UI overlays must never let clicks fall through to the canvas. */
function shield(el: HTMLElement): void {
	el.addEventListener("pointerdown", (e) => e.stopPropagation());
	el.addEventListener("pointerup", (e) => e.stopPropagation());
	el.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
}

/** Accent-insensitive text used by the large-document navigator panels. */
export function normalizePanelSearch(value: string): string {
	return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

export function matchesPanelSearch(query: string, ...values: Array<string | number | undefined>): boolean {
	const needle = normalizePanelSearch(query);
	if (!needle) return true;
	const haystack = normalizePanelSearch(values.filter(value => value !== undefined).join(" "));
	return needle.split(/\s+/).every(term => haystack.includes(term));
}

/** Shared compact search field for pages, bookmarks and the tag summary. */
export function createPanelSearch(
	parent: HTMLElement,
	placeholder: string,
	initialValue: string,
	onChange: (query: string) => void
): { input: HTMLInputElement; clear: () => void; setCount: (visible: number, total: number) => void } {
	const row = parent.createDiv({ cls: "notelens-panel-search" });
	row.setAttr("role", "search");
	setIcon(row.createSpan({ cls: "notelens-panel-search-icon" }), "search");
	const input = row.createEl("input", { cls: "notelens-panel-search-input", type: "search" });
	input.placeholder = placeholder;
	input.value = initialValue;
	input.setAttr("aria-label", placeholder.replace("…", ""));
	input.setAttr("autocomplete", "off");
	input.setAttr("spellcheck", "false");
	const count = row.createSpan({ cls: "notelens-panel-search-count" });
	count.setAttr("aria-live", "polite");
	const clearButton = row.createEl("button", { cls: "notelens-panel-search-clear" });
	setIcon(clearButton, "x");
	clearButton.title = tr("Limpiar búsqueda");
	clearButton.setAttr("aria-label", "Limpiar búsqueda");

	const notify = () => {
		clearButton.toggleClass("hidden", !input.value);
		onChange(input.value);
	};
	const clear = () => {
		if (!input.value) return;
		input.value = "";
		notify();
		input.focus();
	};
	input.addEventListener("input", notify);
	input.addEventListener("keydown", event => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		if (input.value) clear(); else input.blur();
	});
	clearButton.addEventListener("pointerdown", event => event.preventDefault());
	clearButton.onclick = clear;
	clearButton.toggleClass("hidden", !input.value);

	return {
		input,
		clear,
		setCount: (visible, total) => {
			count.setText(normalizePanelSearch(input.value) ? `${visible}/${total}` : String(total));
			count.title = tr("{p0} de {p1} elementos visibles", { p0: visible, p1: total });
		}
	};
}

// ---------------------------------------------------------------------------
// Main toolbar
// ---------------------------------------------------------------------------

export function createToolbar(host: ToolbarHost, container: HTMLElement): void {
	const bar = container.createDiv({ cls: "onenote-ribbon-dock" });
	shield(bar);
	const toolButtons = new Map<ToolId, HTMLElement>();

	const tools: { id: ToolId; icon: string; title: string }[] = [
		{ id: "select", icon: "mouse-pointer-2", title: tr("Seleccionar (V) — arrastra para seleccionar en rectángulo") },
		{ id: "pen", icon: "pencil", title: tr("Lápiz (P) — opciones al pulsar de nuevo") },
		{ id: "highlighter", icon: "highlighter", title: tr("Subrayador (H) — opciones al pulsar de nuevo") },
		{ id: "eraser", icon: "eraser", title: tr("Borrador (E) — opciones al pulsar de nuevo") },
		{ id: "text", icon: "type", title: tr("Cuadro de texto (T) — opciones al pulsar de nuevo") },
		{ id: "shape", icon: "shapes", title: tr("Formas (S) — líneas, flechas, rectángulos y elipses") }
	];

	// Contextual options panel (created before the buttons reference it)
	const panel = createOptionsPanel(host, container, () => closePanel());
	let panelOpen = false;
	function openPanel(): void {
		panelOpen = true;
		panel.toggleClass("hidden", false);
		(panel as any).__refresh?.();
	}
	function closePanel(): void {
		panelOpen = false;
		panel.toggleClass("hidden", true);
	}

	for (const t of tools) {
		const btn = bar.createEl("button", {
			cls: `onenote-dock-btn ${host.currentTool === t.id ? "active" : ""}`
		});
		btn.setAttr("data-tool", t.id);
		setIcon(btn, t.icon);
		btn.title = t.title;
		btn.onclick = () => {
			const reopening = host.currentTool === t.id;
			const wasOpen = panelOpen;
			host.setTool(t.id);
			refreshActive();
			if (TOOLS_WITH_PANEL.includes(t.id)) {
				// Selecting a tool leaves the canvas clear; pressing it again shows its options.
				if (reopening) { if (wasOpen) closePanel(); else openPanel(); }
				else closePanel();
			} else {
				closePanel();
			}
		};
		toolButtons.set(t.id, btn);
	}

	function refreshActive(): void {
		bar.setAttr("data-active-tool", host.currentTool);
		for (const [id, btn] of toolButtons) {
			btn.toggleClass("active", id === host.currentTool);
		}
		const penBtn = toolButtons.get("pen");
		if (penBtn && penBtn.getAttr("data-nib") !== host.penStyle) {
			const nib = penStyleById(host.penStyle);
			penBtn.empty();
			setIcon(penBtn, nib.icon);
			penBtn.setAttr("data-nib", nib.id);
			penBtn.title = tr("{p0} (P) — opciones al pulsar de nuevo", { p0: nib.label });
		}
	}
	refreshActive();

	// Current color dot: opens the panel.
	bar.createDiv({ cls: "onenote-divider" });
	const colorDot = bar.createDiv({ cls: "onenote-color-dot onenote-current-color" });
	colorDot.title = tr("Color y opciones del lápiz");
	const syncDot = () => {
		colorDot.style.backgroundColor = host.currentTool === "highlighter"
			? host.highlighterColorHex
			: host.currentTool === "text"
				? host.textColor
				: host.penColorHex;
	};
	syncDot();
	colorDot.onclick = () => {
		if (panelOpen) closePanel();
		else { if (!TOOLS_WITH_PANEL.includes(host.currentTool)) host.setTool("pen"); refreshActive(); openPanel(); }
	};

	bar.createDiv({ cls: "onenote-divider" });

	const undoBtn = bar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(undoBtn, "undo-2");
	undoBtn.title = tr("Deshacer (Ctrl+Z)");
	undoBtn.onclick = () => host.undo();

	const redoBtn = bar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(redoBtn, "redo-2");
	redoBtn.title = tr("Rehacer (Ctrl+Shift+Z)");
	redoBtn.onclick = () => host.redo();

	const insertBar = container.createDiv({ cls: "notelens-insert-dock" });
	shield(insertBar);
	const pdfBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(pdfBtn, "file-text");
	pdfBtn.title = tr("Insertar PDF de la bóveda");
	pdfBtn.onclick = () => host.insertPdf();

	const videoBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(videoBtn, "play-circle");
	videoBtn.title = tr("Insertar vídeo: YouTube, TikTok, Instagram, X, Vimeo, Dailymotion, Loom… o un archivo de vídeo local");
	videoBtn.onclick = () => host.insertVideo();

	const imageBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(imageBtn, "image-plus");
	imageBtn.title = tr("Insertar imagen de la bóveda");
	imageBtn.onclick = () => host.insertImage();

	const stickyBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(stickyBtn, "sticky-note");
	stickyBtn.title = tr("Nueva nota adhesiva");
	stickyBtn.onclick = () => host.addStickyNote();

	const attachBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(attachBtn, "paperclip");
	attachBtn.title = tr("Adjuntar cualquier archivo de la bóveda");
	attachBtn.onclick = () => host.insertFile();

	const linkBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(linkBtn, "link");
	linkBtn.title = tr("Enlazar una nota o pizarra de la bóveda");
	linkBtn.onclick = () => host.insertLink();

	const uploadBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(uploadBtn, "upload");
	uploadBtn.title = tr("Subir archivo desde el dispositivo");
	uploadBtn.onclick = () => host.uploadFileFromDevice();

	const tableBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(tableBtn, "table-2");
	tableBtn.title = tr("Insertar tabla");
	tableBtn.onclick = () => host.insertTable();

	const codeBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(codeBtn, "code-2");
	codeBtn.title = tr("Insertar bloque de código");
	codeBtn.onclick = () => host.insertCodeBlock();

	const chartBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(chartBtn, "bar-chart-3");
	chartBtn.title = tr("Insertar gráfico: barras, líneas, circular, dispersión o función y = f(x)");
	chartBtn.onclick = () => host.insertChart();

	const mathBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(mathBtn, "sigma");
	mathBtn.title = tr("Insertar ecuación: escríbela a mano y se convierte sola, o teclea la notación. También vale $x^2$ dentro de cualquier texto");
	mathBtn.onclick = () => host.insertMathBlock();

	const recorderBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(recorderBtn, "mic");
	recorderBtn.title = tr("Grabar audio: se guarda como MP3 y se añade a la pizarra");
	recorderBtn.onclick = () => host.toggleRecorder();

	const translateBtn = insertBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(translateBtn, "languages");
	translateBtn.title = tr("Traducir texto");
	translateBtn.onclick = () => host.translateText();

	const documentBar = container.createDiv({ cls: "notelens-document-dock" });
	shield(documentBar);
	const rulerBtn = documentBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(rulerBtn, "ruler");
	rulerBtn.title = tr("Mostrar regla inteligente");
	rulerBtn.onclick = () => host.toggleRuler();

	const bookmarkBtn = documentBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(bookmarkBtn, "bookmark-plus");
	bookmarkBtn.title = tr("Guardar marcador de sección");
	bookmarkBtn.onclick = () => host.addViewportBookmark();

	const navBtn = documentBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(navBtn, "folder-tree");
	navBtn.title = tr("Navegar entre las pizarras y notas de la bóveda");
	navBtn.onclick = () => host.toggleNavigator();

	const calcBtn = documentBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(calcBtn, "calculator");
	calcBtn.title = tr("Calculadora científica");
	calcBtn.onclick = () => host.toggleCalculator();

	const a4Btn = documentBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(a4Btn, "file-stack");
	a4Btn.title = tr("Mostrar guías de página A4");
	a4Btn.onclick = () => host.toggleA4Guides();

	const exportBtn = documentBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(exportBtn, "file-down");
	exportBtn.title = tr("Exportar a PDF A4");
	exportBtn.onclick = () => host.exportA4Pdf();

	const shareBtn = documentBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(shareBtn, "share-2");
	shareBtn.title = tr("Exportar paquete editable de NoteLens");
	shareBtn.onclick = () => host.exportSharePackage();

	const importBtn = documentBar.createEl("button", { cls: "onenote-dock-btn" });
	setIcon(importBtn, "package-open");
	importBtn.title = tr("Importar paquete editable de NoteLens");
	importBtn.onclick = () => host.importSharePackage();

	(container as any).__refreshToolbar = () => {
		refreshActive();
		syncDot();
		rulerBtn.toggleClass("active", host.isRulerVisible());
		calcBtn.toggleClass("active", host.isCalculatorOpen());
		navBtn.toggleClass("active", host.isNavigatorOpen());
		recorderBtn.toggleClass("active", host.isRecorderOpen());
		translateBtn.toggleClass("active", host.isTranslatorOpen());
		a4Btn.toggleClass("active", host.getA4GuidesEnabled());
	};
	(container as any).__closePenPanel = () => closePanel();
}

/** Always-visible navigation, kept separate from drawing controls. */
export function createNavigationControls(host: ToolbarHost, container: HTMLElement): void {
	const controls = container.createDiv({ cls: "notelens-navigation-controls" });
	shield(controls);

	const zoomOut = controls.createEl("button", { cls: "notelens-nav-btn" });
	setIcon(zoomOut, "minus");
	zoomOut.title = tr("Alejar");
	zoomOut.onclick = () => host.zoomOut();

	const zoomLabel = controls.createEl("button", { cls: "notelens-zoom-label" });
	zoomLabel.title = tr("Restablecer zoom");
	zoomLabel.onclick = () => host.resetView();

	const zoomIn = controls.createEl("button", { cls: "notelens-nav-btn" });
	setIcon(zoomIn, "plus");
	zoomIn.title = tr("Acercar");
	zoomIn.onclick = () => host.zoomIn();

	const reset = controls.createEl("button", { cls: "notelens-nav-btn notelens-nav-reset" });
	setIcon(reset, "maximize");
	reset.title = tr("Restablecer vista");
	reset.onclick = () => host.resetView();

	const fit = controls.createEl("button", { cls: "notelens-nav-btn notelens-nav-fit" });
	setIcon(fit, "scan");
	fit.title = tr("Ajustar la vista a todo el contenido");
	fit.onclick = () => host.fitToContent();

	const map = controls.createEl("button", { cls: "notelens-nav-btn notelens-nav-map" });
	setIcon(map, "map");
	map.title = tr("Mostrar u ocultar el minimapa");
	map.onclick = () => host.toggleMiniMap();

	const full = controls.createEl("button", { cls: "notelens-nav-btn notelens-nav-fullscreen" });
	setIcon(full, "maximize-2");
	full.title = tr("Pizarra a pantalla completa (Esc para salir)");
	full.onclick = () => host.toggleFullscreen();

	const help = controls.createEl("button", { cls: "notelens-nav-btn notelens-nav-help" });
	setIcon(help, "keyboard");
	help.title = tr("Atajos de teclado");
	const shortcuts = createShortcutsPanel(container);
	help.onclick = () => { shortcuts.toggle(); help.toggleClass("active", shortcuts.isOpen()); };

	const refresh = () => {
		zoomLabel.setText(`${host.getZoomPercent()}%`);
		map.toggleClass("active", host.getMiniMapVisible());
		full.toggleClass("active", host.isFullscreen());
		full.empty();
		setIcon(full, host.isFullscreen() ? "minimize-2" : "maximize-2");
	};
	refresh();
	(container as any).__refreshNavigation = refresh;
}

/** Overlay listing every keyboard and mouse shortcut. */
function createShortcutsPanel(container: HTMLElement): { toggle: () => void; isOpen: () => boolean } {
	const panel = container.createDiv({ cls: "notelens-shortcuts hidden" });
	shield(panel);
	const header = panel.createDiv({ cls: "notelens-shortcuts-header" });
	header.createSpan({ text: tr("Atajos") });
	const closeBtn = header.createEl("button", { cls: "notelens-embed-close" });
	setIcon(closeBtn, "x");
	const groups: [string, [string, string][]][] = [
		["Herramientas", [["V", "Seleccionar"], ["L", "Lazo"], ["P", "Lápiz (pulsa de nuevo: bolígrafo, lápiz, pluma, rotulador, pincel)"], ["H", "Subrayador"], ["E", "Goma"], ["T", "Texto"], ["S", "Formas"]]],
		["Edición", [["Ctrl+Z / Ctrl+Y", "Deshacer / rehacer"], ["Ctrl+A", "Seleccionar todo"], ["Ctrl+D", "Duplicar selección"], ["Ctrl+C / X / V", "Copiar, cortar y pegar"], ["Supr", "Borrar selección"], ["Flechas", "Mover selección (Shift: ×10)"], ["Ctrl+F", "Buscar en la pizarra"]]],
		["Dibujo y texto", [["Shift + lápiz", "Línea recta"], ["Doble clic", "Nuevo cuadro de texto"], ["Doble clic en objeto", "Editar tabla, fórmula o gráfico"], ["Asa circular", "Girar la selección (Shift: 15°)"], ["Tab", "Indentar en el editor"], ["Ctrl+Enter / Esc", "Terminar de editar"], ["$…$", "Fórmula LaTeX en un texto"], ["```lang", "Convertir en bloque de código"]]],
		["Vista", [["Rueda", "Desplazar (Shift: horizontal)"], ["Ctrl + rueda", "Zoom"], ["Alt + arrastrar", "Mover la página"], ["Esc", "Cerrar paneles"]]]
	];
	const body = panel.createDiv({ cls: "notelens-shortcuts-body" });
	for (const [title, rows] of groups) {
		const group = body.createDiv({ cls: "notelens-shortcuts-group" });
		group.createDiv({ cls: "notelens-panel-label", text: title });
		for (const [keys, label] of rows) {
			const row = group.createDiv({ cls: "notelens-shortcut" });
			row.createEl("kbd", { text: keys });
			row.createSpan({ text: label });
		}
	}
	let open = false;
	const toggle = () => { open = !open; panel.toggleClass("hidden", !open); };
	closeBtn.onclick = toggle;
	return { toggle, isOpen: () => open };
}

/** Compact section navigator for saved camera positions. */
export function createBookmarksControl(host: ToolbarHost, container: HTMLElement): void {
	const dock = container.createDiv({ cls: "notelens-bookmarks-dock" });
	shield(dock);
	const toggle = dock.createEl("button", { cls: "notelens-bookmarks-toggle" });
	setIcon(toggle, "book-open-check");
	toggle.title = tr("Marcadores de sección");
	const panel = dock.createDiv({ cls: "notelens-bookmarks-panel hidden" });
	const panelHeader = panel.createDiv({ cls: "notelens-bookmarks-header" });
	panelHeader.createSpan({ text: tr("Marcadores") });
	const headerButtons = panelHeader.createDiv({ cls: "notelens-bookmarks-header-buttons" });
	const add = headerButtons.createEl("button", { cls: "notelens-table-control" });
	setIcon(add, "plus");
	add.title = tr("Guardar posición actual");
	let clearSearch = () => {};
	add.onclick = () => { clearSearch(); host.addViewportBookmark(); };
	const closeBookmarks = headerButtons.createEl("button", { cls: "notelens-embed-close" });
	setIcon(closeBookmarks, "x");
	closeBookmarks.title = tr("Cerrar");
	closeBookmarks.onclick = () => panel.addClass("hidden");
	let searchQuery = "";
	let refresh: (renameId?: string) => void = () => {};
	const search = createPanelSearch(panel, "Buscar marcadores…", searchQuery, query => {
		searchQuery = query;
		refresh();
	});
	clearSearch = search.clear;
	// Page filter: "todas" by default, or just one page of the notebook.
	let pageFilter: string | null = null;
	const pageFilterRow = panel.createDiv({ cls: "notelens-panel-page-filter" });
	const pageFilterSelect = pageFilterRow.createEl("select", { cls: "notelens-panel-page-select" });
	pageFilterSelect.title = tr("Mostrar solo los marcadores de una página");
	pageFilterSelect.onchange = () => {
		pageFilter = pageFilterSelect.value === "__all__" ? null : pageFilterSelect.value;
		refresh();
	};
	const renderPageFilter = () => {
		const pages = host.getDocumentPages();
		pageFilterRow.toggleClass("hidden", pages.length < 2);
		if (pages.length < 2) { pageFilter = null; return; }
		if (pageFilter && !pages.some(page => page.id === pageFilter)) pageFilter = null;
		pageFilterSelect.empty();
		pageFilterSelect.createEl("option", { value: "__all__", text: tr("Todas las páginas ({p0})", { p0: pages.length }) });
		for (const page of pages) {
			const counted = host.getViewportBookmarks().filter(b => (b.pageId ?? host.getActivePageId()) === page.id).length;
			pageFilterSelect.createEl("option", { value: page.id, text: tr("{p0} ({p1})", { p0: host.getPageTitle(page.id), p1: counted }) });
		}
		pageFilterSelect.value = pageFilter ?? "__all__";
	};
	const list = panel.createDiv({ cls: "notelens-bookmarks-list" });
	let cancelActiveRename: (() => void) | null = null;

	/** Turns a bookmark row into an inline name editor; Enter saves, Esc cancels. */
	const startRename = (item: HTMLElement, go: HTMLElement, bookmark: ViewportBookmark) => {
		const input = item.createEl("input", { cls: "notelens-bookmark-rename", type: "text", value: bookmark.label });
		item.addClass("is-renaming");
		go.hide();
		item.insertBefore(input, go);
		let done = false;
		const finish = (commit: boolean) => {
			if (done) return;
			done = true;
			cancelActiveRename = null;
			const label = input.value.trim();
			input.remove();
			item.removeClass("is-renaming");
			go.show();
			if (commit && label && label !== bookmark.label) host.renameViewportBookmark(bookmark.id, label);
		};
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") { event.preventDefault(); finish(true); }
			else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
			else event.stopPropagation();
		});
		input.addEventListener("blur", () => finish(true));
		input.addEventListener("pointerdown", (event) => event.stopPropagation());
		input.focus();
		input.select();
		cancelActiveRename = () => finish(false);
	};

	refresh = (renameId?: string) => {
		cancelActiveRename?.();
		if (renameId) (container as any).__closePages?.();
		list.empty();
		renderPageFilter();
		const allBookmarks = host.getViewportBookmarks();
		const bookmarks = allBookmarks
			.map((bookmark, index) => ({ bookmark, index }))
			.filter(({ bookmark }) => pageFilter === null || (bookmark.pageId ?? host.getActivePageId()) === pageFilter)
			.filter(({ bookmark, index }) => matchesPanelSearch(searchQuery, bookmark.label, host.getPageTitle(bookmark.pageId), index + 1));
		search.setCount(bookmarks.length, allBookmarks.length);
		if (allBookmarks.length === 0) {
			list.createDiv({ cls: "notelens-bookmarks-empty", text: tr("Sin marcadores. Pulsa + para guardar la vista actual.") });
			return;
		}
		if (bookmarks.length === 0) {
			list.createDiv({
				cls: "notelens-bookmarks-empty",
				text: pageFilter && !searchQuery
					? `Sin marcadores en ${host.getPageTitle(pageFilter)}.`
					: "No hay marcadores que coincidan con la búsqueda."
			});
			return;
		}
		bookmarks.forEach(({ bookmark, index }) => {
			const item = list.createDiv({ cls: "notelens-bookmark-item" });
			const go = item.createEl("button", { cls: "notelens-bookmark-go" });
			go.createSpan({ cls: "notelens-bookmark-index", text: `${index + 1}` });
			const copy = go.createSpan({ cls: "notelens-bookmark-copy" });
			copy.createSpan({ cls: "notelens-bookmark-label", text: bookmark.label });
			if (host.getDocumentPages().length > 1) copy.createSpan({ cls: "notelens-bookmark-page", text: host.getPageTitle(bookmark.pageId) });
			go.title = tr("Ir a {p0} (doble clic para renombrar)", { p0: bookmark.label });
			go.onclick = () => {
				host.goToViewportBookmark(bookmark.id);
				panel.addClass("hidden");
			};
			go.ondblclick = (event) => { event.preventDefault(); startRename(item, go, bookmark); };
			const rename = item.createEl("button", { cls: "notelens-table-control" });
			setIcon(rename, "pencil");
			rename.title = tr("Renombrar marcador");
			rename.onclick = () => startRename(item, go, bookmark);
			const remove = item.createEl("button", { cls: "notelens-table-control" });
			setIcon(remove, "x");
			remove.title = tr("Eliminar marcador");
			remove.onclick = () => host.deleteViewportBookmark(bookmark.id);
			if (renameId === bookmark.id) {
				panel.removeClass("hidden");
				startRename(item, go, bookmark);
			}
		});
	};

	toggle.onclick = () => {
		const opening = panel.hasClass("hidden");
		if (opening) (container as any).__closePages?.();
		panel.toggleClass("hidden", !opening);
	};
	// Capture phase: sibling docks stop pointerdown propagation, so a bubbling
	// listener never saw those clicks and two panels could overlap.
	container.addEventListener("pointerdown", (event) => {
		if (!panel.hasClass("hidden") && !panel.contains(event.target as Node) && !toggle.contains(event.target as Node)) {
			panel.addClass("hidden");
		}
	}, { capture: true });
	(container as any).__refreshBookmarks = refresh;
	(container as any).__closeBookmarks = () => panel.addClass("hidden");
	refresh();
}

/** Notebook page switcher. Every page is an independent infinite canvas. */
export function createPagesControl(host: ToolbarHost, container: HTMLElement): void {
	const dock = container.createDiv({ cls: "notelens-pages-dock" });
	shield(dock);
	const toggle = dock.createEl("button", { cls: "notelens-bookmarks-toggle notelens-pages-toggle" });
	setIcon(toggle, "files");
	toggle.title = tr("Páginas de la libreta");
	const count = toggle.createSpan({ cls: "notelens-pages-count" });

	const panel = dock.createDiv({ cls: "notelens-bookmarks-panel notelens-pages-panel hidden" });
	const header = panel.createDiv({ cls: "notelens-bookmarks-header" });
	header.createSpan({ text: tr("Páginas") });
	const actions = header.createDiv({ cls: "notelens-bookmarks-header-buttons" });
	const add = actions.createEl("button", { cls: "notelens-table-control" });
	setIcon(add, "file-plus-2");
	add.title = tr("Añadir página");
	let clearSearch = () => {};
	add.onclick = () => { clearSearch(); host.addDocumentPage(); };
	const close = actions.createEl("button", { cls: "notelens-embed-close" });
	setIcon(close, "x");
	close.title = tr("Cerrar");
	close.onclick = () => panel.addClass("hidden");
	let searchQuery = "";
	let refresh: (renameId?: string) => void = () => {};
	const search = createPanelSearch(panel, "Buscar páginas…", searchQuery, query => {
		searchQuery = query;
		refresh();
	});
	clearSearch = search.clear;
	const list = panel.createDiv({ cls: "notelens-bookmarks-list notelens-pages-list" });
	let cancelActiveRename: (() => void) | null = null;

	const startRename = (item: HTMLElement, go: HTMLElement, page: DocumentPage) => {
		if (item.hasClass("is-renaming")) return;
		const input = item.createEl("input", { cls: "notelens-bookmark-rename", type: "text", value: page.title });
		item.addClass("is-renaming");
		go.hide();
		item.insertBefore(input, go);
		let done = false;
		const finish = (commit: boolean) => {
			if (done) return;
			done = true;
			cancelActiveRename = null;
			const title = input.value.trim();
			input.remove();
			item.removeClass("is-renaming");
			go.show();
			if (commit && title && title !== page.title) host.renameDocumentPage(page.id, title);
		};
		input.addEventListener("keydown", event => {
			if (event.key === "Enter") { event.preventDefault(); finish(true); }
			else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
			else event.stopPropagation();
		});
		input.addEventListener("blur", () => finish(true));
		input.addEventListener("pointerdown", event => event.stopPropagation());
		input.focus();
		input.select();
		cancelActiveRename = () => finish(false);
	};

	refresh = (renameId?: string) => {
		cancelActiveRename?.();
		if (renameId) (container as any).__closeBookmarks?.();
		list.empty();
		const pages = host.getDocumentPages();
		const active = host.getActivePageId();
		count.setText(String(Math.max(1, pages.findIndex(page => page.id === active) + 1)));
		const visiblePages = pages
			.map((page, index) => ({ page, index }))
			.filter(({ page, index }) => matchesPanelSearch(searchQuery, page.title, index + 1, `Página ${index + 1}`));
		search.setCount(visiblePages.length, pages.length);
		if (visiblePages.length === 0) {
			list.createDiv({ cls: "notelens-bookmarks-empty", text: tr("No hay páginas que coincidan con la búsqueda.") });
			return;
		}
		for (const { page, index } of visiblePages) {
			const item = list.createDiv({ cls: "notelens-bookmark-item notelens-page-item" });
			item.toggleClass("active", page.id === active);
			const go = item.createEl("button", { cls: "notelens-bookmark-go" });
			go.createSpan({ cls: "notelens-page-thumbnail", text: String(index + 1) });
			const copy = go.createSpan({ cls: "notelens-bookmark-copy" });
			copy.createSpan({ cls: "notelens-bookmark-label", text: page.title });
			copy.createSpan({ cls: "notelens-bookmark-page", text: page.id === active ? tr("Página actual") : tr("Abrir página") });
			go.title = tr("Ir a {p0}", { p0: page.title });
			go.onclick = () => host.goToDocumentPage(page.id);
			go.ondblclick = event => { event.preventDefault(); startRename(item, go, page); };
			const rename = item.createEl("button", { cls: "notelens-table-control" });
			setIcon(rename, "pencil");
			rename.title = tr("Renombrar página");
			rename.onclick = () => startRename(item, go, page);
			const remove = item.createEl("button", { cls: "notelens-table-control notelens-page-remove" });
			setIcon(remove, "x");
			remove.title = pages.length === 1 ? tr("Debe quedar al menos una página") : tr("Eliminar página");
			remove.toggleClass("is-disabled", pages.length === 1);
			remove.onclick = () => { if (pages.length > 1) host.deleteDocumentPage(page.id); };
			if (renameId === page.id) {
				panel.removeClass("hidden");
				startRename(item, go, page);
			}
		}
	};

	toggle.onclick = () => {
		const opening = panel.hasClass("hidden");
		if (opening) (container as any).__closeBookmarks?.();
		panel.toggleClass("hidden", !opening);
	};
	container.addEventListener("pointerdown", event => {
		if (!panel.hasClass("hidden") && !panel.contains(event.target as Node) && !toggle.contains(event.target as Node)) panel.addClass("hidden");
	}, { capture: true });
	(container as any).__refreshPages = refresh;
	(container as any).__closePages = () => panel.addClass("hidden");
	refresh();
}

/** The one control left available while the canvas is deliberately cleared. */
export function createFocusModeControl(host: ToolbarHost, container: HTMLElement): void {
	const button = container.createEl("button", { cls: "notelens-focus-toggle" });
	shield(button);
	button.title = tr("Despejar la pantalla");
	button.onclick = () => host.toggleFocusMode();
	const refresh = () => {
		button.empty();
		setIcon(button, host.getFocusModeEnabled() ? "eye" : "eye-off");
		button.title = host.getFocusModeEnabled() ? tr("Mostrar controles") : tr("Despejar la pantalla");
		button.toggleClass("active", host.getFocusModeEnabled());
	};
	refresh();
	(container as any).__refreshFocusMode = refresh;
}

// ---------------------------------------------------------------------------
// Contextual options panel (pen / highlighter / eraser / text)
// Choosing an option closes the panel and gives priority back to the canvas.
// ---------------------------------------------------------------------------

function createOptionsPanel(host: ToolbarHost, container: HTMLElement, close: () => void): HTMLElement {
	const panel = container.createDiv({ cls: "notelens-pen-panel hidden" });
	shield(panel);
	const panelClose = panel.createEl("button", { cls: "notelens-panel-close" });
	setIcon(panelClose, "x");
	panelClose.title = tr("Cerrar (Esc)");
	panelClose.onclick = () => close();

	function createPanelHeader(section: HTMLElement, icon: string, title: string): void {
		const header = section.createDiv({ cls: "notelens-tool-panel-header" });
		const iconWrap = header.createDiv({ cls: "notelens-tool-panel-icon" });
		setIcon(iconWrap, icon);
		header.createDiv({ cls: "notelens-tool-heading", text: title });
	}

	// ============================ SELECT ====================================
	const selectSection = panel.createDiv({ cls: "notelens-panel-section notelens-panel-select" });
	createPanelHeader(selectSection, "mouse-pointer-2", "Selección");
	selectSection.createDiv({ cls: "notelens-panel-label", text: tr("Modo") });
	const selectModeRow = selectSection.createDiv({ cls: "notelens-eraser-modes" });
	const selectModeBtns: [HTMLElement, SelectionMode][] = [];
	for (const mode of [
		{ id: "rect" as SelectionMode, icon: "box-select", label: "Rectángulo" },
		{ id: "lasso" as SelectionMode, icon: "lasso", label: "Lazo (L)" }
	]) {
		const b = selectModeRow.createEl("button", { cls: "notelens-eraser-mode" });
		setIcon(b.createSpan({ cls: "notelens-mode-icon" }), mode.icon);
		b.createSpan({ text: mode.label });
		b.onclick = () => { host.setSelectionMode(mode.id); refresh(); close(); };
		selectModeBtns.push([b, mode.id]);
	}
	selectSection.createDiv({ cls: "notelens-panel-hint", text: tr("Arrastra sobre la tinta para seleccionarla. Doble clic en un hueco crea un cuadro de texto.") });

	// ============================ PEN =======================================
	const penSection = panel.createDiv({ cls: "notelens-panel-section notelens-panel-pen" });

	createPanelHeader(penSection, "pen-tool", "Bolígrafo");
	const penHeading = penSection.querySelector(".notelens-tool-heading") as HTMLElement;
	const penHeadingIcon = penSection.querySelector(".notelens-tool-panel-icon") as HTMLElement;

	// Live sample of the current nib, colour and width.
	const previewWrap = penSection.createDiv({ cls: "notelens-pen-preview" });
	const previewRenderer = new CanvasRenderer(previewWrap);
	const PREVIEW_W = 264, PREVIEW_H = 46;
	const renderPreview = () => {
		previewRenderer.resize(PREVIEW_W, PREVIEW_H);
		const pts: Stroke["points"] = [];
		const n = 46;
		for (let i = 0; i <= n; i++) {
			const t = i / n;
			// Slower (denser) in the middle, faster at the ends, with a pressure swell.
			const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
			const x = 14 + eased * (PREVIEW_W - 28);
			const y = PREVIEW_H / 2 + Math.sin(t * Math.PI * 2) * 11;
			pts.push({ x, y, p: 0.25 + 0.75 * Math.sin(t * Math.PI) });
		}
		const sample: Stroke = { id: "preview", type: "pen", color: host.strokeColor, width: Math.min(host.strokeWidth, 12), style: host.penStyle, points: pts };
		previewRenderer.renderAll([sample], [], { x: 0, y: 0, scale: 1 });
	};

	penSection.createDiv({ cls: "notelens-panel-label", text: tr("Tipo de trazo") });
	const nibRow = penSection.createDiv({ cls: "notelens-nib-grid" });
	const nibButtons: [HTMLElement, PenStyle][] = [];
	const nibHint = penSection.createDiv({ cls: "notelens-panel-hint notelens-nib-hint" });
	for (const nib of PEN_STYLES) {
		const b = nibRow.createEl("button", { cls: "notelens-nib" });
		setIcon(b.createSpan({ cls: "notelens-mode-icon" }), nib.icon);
		b.createSpan({ text: nib.label });
		b.title = nib.hint;
		b.onclick = () => { host.setPenStyle(nib.id); refresh(); };
		nibButtons.push([b, nib.id]);
	}

	penSection.createDiv({ cls: "notelens-panel-label", text: tr("Punta") });
	const widthRow = penSection.createDiv({ cls: "notelens-width-presets notelens-ink-widths" });
	const widthDots: [HTMLElement, number][] = [];
	for (const w of WIDTH_PRESETS) {
		const dot = widthRow.createDiv({ cls: "notelens-width-dot notelens-pen-width" });
		const inner = dot.createDiv();
		const size = Math.min(4 + w * 1.1, 18);
		inner.style.width = `${size}px`;
		inner.style.height = `${size}px`;
		dot.title = `${w}px`;
		dot.onclick = () => { host.setStrokeWidth(w); close(); };
		widthDots.push([dot, w]);
	}

	penSection.createDiv({ cls: "notelens-panel-label", text: tr("Opacidad") });
	const intensityRow = penSection.createDiv({ cls: "notelens-intensity-row" });
	const slider = intensityRow.createEl("input", { cls: "onenote-width-slider notelens-tool-slider" });
	slider.type = "range";
	slider.min = "0.05";
	slider.max = "1";
	slider.step = "0.05";
	slider.value = String(host.strokeIntensity);
	const penOpacityValue = intensityRow.createSpan({ cls: "notelens-opacity-value" });
	slider.oninput = () => {
		host.setStrokeIntensity(parseFloat(slider.value));
		penOpacityValue.setText(`${Math.round(host.strokeIntensity * 100)}%`);
		renderPreview();
	};

	penSection.createDiv({ cls: "notelens-panel-label", text: tr("Colores recientes") });
	const recentRow = penSection.createDiv({ cls: "notelens-color-grid" });

	penSection.createDiv({ cls: "notelens-panel-label", text: tr("Tinta") });
	const paletteGrid = penSection.createDiv({ cls: "notelens-color-grid" });
	for (const c of PALETTE_COLORS) addColorSwatch(paletteGrid, c);

	const customRow = penSection.createDiv({ cls: "notelens-custom-color" });
	const customIcon = customRow.createSpan({ cls: "notelens-mode-icon" });
	setIcon(customIcon, "pipette");
	customRow.createSpan({ text: tr(" Tinta personalizada...") });
	const colorInput = customRow.createEl("input");
	colorInput.type = "color";
	colorInput.value = host.penColorHex;
	colorInput.onchange = () => { host.setPenColor(colorInput.value); close(); };

	function addColorSwatch(parent: HTMLElement, c: string, onPick = (hex: string) => host.setPenColor(hex)): void {
		const sw = parent.createDiv({ cls: "notelens-color-swatch" });
		sw.style.backgroundColor = c;
		sw.title = c;
		sw.onclick = () => { onPick(c); close(); };
	}

	// ============================ HIGHLIGHTER ===============================
	const highlighterSection = panel.createDiv({ cls: "notelens-panel-section notelens-panel-highlighter" });

	createPanelHeader(highlighterSection, "highlighter", "Resaltador");
	highlighterSection.createDiv({ cls: "notelens-panel-label", text: tr("Trazo ancho") });
	const highlighterWidthRow = highlighterSection.createDiv({ cls: "notelens-width-presets notelens-marker-widths" });
	const highlighterDots: [HTMLElement, number][] = [];
	for (const w of HIGHLIGHTER_WIDTHS) {
		const dot = highlighterWidthRow.createDiv({ cls: "notelens-width-dot notelens-width-dot-marker" });
		const inner = dot.createDiv();
		inner.style.width = `${Math.min(8 + w * 0.35, 22)}px`;
		inner.style.height = `${Math.max(4, Math.min(8 + w * 0.12, 14))}px`;
		dot.title = `${w}px`;
		dot.onclick = () => { host.setStrokeWidth(w); close(); };
		highlighterDots.push([dot, w]);
	}

	highlighterSection.createDiv({ cls: "notelens-panel-label", text: tr("Opacidad") });
	const highlighterIntensityRow = highlighterSection.createDiv({ cls: "notelens-intensity-row" });
	const highlighterSlider = highlighterIntensityRow.createEl("input", { cls: "onenote-width-slider notelens-tool-slider" });
	highlighterSlider.type = "range";
	highlighterSlider.min = "0.1";
	highlighterSlider.max = "0.9";
	highlighterSlider.step = "0.05";
	highlighterSlider.value = String(host.highlighterIntensity);
	const highlighterOpacityValue = highlighterIntensityRow.createSpan({ cls: "notelens-opacity-value" });
	highlighterSlider.oninput = () => {
		host.setStrokeIntensity(parseFloat(highlighterSlider.value));
		highlighterOpacityValue.setText(`${Math.round(host.highlighterIntensity * 100)}%`);
	};

	highlighterSection.createDiv({ cls: "notelens-panel-label", text: tr("Color fluorescente") });
	const highlighterPalette = highlighterSection.createDiv({ cls: "notelens-color-grid" });
	for (const c of HIGHLIGHTER_COLORS) addColorSwatch(highlighterPalette, c, (hex) => host.setHighlighterColor(hex));

	const highlighterCustomRow = highlighterSection.createDiv({ cls: "notelens-custom-color" });
	setIcon(highlighterCustomRow.createSpan({ cls: "notelens-mode-icon" }), "pipette");
	highlighterCustomRow.createSpan({ text: tr(" Fluor personalizado...") });
	const highlighterColorInput = highlighterCustomRow.createEl("input");
	highlighterColorInput.type = "color";
	highlighterColorInput.value = host.highlighterColorHex;
	highlighterColorInput.onchange = () => { host.setHighlighterColor(highlighterColorInput.value); close(); };

	// ============================ ERASER ====================================
	const eraserSection = panel.createDiv({ cls: "notelens-panel-section notelens-panel-eraser" });
	createPanelHeader(eraserSection, "eraser", "Goma");
	eraserSection.createDiv({ cls: "notelens-panel-label", text: tr("Tamaño de la goma") });
	const eraserRow = eraserSection.createDiv({ cls: "notelens-eraser-sizes" });
	const eraserBtns: [HTMLElement, number][] = [];
	for (const s of ERASER_SIZES) {
		const b = eraserRow.createEl("button", { cls: "notelens-eraser-choice" });
		b.createSpan({ cls: "notelens-eraser-block" });
		b.createSpan({ cls: "notelens-eraser-size-label", text: s.label });
		b.title = tr("Goma {p0} ({p1}px)", { p0: s.label, p1: s.value });
		b.onclick = () => { host.setEraserSize(s.value); close(); };
		eraserBtns.push([b, s.value]);
	}
	eraserSection.createDiv({ cls: "notelens-panel-label", text: tr("Modo") });
	const eraserModeRow = eraserSection.createDiv({ cls: "notelens-eraser-modes" });
	const eraserModeBtns: [HTMLElement, EraserMode][] = [];
	for (const mode of [
		{ id: "stroke" as EraserMode, icon: "eraser", label: "Trazo entero" },
		{ id: "partial" as EraserMode, icon: "scissors", label: "Solo lo que tocas" }
	]) {
		const b = eraserModeRow.createEl("button", { cls: "notelens-eraser-mode" });
		setIcon(b.createSpan({ cls: "notelens-mode-icon" }), mode.icon);
		b.createSpan({ text: mode.label });
		b.onclick = () => { host.setEraserMode(mode.id); refresh(); };
		eraserModeBtns.push([b, mode.id]);
	}
	const eraserHint = eraserSection.createDiv({ cls: "notelens-panel-hint" });

	// ============================ TEXT ======================================
	const textSection = panel.createDiv({ cls: "notelens-panel-section notelens-panel-text" });
	createPanelHeader(textSection, "type", "Texto");
	textSection.createDiv({ cls: "notelens-panel-label", text: tr("Tamaño de texto") });
	const textRow = textSection.createDiv({ cls: "notelens-text-sizes" });
	const textBtns: [HTMLElement, number][] = [];
	for (const s of TEXT_SIZES) {
		const b = textRow.createEl("button", { cls: "notelens-text-size-choice" });
		b.createSpan({ text: tr("A") });
		b.style.setProperty("--text-preview-size", `${Math.max(12, Math.min(s, 25))}px`);
		b.title = `${s}px`;
		b.onclick = () => { host.setTextSize(s); close(); };
		textBtns.push([b, s]);
	}
	textSection.createDiv({ cls: "notelens-panel-label", text: tr("Tipografía") });
	const fontSelect = textSection.createEl("select", { cls: "notelens-font-select" });
	for (const font of FONT_OPTIONS) {
		const option = fontSelect.createEl("option", { text: font.label, value: font.id });
		option.style.fontFamily = font.css;
	}
	fontSelect.onchange = () => { host.setTextFont(fontSelect.value as CanvasFont); };
	textSection.createDiv({ cls: "notelens-panel-label", text: tr("Color de texto") });
	const textColorRow = textSection.createDiv({ cls: "notelens-color-grid" });
	for (const c of TEXT_COLORS) addColorSwatch(textColorRow, c, (hex) => host.setTextColor(hex));

	// ============================ SHAPES ====================================
	const shapeSection = panel.createDiv({ cls: "notelens-panel-section notelens-panel-shape" });
	createPanelHeader(shapeSection, "shapes", "Formas");
	shapeSection.createDiv({ cls: "notelens-panel-label", text: tr("Tipo de forma") });
	const shapeRow = shapeSection.createDiv({ cls: "notelens-shape-types" });
	const shapeButtons: [HTMLElement, ShapeKind][] = [];
	const shapes: { kind: ShapeKind; icon: string; title: string }[] = [
		{ kind: "line", icon: "minus", title: tr("Línea") },
		{ kind: "arrow", icon: "move-right", title: tr("Flecha") },
		{ kind: "rectangle", icon: "square", title: tr("Rectángulo") },
		{ kind: "rounded-rectangle", icon: "square-round-corner", title: tr("Rectángulo redondeado") },
		{ kind: "ellipse", icon: "circle", title: tr("Elipse") },
		{ kind: "diamond", icon: "diamond", title: tr("Rombo") },
		{ kind: "triangle", icon: "triangle", title: tr("Triángulo") },
		{ kind: "callout", icon: "message-square", title: tr("Llamada") }
	];
	for (const shape of shapes) {
		const b = shapeRow.createEl("button", { cls: "notelens-shape-choice" });
		setIcon(b, shape.icon);
		b.title = shape.title;
		b.onclick = () => { host.setShapeKind(shape.kind); close(); };
		shapeButtons.push([b, shape.kind]);
	}
	shapeSection.createDiv({ cls: "notelens-panel-label", text: tr("Grosor") });
	const shapeWidthRow = shapeSection.createDiv({ cls: "notelens-width-presets notelens-ink-widths" });
	const shapeWidthDots: [HTMLElement, number][] = [];
	for (const w of WIDTH_PRESETS.slice(0, 6)) {
		const dot = shapeWidthRow.createDiv({ cls: "notelens-width-dot notelens-pen-width" });
		const inner = dot.createDiv();
		const size = Math.min(4 + w * 1.25, 18);
		inner.style.width = `${size}px`;
		inner.style.height = `${size}px`;
		dot.title = `${w}px`;
		dot.onclick = () => { host.setStrokeWidth(w); close(); };
		shapeWidthDots.push([dot, w]);
	}
	shapeSection.createDiv({ cls: "notelens-panel-label", text: tr("Color del contorno") });
	const shapeColors = shapeSection.createDiv({ cls: "notelens-color-grid" });
	for (const c of PALETTE_COLORS) addColorSwatch(shapeColors, c);

	const fillToggleRow = shapeSection.createEl("label", { cls: "notelens-fill-toggle" });
	const fillToggle = fillToggleRow.createEl("input");
	fillToggle.type = "checkbox";
	fillToggle.checked = host.shapeFillEnabled;
	fillToggleRow.createSpan({ text: tr("Rellenar forma") });
	fillToggle.onchange = () => host.setShapeFillEnabled(fillToggle.checked);

	shapeSection.createDiv({ cls: "notelens-panel-label", text: tr("Color del relleno") });
	const fillColors = shapeSection.createDiv({ cls: "notelens-color-grid notelens-fill-color-grid" });
	for (const c of PALETTE_COLORS) addColorSwatch(fillColors, c, (hex) => host.setShapeFillColor(hex));

	shapeSection.createDiv({ cls: "notelens-panel-label", text: tr("Opacidad del relleno") });
	const fillOpacityRow = shapeSection.createDiv({ cls: "notelens-intensity-row" });
	const fillOpacity = fillOpacityRow.createEl("input", { cls: "onenote-width-slider notelens-tool-slider" });
	fillOpacity.type = "range";
	fillOpacity.min = "0";
	fillOpacity.max = "1";
	fillOpacity.step = "0.05";
	fillOpacity.value = String(host.shapeFillOpacity);
	const fillOpacityValue = fillOpacityRow.createSpan({ cls: "notelens-opacity-value" });
	fillOpacity.oninput = () => {
		host.setShapeFillOpacity(parseFloat(fillOpacity.value));
		fillOpacityValue.setText(`${Math.round(host.shapeFillOpacity * 100)}%`);
	};

	// ============================ refresh ===================================
	function refresh(): void {
		const tool = host.currentTool;
		panel.setAttr("data-tool", tool);
		selectSection.toggleClass("hidden", tool !== "select");
		for (const [b, mode] of selectModeBtns) b.toggleClass("active", host.selectionMode === mode);
		penSection.toggleClass("hidden", tool !== "pen");
		highlighterSection.toggleClass("hidden", tool !== "highlighter");
		eraserSection.toggleClass("hidden", tool !== "eraser");
		textSection.toggleClass("hidden", tool !== "text");
		shapeSection.toggleClass("hidden", tool !== "shape");

		for (const [dot, w] of widthDots) dot.toggleClass("active", Math.abs(host.strokeWidth - w) < 0.01);
		for (const [dot, w] of highlighterDots) dot.toggleClass("active", Math.abs(host.highlighterWidth - w) < 0.01);
		for (const [b, v] of eraserBtns) b.toggleClass("active", host.eraserSize === v);
		for (const [b, mode] of eraserModeBtns) b.toggleClass("active", host.eraserMode === mode);
		eraserHint.setText(host.eraserMode === "partial"
			? tr("Corta el trazo justo donde pasas la goma, como en OneNote.")
			: tr("Borra el trazo entero al tocarlo."));
		for (const [b, v] of textBtns) b.toggleClass("active", host.textSize === v);
		fontSelect.value = host.textFont;
		for (const [b, kind] of shapeButtons) b.toggleClass("active", host.shapeKind === kind);
		for (const [dot, w] of shapeWidthDots) dot.toggleClass("active", Math.abs(host.strokeWidth - w) < 0.01);
		fillToggle.checked = host.shapeFillEnabled;
		fillOpacity.value = String(host.shapeFillOpacity);
		fillOpacityValue.setText(`${Math.round(host.shapeFillOpacity * 100)}%`);
		fillColors.toggleClass("is-disabled", !host.shapeFillEnabled);
		fillOpacityRow.toggleClass("is-disabled", !host.shapeFillEnabled);
		slider.value = String(host.strokeIntensity);
		penOpacityValue.setText(`${Math.round(host.strokeIntensity * 100)}%`);
		colorInput.value = host.penColorHex;
		const nib = penStyleById(host.penStyle);
		penHeading.setText(nib.label);
		penHeadingIcon.empty();
		setIcon(penHeadingIcon, nib.icon);
		nibHint.setText(nib.hint);
		for (const [b, id] of nibButtons) b.toggleClass("active", id === host.penStyle);
		if (!panel.hasClass("hidden")) renderPreview();
		highlighterSlider.value = String(host.highlighterIntensity);
		highlighterOpacityValue.setText(`${Math.round(host.highlighterIntensity * 100)}%`);
		highlighterColorInput.value = host.highlighterColorHex;

		recentRow.empty();
		if (host.recentColors.length === 0) {
			recentRow.createDiv({ cls: "notelens-recent-empty", text: tr("Sin colores recientes") });
		} else {
			for (const c of host.recentColors) addColorSwatch(recentRow, c);
		}
	}

	(panel as any).__refresh = refresh;
	return panel;
}

// ---------------------------------------------------------------------------
// Quick tags bar
// ---------------------------------------------------------------------------

export function createQuickTagsBar(
	container: HTMLElement,
	onPick: (tag: QuickTag) => void,
	onSummary?: () => void
): void {
	const bar = container.createDiv({ cls: "onenote-quick-tags" });
	shield(bar);
	const chips = new Map<string, HTMLElement>();
	const setActive = (id: string | null) => {
		for (const [tagId, chip] of chips) chip.toggleClass("active", tagId === id);
	};
	for (const t of QUICK_TAGS) {
		const chip = bar.createEl("button", { cls: "onenote-tag-chip" });
		chip.setAttr("data-tag", t.id);
		chip.title = TAG_HINTS[t.id] ?? t.label;
		chip.style.setProperty("--tag-color", t.color);
		const iconEl = chip.createSpan({ cls: "onenote-tag-icon" });
		setIcon(iconEl, t.icon);
		chip.createSpan({ text: t.label });
		chip.onclick = () => {
			setActive(t.id);
			onPick(t);
		};
		chips.set(t.id, chip);
	}
	if (onSummary) {
		bar.createDiv({ cls: "onenote-divider" });
		const summary = bar.createEl("button", { cls: "onenote-tag-chip onenote-tag-summary" });
		setIcon(summary.createSpan({ cls: "onenote-tag-icon" }), "list-checks");
		summary.createSpan({ text: tr("Resumen") });
		summary.title = tr("Todas las etiquetas de la pizarra: tareas pendientes, dudas, ideas e importantes");
		summary.onclick = onSummary;
	}
	(container as any).__clearActiveTag = () => setActive(null);
}

// ---------------------------------------------------------------------------
// Settings panel (bottom-left)
// ---------------------------------------------------------------------------

export function createSettingsPanel(host: ToolbarHost, container: HTMLElement): void {
	const btn = container.createEl("button", { cls: "notelens-settings-btn" });
	setIcon(btn, "settings-2");
	btn.title = tr("Formato del fondo");
	shield(btn);

	const panel = container.createDiv({ cls: "notelens-settings-panel hidden" });
	shield(panel);

	const header = panel.createDiv({ cls: "notelens-settings-header" });
	header.createSpan({ text: tr("Formato del fondo") });
	const closeBtn = header.createEl("button", { cls: "notelens-embed-close" });
	setIcon(closeBtn, "x");
	closeBtn.onclick = () => panel.addClass("hidden");

	// --- Pattern ---
	panel.createDiv({ cls: "notelens-settings-label", text: tr("Estilo de página") });
	const bgRow = panel.createDiv({ cls: "notelens-settings-row notelens-settings-row-grid" });
	const activeBackground = host.background === "margin" ? "lines" : host.background;
	const bgButtons: [HTMLElement, BackgroundPattern][] = [];
	for (const opt of BG_OPTIONS) {
		const b = bgRow.createEl("button", {
			cls: `notelens-settings-choice ${activeBackground === opt.id ? "active" : ""}`
		});
		const iconEl = b.createSpan({ cls: "notelens-settings-choice-icon" });
		setIcon(iconEl, opt.icon);
		b.createSpan({ cls: "notelens-settings-choice-label", text: opt.label });
		b.title = opt.label;
		b.onclick = () => {
			host.setBackground(opt.id);
			bgRow.querySelectorAll(".notelens-settings-choice").forEach(c => c.removeClass("active"));
			b.addClass("active");
		};
		bgButtons.push([b, opt.id]);
	}

	// The board panel only styles the page; everything else lives in the plugin's
	// own settings tab, which is easy to miss.
	const openSettings = panel.createEl("button", { cls: "notelens-settings-link" });
	setIcon(openSettings.createSpan(), "settings-2");
	openSettings.createSpan({ text: tr("Ajustes del plugin") });
	openSettings.title = tr("Abre los ajustes de NoteLens en Obsidian");
	openSettings.onclick = () => host.openPluginSettings();

	const marginControl = panel.createEl("label", { cls: "notelens-settings-margin" });
	const marginIcon = marginControl.createSpan({ cls: "notelens-settings-margin-icon" });
	setIcon(marginIcon, "separator-vertical");
	const marginCopy = marginControl.createSpan({ cls: "notelens-settings-margin-copy" });
	marginCopy.createSpan({ cls: "notelens-settings-margin-title", text: tr("Margen izquierdo") });
	marginCopy.createSpan({ cls: "notelens-settings-margin-hint", text: tr("Independiente del estilo") });
	// A button, not a checkbox: Obsidian themes restyle checkboxes and the
	// switch came out looking broken in some of them.
	const marginToggle = marginControl.createEl("button", { cls: "notelens-settings-margin-toggle" });
	marginToggle.type = "button";
	marginToggle.setAttr("role", "switch");
	const syncMarginToggle = () => {
		marginToggle.toggleClass("is-on", host.marginEnabled);
		marginToggle.setAttr("aria-checked", host.marginEnabled ? "true" : "false");
		marginToggle.title = host.marginEnabled ? tr("Ocultar el margen izquierdo") : tr("Mostrar el margen izquierdo");
	};
	marginToggle.setAttr("aria-label", "Mostrar margen izquierdo");
	marginToggle.onclick = (event) => {
		event.preventDefault();
		host.setMarginEnabled(!host.marginEnabled);
		syncMarginToggle();
	};
	syncMarginToggle();
	(container as any).__refreshPaperSettings = () => {
		const current = host.background === "margin" ? "lines" : host.background;
		for (const [button, pattern] of bgButtons) button.toggleClass("active", pattern === current);
		syncMarginToggle();
	};

	// --- Grid size ---
	panel.createDiv({ cls: "notelens-settings-label", text: tr("Tamaño de cuadrícula") });
	const gridRow = panel.createDiv({ cls: "notelens-settings-row" });
	const gridButtons: [HTMLElement, GridSize][] = [];
	for (const opt of [{ id: "small" as GridSize, label: "Pequeña" }, { id: "medium" as GridSize, label: "Mediana" }, { id: "large" as GridSize, label: "Grande" }]) {
		const b = gridRow.createEl("button", { cls: "notelens-settings-choice" });
		b.createSpan({ cls: "notelens-settings-choice-label", text: opt.label });
		b.onclick = () => {
			host.setGridSize(opt.id);
			for (const [btn, id] of gridButtons) btn.toggleClass("active", id === opt.id);
		};
		gridButtons.push([b, opt.id]);
	}
	for (const [btn, id] of gridButtons) btn.toggleClass("active", id === host.gridSize);

	// --- Line color ---
	panel.createDiv({ cls: "notelens-settings-label", text: tr("Color de línea") });
	const lineRow = panel.createDiv({ cls: "notelens-color-grid" });
	for (const c of LINE_COLORS) {
		const sw = lineRow.createDiv({ cls: "notelens-color-swatch" });
		sw.style.backgroundColor = c;
		sw.title = c;
		if (c === host.lineColor) sw.addClass("active");
		sw.onclick = () => {
			host.setLineColor(c);
			lineRow.querySelectorAll(".notelens-color-swatch").forEach(s => s.removeClass("active"));
			sw.addClass("active");
		};
	}

	// --- Page color ---
	panel.createDiv({ cls: "notelens-settings-label", text: tr("Color de página") });
	const pageGrid = panel.createDiv({ cls: "notelens-color-grid" });
	for (const c of PAGE_COLORS) {
		const sw = pageGrid.createDiv({ cls: "notelens-color-swatch" });
		sw.style.backgroundColor = c;
		sw.title = c;
		if (c.toLowerCase() === host.backgroundColor.toLowerCase()) sw.addClass("active");
		sw.onclick = () => {
			host.setBackgroundColor(c);
			pageGrid.querySelectorAll(".notelens-color-swatch").forEach(s => s.removeClass("active"));
			sw.addClass("active");
		};
	}

	const customPage = panel.createDiv({ cls: "notelens-custom-color notelens-paper-custom" });
	setIcon(customPage.createSpan({ cls: "notelens-mode-icon" }), "palette");
	customPage.createSpan({ text: tr(" Color de página personalizado") });
	const customPageInput = customPage.createEl("input");
	customPageInput.type = "color";
	customPageInput.value = host.backgroundColor;
	customPageInput.onchange = () => {
		host.setBackgroundColor(customPageInput.value);
		pageGrid.querySelectorAll(".notelens-color-swatch").forEach(s => s.removeClass("active"));
	};

	// --- Actions ---
	panel.createDiv({ cls: "notelens-settings-sep" });
	const resetBtn = panel.createEl("button", { cls: "notelens-settings-action" });
	setIcon(resetBtn.createSpan(), "maximize");
	resetBtn.createSpan({ text: tr(" Restablecer vista") });
	resetBtn.onclick = () => {
		host.resetView();
		panel.addClass("hidden");
	};

	btn.onclick = (e) => {
		e.stopPropagation();
		panel.toggleClass("hidden", !panel.hasClass("hidden"));
	};

	// Clicking anywhere else (canvas or another dock) closes the panel.
	container.addEventListener("pointerdown", (e) => {
		if (!panel.hasClass("hidden") && !panel.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node)) {
			panel.addClass("hidden");
		}
	}, { capture: true });
}
