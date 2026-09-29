import { App, Menu, Notice, TFile, setIcon } from "obsidian";
import { tr } from "./i18n";
import { clamp } from "./tools";
import {
	Align, FormatOp, OfficeKind, OfficeSession, TableAction, addPicture, addShape, addSlide, addTextBox, changeIndent, countWords, currentStyle,
	deleteSlide, documentOutline, duplicateShape, duplicateSlide, findText, focusParagraph, formatSelection, formatState, insertImage,
	insertPageBreak, insertTable, listKinds, moveSlide, openOffice, paintDocx, paintSlide, paragraphStyles, removeShape, reorderShape,
	TRANSITION_SPEEDS, TransitionDir, TransitionKind, SlideTransition, linkTarget, readTransition, setTransition, setAlignment, setParagraphStyle, setShapeFill, setShapeFrame, setSlideBackground, shapeElementFor, shapeInfoOf, slideLayouts, slideTitle,
	stepSize, tableEdit, tableInfo, toggleList
} from "./office";

/** What the editor needs from whatever holds it: a frame on a board, or a tab of its own. */
export interface OfficeHostApi {
	app: App;
	registerCleanup(fn: () => void): void;
	/** Opens the file in the app outside Obsidian. */
	openExternal(path: string): void;
	/** A frame grows over the whole board; a tab has no need to. Answers whether it did. */
	expand?(on: boolean): boolean;
	initialSlide?: number;
	slideChanged?(index: number): void;
	/** Asks the person for a picture of the vault. */
	pickImage?(done: (file: TFile) => void): void;
}

export interface OfficeEditor {
	save(): Promise<void>;
	dispose(): void;
	/** The file was changed by something else and nothing here is waiting to be saved, so it is safe to load it again. */
	externalChange(): boolean;
}

const SAVE_DELAY = 1800;
const THUMB_DELAY = 450;
const PAGE_DELAY = 240;
const SWATCHES = ["000000", "404040", "7F7F7F", "C00000", "ED7D31", "FFC000", "70AD47", "00B0F0", "2F5597", "7030A0", "FFFFFF"];
const HIGHLIGHTS = ["FFF176", "A5D6A7", "80DEEA", "F48FB1", "FFCC80", "CE93D8"];
const FILLS = ["2F6FB5", "2E7D6B", "ED7D31", "FFC000", "7030A0", "C00000", "1F3A5F", "404040", "FFFFFF"];
const BACKGROUNDS = ["FFFFFF", "F3F6FA", "FFF7E6", "EAF3EC", "FCEFEA", "1F2937", "12161C", "1F3A5F"];
const FONTS = ["Calibri", "Arial", "Times New Roman", "Georgia", "Cambria", "Verdana", "Segoe UI", "Trebuchet MS", "Courier New", "Comic Sans MS"];
const SHAPES: [string, string, string][] = [
	["rect", "square", "Rectángulo"], ["roundRect", "square", "Rectángulo redondeado"], ["ellipse", "circle", "Elipse"], ["triangle", "triangle", "Triángulo"],
	["diamond", "diamond", "Rombo"], ["hexagon", "hexagon", "Hexágono"], ["rightArrow", "arrow-right", "Flecha"], ["star5", "star", "Estrella"]
];
const TRANSITIONS: [TransitionKind, string][] = [["none", "Sin transición"], ["fade", "Desvanecer"], ["push", "Empujar"], ["cover", "Cubrir"], ["wipe", "Barrido"], ["zoom", "Zoom"], ["split", "Dividir"], ["dissolve", "Disolver"]];
const DIRECTIONS: [TransitionDir, string][] = [["l", "Desde la derecha"], ["r", "Desde la izquierda"], ["u", "Desde abajo"], ["d", "Desde arriba"]];
const NEXT_KEYS = ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"];
const PREV_KEYS = ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"];
const MIN_EMU = 180000;

type Status = "saved" | "editing" | "error";

/** Mounts a Word or PowerPoint editor into an element and keeps the file saved. */
export async function mountOfficeEditor(root: HTMLElement, host: OfficeHostApi, file: TFile): Promise<OfficeEditor | null> {
	const kind: OfficeKind = file.extension.toLowerCase() === "pptx" ? "pptx" : "docx";
	root.empty();
	root.addClass("notelens-office-app", `is-${kind}`);
	const ribbon = root.createDiv({ cls: "notelens-office-ribbon" });
	const findBar = root.createDiv({ cls: "notelens-office-find hidden" });
	const body = root.createDiv({ cls: "notelens-embed-body notelens-office-body" });
	const side = body.createDiv({ cls: kind === "docx" ? "notelens-office-side is-outline" : "notelens-filmstrip" });
	const page = body.createDiv({ cls: "notelens-office-page" });
	page.tabIndex = -1;
	const statusbar = root.createDiv({ cls: "notelens-office-statusbar" });
	const pill = statusbar.createSpan({ cls: "notelens-office-status" });
	pill.createSpan({ cls: "notelens-office-dot-state" });
	const pillText = pill.createSpan();
	const statsOut = statusbar.createSpan({ cls: "notelens-office-stats" });
	const setStatus = (state: Status, text: string) => { pill.setAttr("data-state", state); pillText.setText(text); };
	page.createDiv({ cls: "notelens-epub-loading", text: tr("Abriendo el documento…") });
	const doc0 = root.ownerDocument;

	let session: OfficeSession;
	try {
		session = openOffice(await host.app.vault.readBinary(file), kind);
	} catch (e) {
		page.empty();
		page.createDiv({ cls: "notelens-embed-missing", text: e instanceof Error ? e.message : tr("No se pudo cargar: {p0}", { p0: file.path }) });
		ribbon.remove();
		side.remove();
		statusbar.remove();
		return null;
	}
	const doc = session;
	let loadedMtime = file.stat.mtime;
	let timer: number | null = null;
	let thumbTimer: number | null = null;
	let pageTimer: number | null = null;
	let saving = false;
	let disposed = false;
	let lastRange: Range | null = null;
	let lastEl: HTMLElement | null = null;
	setStatus("saved", tr("Guardado"));

	// ---- saving ----
	const save = async (): Promise<void> => {
		if (timer !== null) { window.clearTimeout(timer); timer = null; }
		if (!doc.hasChanges || saving) return;
		if (file.stat.mtime !== loadedMtime) {
			setStatus("error", tr("Sin guardar"));
			new Notice(tr("El archivo cambió fuera de la pizarra. Vuelve a colocarlo para no pisar esos cambios."));
			return;
		}
		saving = true;
		try {
			const bytes = doc.serialize();
			await host.app.vault.modifyBinary(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
			loadedMtime = file.stat.mtime;
			setStatus("saved", tr("Guardado"));
		} catch (e) {
			console.error("NoteLens: could not save the document", e);
			setStatus("error", tr("Sin guardar"));
			new Notice(tr("No se pudo guardar el documento."));
		} finally {
			saving = false;
		}
		// Something typed while the file was being written waits for its own turn.
		if (doc.hasChanges && !disposed) schedule();
	};
	const schedule = () => {
		setStatus("editing", tr("Editando…"));
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => void save(), SAVE_DELAY);
	};

	// ---- what is being edited ----
	const editable = (node: Node | null | undefined): HTMLElement | null => {
		const el = node?.instanceOf(HTMLElement) ? node : node?.parentElement ?? null;
		const found = el?.closest<HTMLElement>("[contenteditable='true']") ?? null;
		return found && page.contains(found) ? found : null;
	};
	const refreshers: (() => void)[] = [];
	const refresh = () => { for (const r of refreshers) r(); };
	const onSelection = () => {
		const selection = doc0.defaultView?.getSelection();
		if (selection?.rangeCount && page.contains(selection.anchorNode)) {
			lastRange = selection.getRangeAt(0).cloneRange();
			lastEl = editable(selection.anchorNode) ?? lastEl;
			refresh();
		}
	};
	doc0.addEventListener("selectionchange", onSelection);
	const target = (): HTMLElement | null => {
		const active = editable(doc0.activeElement);
		return active ?? (lastEl && page.contains(lastEl) ? lastEl : null);
	};
	const format = (op: FormatOp) => { const el = target(); if (el) formatSelection(doc, el, op, lastRange); };

	// ---- ribbon parts ----
	const group = () => ribbon.createDiv({ cls: "notelens-office-group" });
	const tool = (into: HTMLElement, icon: string, label: string, run: (e: MouseEvent) => void): HTMLButtonElement => {
		const btn = into.createEl("button", { cls: "notelens-office-btn" });
		setIcon(btn, icon);
		btn.title = label;
		btn.setAttr("aria-label", label);
		btn.addEventListener("pointerdown", (e) => e.stopPropagation());
		// The selection has to survive the tap, so the button never takes focus.
		btn.addEventListener("mousedown", (e) => e.preventDefault());
		btn.onclick = (e) => { e.stopPropagation(); run(e); };
		return btn;
	};
	const palettes: HTMLElement[] = [];
	const closePalettes = () => palettes.forEach(p => p.addClass("hidden"));
	const closeMenus = closePalettes;
	const onOutside = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".notelens-office-palette, .notelens-office-colors")) closePalettes(); };
	doc0.addEventListener("pointerdown", onOutside, true);
	/** A colour button with its swatches; returns the button so its bar can show the colour in use. */
	const colorTool = (into: HTMLElement, icon: string, label: string, swatches: string[], pick: (hex: string | null) => void, allowNone = false) => {
		const holder = into.createDiv({ cls: "notelens-office-colors" });
		// The swatches live in the editor, not in the ribbon, so a ribbon that scrolls does not cut them off.
		const palette = root.createDiv({ cls: "notelens-office-palette hidden" });
		palettes.push(palette);
		const btn = tool(holder, icon, label, () => {
			const open = palette.hasClass("hidden");
			closeMenus();
			if (!open) return;
			const scale = root.getBoundingClientRect().width / Math.max(1, root.offsetWidth);
			const at = btn.getBoundingClientRect(), box = root.getBoundingClientRect();
			palette.style.left = `${Math.max(4, Math.min((at.left - box.left) / scale, root.offsetWidth - 190))}px`;
			palette.style.top = `${(at.bottom - box.top) / scale + 4}px`;
			palette.removeClass("hidden");
		});
		const bar = btn.createSpan({ cls: "notelens-office-swatch" });
		for (const hex of swatches) {
			const dot = palette.createEl("button", { cls: "notelens-office-dot" });
			dot.style.background = `#${hex}`;
			dot.title = `#${hex}`;
			dot.addEventListener("pointerdown", (e) => e.stopPropagation());
			dot.addEventListener("mousedown", (e) => e.preventDefault());
			dot.onclick = (e) => { e.stopPropagation(); closePalettes(); pick(hex); };
		}
		if (allowNone) {
			const none = palette.createEl("button", { cls: "notelens-office-dot is-none" });
			none.title = tr("Sin color");
			none.addEventListener("pointerdown", (e) => e.stopPropagation());
			none.addEventListener("mousedown", (e) => e.preventDefault());
			none.onclick = (e) => { e.stopPropagation(); closePalettes(); pick(null); };
		}
		return { btn, bar };
	};
	const menuTool = (into: HTMLElement, icon: string, label: string, build: (menu: Menu) => void): HTMLButtonElement =>
		tool(into, icon, label, (e) => { const menu = new Menu(); build(menu); menu.showAtMouseEvent(e); });

	// undo and redo
	const history = group();
	const undoBtn = tool(history, "undo-2", tr("Deshacer (Ctrl+Z)"), () => undo());
	const redoBtn = tool(history, "redo-2", tr("Rehacer (Ctrl+Y)"), () => redo());
	const refreshHistory = () => { undoBtn.disabled = !doc.canUndo; redoBtn.disabled = !doc.canRedo; };
	let rebuildAfterHistory: () => void = () => { /* set per kind */ };
	const undo = () => { if (doc.undo()) { rebuildAfterHistory(); refreshHistory(); } };
	const redo = () => { if (doc.redo()) { rebuildAfterHistory(); refreshHistory(); } };

	let styleSelect: HTMLSelectElement | null = null;
	let picker: HTMLSelectElement | null = null;
	let prevBtn: HTMLButtonElement | null = null;
	let nextBtn: HTMLButtonElement | null = null;
	const typeface = group();
	if (kind === "docx") {
		const styles = paragraphStyles(doc);
		styleSelect = typeface.createEl("select", { cls: "notelens-office-select notelens-office-style" });
		styleSelect.title = tr("Estilo del párrafo");
		for (const style of styles) styleSelect.createEl("option", { value: style.id, text: style.name });
		if (!styles.length) styleSelect.disabled = true;
		styleSelect.addEventListener("pointerdown", (e) => e.stopPropagation());
		styleSelect.onchange = () => { const el = target(); if (el && styleSelect) setParagraphStyle(doc, el, styleSelect.value); };
	} else {
		prevBtn = tool(typeface, "chevron-left", tr("Diapositiva anterior"), () => { /* set below */ });
		picker = typeface.createEl("select", { cls: "notelens-office-select notelens-epub-chapters" });
		picker.addEventListener("pointerdown", (e) => e.stopPropagation());
		nextBtn = tool(typeface, "chevron-right", tr("Diapositiva siguiente"), () => { /* set below */ });
	}

	const fontGroup = group();
	const fontSelect = fontGroup.createEl("select", { cls: "notelens-office-select notelens-office-font" });
	fontSelect.title = tr("Fuente");
	fontSelect.createEl("option", { value: "", text: tr("Fuente") });
	for (const name of FONTS) fontSelect.createEl("option", { value: name, text: name });
	fontSelect.addEventListener("pointerdown", (e) => e.stopPropagation());
	fontSelect.onchange = () => { if (fontSelect.value) format({ kind: "font", name: fontSelect.value }); fontSelect.value = ""; };
	const bump = (direction: 1 | -1) => {
		const el = target();
		if (el) format({ kind: "size", pt: stepSize(formatState(doc, el, lastRange).pt || 12, direction) });
	};
	tool(fontGroup, "minus", tr("Reducir tamaño de letra"), () => bump(-1));
	const sizeOut = fontGroup.createSpan({ cls: "notelens-office-size", text: "–" });
	tool(fontGroup, "plus", tr("Aumentar tamaño de letra"), () => bump(1));

	const marks = group();
	const flagButtons = new Map<string, HTMLElement>();
	for (const [icon, tag, label] of [["bold", "b", tr("Negrita")], ["italic", "i", tr("Cursiva")], ["underline", "u", tr("Subrayado")]] as const) {
		flagButtons.set(tag, tool(marks, icon, label, () => format({ kind: "flag", tag })));
	}
	const textColor = colorTool(marks, "palette", tr("Color del texto"), SWATCHES, (hex) => { if (hex) format({ kind: "color", hex }); });
	colorTool(marks, "highlighter", tr("Resaltar texto"), HIGHLIGHTS, (hex) => format({ kind: "highlight", hex }), true);

	const aligns = group();
	const alignButtons = new Map<Align, HTMLElement>();
	for (const [icon, align, label] of [["align-left", "left", tr("Alinear a la izquierda")], ["align-center", "center", tr("Centrar")], ["align-right", "right", tr("Alinear a la derecha")], ["align-justify", "justify", tr("Justificar")]] as const) {
		alignButtons.set(align, tool(aligns, icon, label, () => { const el = target(); if (el) { setAlignment(doc, el, align); refresh(); } }));
	}
	tool(aligns, "outdent", tr("Reducir sangría"), () => { const el = target(); if (el) changeIndent(doc, el, -1); });
	tool(aligns, "indent", tr("Aumentar sangría"), () => { const el = target(); if (el) changeIndent(doc, el, 1); });

	refreshers.push(() => {
		const el = target();
		refreshHistory();
		if (!el) return;
		const state = formatState(doc, el, lastRange);
		for (const [tag, btn] of flagButtons) btn.toggleClass("is-on", state[tag as "b" | "i" | "u"]);
		for (const [align, btn] of alignButtons) btn.toggleClass("is-on", state.align === align);
		sizeOut.setText(state.pt ? String(state.pt) : "–");
		textColor.bar.style.background = state.color ? `#${state.color}` : "transparent";
		if (styleSelect) styleSelect.value = currentStyle(doc, el);
	});
	page.addEventListener("focusin", (e) => { lastEl = editable(e.target as Node) ?? lastEl; refresh(); });

	// ---- pictures: from the vault, pasted or dropped ----
	const imageKind = (blob: Blob): boolean => /^image\/(png|jpe?g|gif|bmp|webp|svg\+xml|avif)$/.test(blob.type);
	/** Word and PowerPoint take PNG, JPEG, GIF and BMP; anything else is redrawn as PNG. */
	const prepare = async (blob: Blob): Promise<{ data: Uint8Array; ext: string; w: number; h: number } | null> => {
		try {
			const bitmap = await createImageBitmap(blob);
			const keep = /^image\/(png|jpe?g|gif|bmp)$/.test(blob.type);
			let out = blob;
			if (!keep) {
				const canvas = createEl("canvas");
				canvas.width = bitmap.width;
				canvas.height = bitmap.height;
				canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
				const converted = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
				if (!converted) return null;
				out = converted;
			}
			const ext = out.type === "image/jpeg" ? "jpg" : out.type.split("/")[1] ?? "png";
			return { data: new Uint8Array(await out.arrayBuffer()), ext, w: bitmap.width, h: bitmap.height };
		} catch {
			return null;
		}
	};
	const addImage = async (blob: Blob) => {
		const ready = await prepare(blob);
		if (!ready) { new Notice(tr("No se pudo añadir la imagen.")); return; }
		if (kind === "docx") {
			const el = target();
			if (el) insertImage(doc, el, ready.data, ready.ext, { w: ready.w, h: ready.h });
			else new Notice(tr("Haz clic en el documento donde quieres la imagen."));
		} else {
			const node = addPicture(doc, current, ready.data, ready.ext, { w: ready.w, h: ready.h });
			if (node) { showSlide(current); selectNode(node); }
		}
	};
	const imageFromVault = () => {
		const mime = (ext: string) => (ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`);
		host.pickImage?.((picked) => {
			void host.app.vault.readBinary(picked).then(data => addImage(new Blob([data], { type: mime(picked.extension.toLowerCase()) })));
		});
	};
	const filesOf = (transfer: DataTransfer | null): Blob[] => Array.from(transfer?.files ?? []).filter(imageKind);
	page.addEventListener("paste", (e) => {
		const images = filesOf(e.clipboardData);
		if (!images.length) return;
		e.preventDefault();
		void addImage(images[0]);
	});
	// A link is opened with Ctrl (or Cmd) and a click; a plain click puts the caret in it.
	page.addEventListener("click", (e) => {
		if (!(e.ctrlKey || e.metaKey)) return;
		const link = (e.target as HTMLElement).closest<HTMLElement>("[data-link]")?.dataset.link;
		const url = link ? linkTarget(doc, link) : null;
		if (!url) return;
		e.preventDefault();
		window.open(url, "_blank", "noopener,noreferrer");
	});
	page.addEventListener("dragover", (e) => { if (filesOf(e.dataTransfer).length) e.preventDefault(); });
	page.addEventListener("drop", (e) => {
		const images = filesOf(e.dataTransfer);
		if (!images.length) return;
		e.preventDefault();
		e.stopPropagation();
		void addImage(images[0]);
	});

	let afterChange: (() => void) | null = null;
	doc.onChange = () => { schedule(); refreshHistory(); afterChange?.(); };
	const cleanups: (() => void)[] = [];
	let resizer: ResizeObserver | null = null;

	// ---- keys that belong to the editor ----
	root.addEventListener("keydown", (e) => {
		const mod = e.ctrlKey || e.metaKey;
		if (!mod) return;
		const key = e.key.toLowerCase();
		if (key === "z" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undo(); }
		else if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); redo(); }
		else if (key === "s") { e.preventDefault(); e.stopPropagation(); void save(); }
		else if (key === "f" && kind === "docx") { e.preventDefault(); e.stopPropagation(); openFind(); }
	}, true);

	// ---- Word ----
	let openFind: () => void = () => { /* docx only */ };
	let current = 0;
	let showSlide: (index: number, focus?: { node: Element; offset: number }) => void = () => { /* pptx only */ };
	let selectNode: (node: Element) => void = () => { /* pptx only */ };

	if (kind === "docx") {
		const lists = group();
		const kinds = listKinds(doc);
		tool(lists, "list", tr("Lista con viñetas"), () => { const el = target(); if (el) toggleList(doc, el, "bullet"); }).disabled = !kinds.bullet;
		tool(lists, "list-ordered", tr("Lista numerada"), () => { const el = target(); if (el) toggleList(doc, el, "decimal"); }).disabled = !kinds.decimal;

		const inserts = group();
		menuTool(inserts, "table-2", tr("Tabla"), (menu) => {
			const el = target();
			for (const [rows, cols] of [[2, 2], [3, 3], [4, 3], [5, 4]]) menu.addItem(item => item.setTitle(tr("Insertar tabla {p0}×{p1}", { p0: rows, p1: cols })).setIcon("table").onClick(() => { const at = target(); if (at) insertTable(doc, at, rows, cols); }));
			const info = el ? tableInfo(doc, el) : null;
			if (!info || !el) return;
			menu.addSeparator();
			const act = (title: string, icon: string, action: TableAction) => menu.addItem(item => item.setTitle(title).setIcon(icon).onClick(() => tableEdit(doc, el, action)));
			act(tr("Añadir fila encima"), "arrow-up-to-line", "rowBefore");
			act(tr("Añadir fila debajo"), "arrow-down-to-line", "rowAfter");
			act(tr("Añadir columna a la izquierda"), "arrow-left-to-line", "colBefore");
			act(tr("Añadir columna a la derecha"), "arrow-right-to-line", "colAfter");
			act(tr("Eliminar fila"), "trash-2", "deleteRow");
			act(tr("Eliminar columna"), "trash-2", "deleteCol");
			act(tr("Eliminar tabla"), "trash-2", "deleteTable");
		});
		tool(inserts, "image-plus", tr("Insertar imagen (también puedes pegarla)"), imageFromVault);
		tool(inserts, "separator-horizontal", tr("Insertar salto de página"), () => { const el = target(); if (el) insertPageBreak(doc, el); });

		const layout = paintDocx(doc, page);
		const sheet = page.createDiv({ cls: "notelens-office-sheet" });
		sheet.appendChild(layout.deck);
		let fit = true;
		let zoom = 1;
		const view = group();
		const zoomOut = view.createSpan({ cls: "notelens-office-size" });
		const apply = () => {
			if (fit) zoom = clamp((page.clientWidth - 48) / layout.naturalWidth, 0.3, 1.15);
			layout.deck.style.transform = `scale(${zoom})`;
			sheet.style.width = `${Math.round(layout.naturalWidth * zoom)}px`;
			sheet.style.height = `${Math.round(layout.deck.offsetHeight * zoom)}px`;
			zoomOut.setText(`${Math.round(zoom * 100)}%`);
		};
		view.prepend(tool(view, "zoom-out", tr("Alejar"), () => { fit = false; zoom = clamp(zoom - 0.1, 0.3, 2); apply(); }));
		tool(view, "zoom-in", tr("Acercar"), () => { fit = false; zoom = clamp(zoom + 0.1, 0.3, 2); apply(); });
		tool(view, "maximize-2", tr("Ajustar al ancho"), () => { fit = true; apply(); });
		tool(view, "search", tr("Buscar (Ctrl+F)"), () => openFind());
		tool(view, "panel-left", tr("Esquema del documento"), () => {
			if (body.clientWidth > 900) root.toggleClass("has-no-outline", !root.hasClass("has-no-outline"));
			else root.toggleClass("has-outline-open", !root.hasClass("has-outline-open"));
		});

		// outline of headings, words and pages
		const outline = side;
		const refreshOutline = () => {
			outline.empty();
			outline.createDiv({ cls: "notelens-office-side-title", text: tr("Esquema") });
			const entries = documentOutline(layout.deck);
			if (!entries.length) outline.createDiv({ cls: "notelens-office-side-empty", text: tr("Los títulos que escribas aparecerán aquí.") });
			for (const entry of entries) {
				const item = outline.createEl("button", { cls: `notelens-office-outline-item is-level-${Math.min(entry.level, 3)}`, text: entry.text });
				item.addEventListener("pointerdown", (e) => e.stopPropagation());
				item.onclick = (e) => { e.stopPropagation(); root.removeClass("has-outline-open"); entry.el.scrollIntoView({ block: "center", behavior: "smooth" }); entry.el.focus({ preventScroll: true }); };
			}
		};
		const refreshStats = () => {
			const words = countWords(layout.deck);
			statsOut.setText(`${tr("{p0} palabras", { p0: words })} · ${tr("{p0} págs.", { p0: layout.pageCount() })}`);
		};
		afterChange = () => {
			if (pageTimer !== null) window.clearTimeout(pageTimer);
			pageTimer = window.setTimeout(() => { pageTimer = null; layout.repaginate(); apply(); refreshOutline(); refreshStats(); }, PAGE_DELAY);
		};
		doc.onStructure = (focus) => { layout.repaint(focus); apply(); refreshOutline(); refreshStats(); };
		rebuildAfterHistory = () => { layout.repaint(); apply(); refreshOutline(); refreshStats(); };

		// find
		const input = findBar.createEl("input", { cls: "notelens-office-find-input", type: "text" });
		input.placeholder = tr("Buscar en el documento");
		const step = (backwards: boolean) => { if (!findText(layout.deck, input.value, backwards)) new Notice(tr("No se encontró.")); };
		tool(findBar, "chevron-up", tr("Anterior"), () => step(true));
		tool(findBar, "chevron-down", tr("Siguiente"), () => step(false));
		tool(findBar, "x", tr("Cerrar"), () => findBar.addClass("hidden"));
		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey); }
			else if (e.key === "Escape") { findBar.addClass("hidden"); target()?.focus(); }
		});
		openFind = () => { findBar.removeClass("hidden"); input.focus(); input.select(); };

		resizer = new ResizeObserver(apply);
		resizer.observe(page);
		resizer.observe(layout.deck);
		apply();
		refreshOutline();
		refreshStats();
		refreshHistory();
		return finish();
	}

	// ---- PowerPoint ----
	const slideGroup = group();
	menuTool(slideGroup, "plus-square", tr("Nueva diapositiva"), (menu) => {
		for (const layout of slideLayouts(doc)) menu.addItem(item => item.setTitle(layout.name).setIcon("layout-template").onClick(() => addAfter(layout.path)));
		if (!slideLayouts(doc).length) menu.addItem(item => item.setTitle(tr("Diapositiva en blanco")).onClick(() => addAfter()));
	});
	tool(slideGroup, "copy", tr("Duplicar diapositiva"), () => { const index = duplicateSlide(doc, current); if (index >= 0) { rebuildDeck(); showSlide(index); } });
	tool(slideGroup, "arrow-up", tr("Subir diapositiva"), () => { if (moveSlide(doc, current, current - 1)) { rebuildDeck(); showSlide(current - 1); } });
	tool(slideGroup, "arrow-down", tr("Bajar diapositiva"), () => { if (moveSlide(doc, current, current + 1)) { rebuildDeck(); showSlide(current + 1); } });
	colorTool(slideGroup, "paint-bucket", tr("Fondo de la diapositiva"), BACKGROUNDS, (hex) => { setSlideBackground(doc, current, hex); showSlide(current); refreshThumb(current); }, true);
	menuTool(slideGroup, "sparkles", tr("Transición"), (menu) => {
		const now = readTransition(doc, current);
		for (const [kind, name] of TRANSITIONS) {
			menu.addItem(item => item.setTitle(tr(name)).setChecked(now.kind === kind).onClick(() => applyTransition({ ...now, kind })));
		}
		if (now.kind === "push" || now.kind === "cover" || now.kind === "wipe") {
			menu.addSeparator();
			for (const [dir, name] of DIRECTIONS) menu.addItem(item => item.setTitle(tr(name)).setChecked(now.dir === dir).onClick(() => applyTransition({ ...now, dir })));
		}
		if (now.kind !== "none") {
			menu.addSeparator();
			for (const [name, ms] of TRANSITION_SPEEDS) menu.addItem(item => item.setTitle(tr(name)).setChecked(Math.abs(now.ms - ms) < 60).onClick(() => applyTransition({ ...now, ms })));
			menu.addSeparator();
			menu.addItem(item => item.setTitle(tr("Vista previa")).setIcon("play").onClick(() => previewTransition(now)));
			menu.addItem(item => item.setTitle(tr("Aplicar a todas las diapositivas")).setIcon("copy-check").onClick(() => { setTransition(doc, current, now, true); markTransitions(); }));
		}
	});
	let armed: number | null = null;
	const del = tool(slideGroup, "trash-2", tr("Eliminar diapositiva"), () => {
		if (armed === null) {
			del.addClass("is-armed");
			del.title = tr("Pulsa otra vez para eliminar");
			armed = window.setTimeout(() => { armed = null; del.removeClass("is-armed"); del.title = tr("Eliminar diapositiva"); }, 3000);
			return;
		}
		window.clearTimeout(armed);
		armed = null;
		del.removeClass("is-armed");
		del.title = tr("Eliminar diapositiva");
		const at = current;
		if (deleteSlide(doc, at)) { rebuildDeck(); showSlide(Math.min(at, doc.slides.length - 1)); }
		else new Notice(tr("Una presentación necesita al menos una diapositiva."));
	});

	const insert = group();
	tool(insert, "text-cursor-input", tr("Añadir cuadro de texto"), () => {
		const focus = addTextBox(doc, current);
		if (focus) { doc.commit(); showSlide(current, { node: focus, offset: 0 }); }
	});
	menuTool(insert, "shapes", tr("Formas"), (menu) => {
		for (const [geometry, icon, name] of SHAPES) menu.addItem(item => item.setTitle(tr(name)).setIcon(icon).onClick(() => { const node = addShape(doc, current, geometry); if (node) { showSlide(current); selectNode(node); } }));
	});
	tool(insert, "image-plus", tr("Insertar imagen (también puedes pegarla)"), imageFromVault);

	const object = group();
	const objectButtons: HTMLButtonElement[] = [];
	const fillTool = colorTool(object, "square", tr("Relleno de la forma"), FILLS, (hex) => { const el = selectedEl(); const node = selected; if (el && node) { setShapeFill(doc, el, hex); showSlide(current); selectNode(node); } }, true);
	objectButtons.push(fillTool.btn);
	objectButtons.push(tool(object, "copy-plus", tr("Duplicar objeto (Ctrl+D)"), () => duplicateObject()));
	objectButtons.push(tool(object, "bring-to-front", tr("Traer al frente"), () => { const el = selectedEl(); if (el) { reorderShape(doc, el, "front"); const n = selected; showSlide(current); if (n) selectNode(n); } }));
	objectButtons.push(tool(object, "send-to-back", tr("Enviar al fondo"), () => { const el = selectedEl(); if (el) { reorderShape(doc, el, "back"); const n = selected; showSlide(current); if (n) selectNode(n); } }));
	objectButtons.push(tool(object, "trash", tr("Eliminar objeto (Supr)"), () => deleteObject()));
	tool(group(), "play", tr("Presentar"), () => startPresenting());

	let thumbs: HTMLElement[] = [];
	let lazy: IntersectionObserver | null = null;
	current = clamp(host.initialSlide ?? 0, 0, doc.slides.length - 1);
	const paintThumb = (index: number) => {
		const holder = thumbs[index]?.querySelector<HTMLElement>(".notelens-thumb-slide");
		if (holder) paintSlide(doc, index, holder, true);
	};
	const refreshThumb = (index: number) => { doc.commit(); paintThumb(index); };
	const buildStrip = () => {
		lazy?.disconnect();
		side.empty();
		thumbs = [];
		lazy = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const index = thumbs.indexOf(entry.target as HTMLElement);
				if (index >= 0) paintThumb(index);
				lazy?.unobserve(entry.target);
			}
		}, { root: side });
		doc.slides.forEach((_, index) => {
			const thumb = side.createDiv({ cls: "notelens-thumb" });
			thumb.createSpan({ cls: "notelens-thumb-number", text: String(index + 1) });
			thumb.createDiv({ cls: "notelens-thumb-slide" });
			thumb.toggleClass("has-transition", readTransition(doc, index).kind !== "none");
			thumb.addEventListener("pointerdown", (e) => e.stopPropagation());
			thumb.onclick = (e) => { e.stopPropagation(); showSlide(index); };
			thumbs.push(thumb);
			lazy?.observe(thumb);
		});
		const add = side.createEl("button", { cls: "notelens-thumb-add" });
		setIcon(add, "plus");
		add.title = tr("Nueva diapositiva");
		add.addEventListener("pointerdown", (e) => e.stopPropagation());
		add.onclick = (e) => { e.stopPropagation(); addAfter(undefined, doc.slides.length - 1); };
	};
	const markTransitions = () => thumbs.forEach((thumb, i) => thumb.toggleClass("has-transition", readTransition(doc, i).kind !== "none"));
	const fillPicker = () => {
		if (!picker) return;
		picker.empty();
		doc.slides.forEach((_, index) => picker?.createEl("option", { value: String(index), text: `${index + 1}. ${slideTitle(doc, index)}` }));
	};
	const rebuildDeck = () => { buildStrip(); fillPicker(); };
	const addAfter = (layoutPath?: string, after = current) => {
		const index = addSlide(doc, after, layoutPath);
		if (index >= 0) { rebuildDeck(); showSlide(index); }
	};

	// -- objects on the slide: select, move, resize --
	let selected: Element | null = null;
	let overlay: HTMLElement | null = null;
	const selectedEl = (): HTMLElement | null => (selected ? shapeElementFor(selected) : null);
	const stageOf = () => page.querySelector<HTMLElement>(".notelens-slide");
	const emuPerPx = (): number => doc.slideW / Math.max(1, stageOf()?.getBoundingClientRect().width ?? 1);
	const percent = (el: HTMLElement, f: { x: number; y: number; cx: number; cy: number }) => {
		el.style.left = `${(f.x / doc.slideW) * 100}%`;
		el.style.top = `${(f.y / doc.slideH) * 100}%`;
		el.style.width = `${(f.cx / doc.slideW) * 100}%`;
		el.style.height = `${(f.cy / doc.slideH) * 100}%`;
	};
	const drawSelection = () => {
		overlay?.remove();
		overlay = null;
		const el = selectedEl();
		const info = shapeInfoOf(el);
		const stage = stageOf();
		for (const button of objectButtons) button.disabled = !info;
		if (!el || !info || !stage) return;
		overlay = stage.createDiv({ cls: "notelens-slide-selection" });
		percent(overlay, info.frame);
		const grip = overlay.createDiv({ cls: "notelens-slide-grip" });
		setIcon(grip, "grip-horizontal");
		for (const dir of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) overlay.createDiv({ cls: `notelens-slide-handle is-${dir}` }).dataset.dir = dir;
	};
	selectNode = (node: Element) => {
		selected = node;
		drawSelection();
		page.focus({ preventScroll: true });
	};
	const deselect = () => { selected = null; drawSelection(); };
	const deleteObject = () => {
		const el = selectedEl();
		if (!el) return;
		removeShape(doc, el);
		selected = null;
		showSlide(current);
	};
	const duplicateObject = () => {
		const el = selectedEl();
		if (!el) return;
		const copy = duplicateShape(doc, el);
		showSlide(current);
		if (copy) selectNode(copy);
	};

	const startDrag = (e: PointerEvent, mode: string) => {
		const el = selectedEl();
		const info = shapeInfoOf(el);
		if (!el || !info) return;
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX, startY = e.clientY;
		const origin = { ...info.frame };
		const scale = emuPerPx();
		const keepRatio = info.kind === "picture";
		let started = false;
		const move = (ev: PointerEvent) => {
			const dx = (ev.clientX - startX) * scale, dy = (ev.clientY - startY) * scale;
			if (!started) {
				if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
				started = true;
				doc.checkpoint();
			}
			const next = { ...origin };
			if (mode === "move") { next.x = origin.x + dx; next.y = origin.y + dy; }
			else {
				if (mode.includes("e")) next.cx = Math.max(MIN_EMU, origin.cx + dx);
				if (mode.includes("s")) next.cy = Math.max(MIN_EMU, origin.cy + dy);
				if (mode.includes("w")) { next.cx = Math.max(MIN_EMU, origin.cx - dx); next.x = origin.x + origin.cx - next.cx; }
				if (mode.includes("n")) { next.cy = Math.max(MIN_EMU, origin.cy - dy); next.y = origin.y + origin.cy - next.cy; }
				if (keepRatio && mode.length === 2) {
					const ratio = origin.cx / origin.cy;
					next.cy = next.cx / ratio;
					if (mode.includes("n")) next.y = origin.y + origin.cy - next.cy;
				}
			}
			percent(el, next);
			if (overlay) percent(overlay, next);
			info.frame = next;
		};
		const up = () => {
			doc0.removeEventListener("pointermove", move, true);
			doc0.removeEventListener("pointerup", up, true);
			if (started) setShapeFrame(doc, el, info.frame);
		};
		doc0.addEventListener("pointermove", move, true);
		doc0.addEventListener("pointerup", up, true);
	};
	page.addEventListener("pointerdown", (e) => {
		if (presenting) return;
		const t = e.target as HTMLElement;
		const handle = t.closest<HTMLElement>(".notelens-slide-handle");
		if (handle?.dataset.dir) { startDrag(e, handle.dataset.dir); return; }
		if (t.closest(".notelens-slide-grip")) { startDrag(e, "move"); return; }
		const shape = t.closest<HTMLElement>(".notelens-slide-shape.is-object, .notelens-slide-picture.is-object");
		const info = shapeInfoOf(shape);
		if (!shape || !info) { if (!t.closest(".notelens-slide-selection")) deselect(); return; }
		if (selectedEl() !== shape) { selected = info.node; drawSelection(); }
		if (!t.closest("[contenteditable='true']")) page.focus({ preventScroll: true });
		// A press on text is for the caret; a press on the shape itself, or on a picture, moves it.
		if (!t.closest("[contenteditable='true']")) startDrag(e, "move");
	});
	page.addEventListener("keydown", (e) => {
		if (presenting || !selected || editable(e.target as Node)) return;
		const el = selectedEl();
		const info = shapeInfoOf(el);
		if (!el || !info) return;
		if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopPropagation(); deleteObject(); }
		else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); deselect(); }
		else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); e.stopPropagation(); duplicateObject(); }
		else if (e.key.startsWith("Arrow")) {
			e.preventDefault();
			e.stopPropagation();
			doc.checkpoint();
			const step = (e.shiftKey ? 5 : 1) * emuPerPx() * 4;
			const next = { ...info.frame };
			if (e.key === "ArrowLeft") next.x -= step; else if (e.key === "ArrowRight") next.x += step;
			else if (e.key === "ArrowUp") next.y -= step; else next.y += step;
			setShapeFrame(doc, el, next);
			percent(el, next);
			if (overlay) percent(overlay, next);
		}
	});

	const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
	/** Plays a transition between the slide that was showing (a copy of it) and the one that is now. */
	const playTransition = (ghost: HTMLElement, fresh: HTMLElement, t: SlideTransition, forward: boolean) => {
		if (reducedMotion() || t.kind === "none") return;
		const pageBox = page.getBoundingClientRect(), box = fresh.getBoundingClientRect();
		ghost.style.cssText = `position:absolute;margin:0;pointer-events:none;z-index:5;left:${box.left - pageBox.left + page.scrollLeft}px;top:${box.top - pageBox.top + page.scrollTop}px;width:${box.width}px;height:${box.height}px;`;
		page.appendChild(ghost);
		fresh.addClass("is-transitioning");
		const flip: Record<TransitionDir, TransitionDir> = { l: "r", r: "l", u: "d", d: "u" };
		const dir = forward ? t.dir : flip[t.dir];
		const vec: Record<TransitionDir, [number, number]> = { l: [-100, 0], r: [100, 0], u: [0, -100], d: [0, 100] };
		const [vx, vy] = vec[dir];
		const opts: KeyframeAnimationOptions = { duration: t.ms, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "both" };
		const wipeFrom: Record<TransitionDir, string> = { l: "inset(0 0 0 100%)", r: "inset(0 100% 0 0)", u: "inset(100% 0 0 0)", d: "inset(0 0 100% 0)" };
		const runs: Animation[] = [];
		if (t.kind === "push") {
			runs.push(ghost.animate([{ transform: "none" }, { transform: `translate(${vx}%, ${vy}%)` }], opts));
			runs.push(fresh.animate([{ transform: `translate(${-vx}%, ${-vy}%)` }, { transform: "none" }], opts));
		} else if (t.kind === "cover") {
			runs.push(fresh.animate([{ transform: `translate(${-vx}%, ${-vy}%)` }, { transform: "none" }], opts));
		} else if (t.kind === "wipe") {
			runs.push(fresh.animate([{ clipPath: wipeFrom[dir] }, { clipPath: "inset(0 0 0 0)" }], opts));
		} else if (t.kind === "split") {
			runs.push(fresh.animate([{ clipPath: "inset(0 50% 0 50%)" }, { clipPath: "inset(0 0 0 0)" }], opts));
		} else if (t.kind === "zoom") {
			runs.push(fresh.animate([{ transform: "scale(0.55)", opacity: 0 }, { transform: "none", opacity: 1 }], opts));
			runs.push(ghost.animate([{ opacity: 1 }, { opacity: 0 }], opts));
		} else {
			runs.push(ghost.animate([{ opacity: 1 }, { opacity: 0 }], opts));
			runs.push(fresh.animate([{ opacity: 0 }, { opacity: 1 }], opts));
		}
		void Promise.all(runs.map(run => run.finished)).catch(() => undefined).finally(() => {
			ghost.remove();
			fresh.removeClass("is-transitioning");
			for (const run of runs) run.cancel();
		});
	};
	const applyTransition = (t: SlideTransition) => {
		setTransition(doc, current, t);
		markTransitions();
		previewTransition(t);
	};
	/** Shows what a transition does, from an empty screen onto the slide being edited. */
	const previewTransition = (t: SlideTransition) => {
		const fresh = page.querySelector<HTMLElement>(":scope > .notelens-slide");
		if (!fresh || t.kind === "none") return;
		const ghost = fresh.cloneNode(false) as HTMLElement;
		ghost.setCssProps({ background: "#0b0f1a" });
		playTransition(ghost, fresh, t, true);
	};
	/** Shows a slide. What was typed in the one being left is written to the file's XML first, or coming back would show it as it was. */
	showSlide = (index, focus) => {
		const leaving = current;
		// While presenting, the slide that is leaving is kept as a picture for the transition to play over.
		const outgoing = presenting && index !== current ? page.querySelector<HTMLElement>(":scope > .notelens-slide") : null;
		const ghost = outgoing ? outgoing.cloneNode(true) as HTMLElement : null;
		doc.commit();
		paintThumb(leaving);
		current = clamp(index, 0, doc.slides.length - 1);
		selected = null;
		paintSlide(doc, current, page);
		overlay = null;
		drawSelection();
		page.scrollTop = 0;
		if (picker) picker.value = String(current);
		if (prevBtn) prevBtn.disabled = current === 0;
		if (nextBtn) nextBtn.disabled = current === doc.slides.length - 1;
		thumbs.forEach((thumb, i) => thumb.toggleClass("is-current", i === current));
		paintThumb(current);
		thumbs[current]?.scrollIntoView({ block: "nearest" });
		lastEl = null;
		statsOut.setText(tr("Diapositiva {p0} de {p1}", { p0: current + 1, p1: doc.slides.length }));
		host.slideChanged?.(current);
		if (focus) focusParagraph(doc, focus.node, focus.offset);
		const fresh = page.querySelector<HTMLElement>(":scope > .notelens-slide");
		if (ghost && fresh) playTransition(ghost, fresh, readTransition(doc, current), current > leaving);
	};
	doc.onStructure = (focus) => showSlide(current, focus);
	rebuildAfterHistory = () => { rebuildDeck(); showSlide(clamp(current, 0, doc.slides.length - 1)); };
	afterChange = () => {
		if (thumbTimer !== null) window.clearTimeout(thumbTimer);
		thumbTimer = window.setTimeout(() => { thumbTimer = null; refreshThumb(current); }, THUMB_DELAY);
	};
	if (prevBtn && nextBtn && picker) {
		prevBtn.onclick = (e) => { e.stopPropagation(); showSlide(current - 1); };
		nextBtn.onclick = (e) => { e.stopPropagation(); showSlide(current + 1); };
		picker.onchange = () => showSlide(Number(picker?.value));
	}

	// -- presenting --
	let presenting = false;
	let onPresentKey: ((e: KeyboardEvent) => void) | null = null;
	let onFullscreen: (() => void) | null = null;
	let usedFullscreen = false;
	const stopPresenting = () => {
		if (!presenting) return;
		presenting = false;
		root.removeClass("is-presenting");
		root.querySelector(".notelens-present-exit")?.remove();
		if (onPresentKey) doc0.removeEventListener("keydown", onPresentKey, true);
		if (onFullscreen) doc0.removeEventListener("fullscreenchange", onFullscreen);
		onPresentKey = null;
		onFullscreen = null;
		page.onclick = null;
		if (usedFullscreen && doc0.fullscreenElement) void doc0.exitFullscreen();
		else host.expand?.(false);
		usedFullscreen = false;
	};
	const startPresenting = () => {
		if (host.expand) { if (!host.expand(true)) return; }
		else { usedFullscreen = true; void root.requestFullscreen?.(); }
		presenting = true;
		root.addClass("is-presenting");
		deselect();
		const exit = root.createEl("button", { cls: "notelens-present-exit" });
		setIcon(exit, "x");
		exit.title = tr("Salir de la presentación");
		exit.onclick = (e) => { e.stopPropagation(); stopPresenting(); };
		onPresentKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stopPresenting(); return; }
			if (NEXT_KEYS.includes(e.key)) { e.preventDefault(); e.stopPropagation(); showSlide(current + 1); }
			else if (PREV_KEYS.includes(e.key)) { e.preventDefault(); e.stopPropagation(); showSlide(current - 1); }
		};
		doc0.addEventListener("keydown", onPresentKey, true);
		if (usedFullscreen) {
			onFullscreen = () => { if (!doc0.fullscreenElement) { usedFullscreen = false; stopPresenting(); } };
			doc0.addEventListener("fullscreenchange", onFullscreen);
		}
		page.onclick = () => { if (presenting) showSlide(current + 1); };
	};
	cleanups.push(() => { if (presenting) stopPresenting(); });

	rebuildDeck();
	showSlide(current);
	refreshHistory();
	return finish();

	function finish(): OfficeEditor {
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			void save();
			for (const fn of cleanups) fn();
			doc0.removeEventListener("selectionchange", onSelection);
			doc0.removeEventListener("pointerdown", onOutside, true);
			resizer?.disconnect();
			for (const t of [thumbTimer, pageTimer]) if (t !== null) window.clearTimeout(t);
			doc.release();
		};
		host.registerCleanup(dispose);
		return { save, dispose, externalChange: () => !saving && !doc.hasChanges && file.stat.mtime !== loadedMtime };
	}
}
