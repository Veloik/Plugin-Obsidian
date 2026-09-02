import { App, Modal, Notice, setIcon } from "obsidian";
import { BadgeChecklistItem, BadgeImage, genId } from "./types";
import { tr } from "./i18n";

export const HOVER_NOTE_BOARD_WIDTH = 560;
export const HOVER_NOTE_BOARD_HEIGHT = 320;

/** Everything saved by an Important, Question, Idea, Task or Floating Note badge. */
export interface HoverNoteContent {
	title: string;
	text: string;
	sketch?: string;
	images?: BadgeImage[];
	checklist?: BadgeChecklistItem[];
}

interface SketchStroke {
	color: string;
	width: number;
	points: { x: number; y: number }[];
}

type BoardAction =
	| { kind: "draw"; stroke: SketchStroke }
	| { kind: "move"; image: BadgeImage; px: number; py: number; x: number; y: number }
	| { kind: "resize"; image: BadgeImage; px: number; py: number; w: number; h: number };

const SKETCH_COLORS = ["#f8fafc", "#38bdf8", "#f472b6", "#facc15", "#4ade80", "#a78bfa"];
const MAX_IMAGE_SOURCE_EDGE = 1600;
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 12;

const bounded = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** Editor shared by all quick tags: title, text, drawing and pinned images. */
export class HoverNoteModal extends Modal {
	private noteTitle: string;
	private text: string;
	private sketch: string | undefined;
	private images: BadgeImage[];
	private checklist: BadgeChecklistItem[];
	private strokes: SketchStroke[] = [];
	private baseImage: HTMLImageElement | null = null;
	private loadedImages = new Map<string, HTMLImageElement>();
	private selectedImageId: string | null = null;
	private color = SKETCH_COLORS[0];
	private width = 3;
	private mode: "text" | "sketch";
	private boardTool: "draw" | "select" = "draw";

	constructor(
		app: App,
		private dialogTitle: string,
		initial: HoverNoteContent,
		private onSubmit: (content: HoverNoteContent | null) => void,
		private placeholder = "Escribe la nota que aparecerá al pasar el cursor por la etiqueta. Enter añade líneas; Ctrl+Enter acepta.",
		private taskMode = false
	) {
		super(app);
		this.noteTitle = initial.title?.trim() || dialogTitle;
		this.text = initial.text ?? "";
		this.sketch = initial.sketch;
		this.images = (initial.images ?? []).map(image => ({ ...image }));
		this.checklist = (initial.checklist ?? []).map(item => ({ ...item }));
		this.mode = (this.sketch || this.images.length) && !this.text.trim() && !this.checklist.length ? "sketch" : "text";
	}

	override onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass("notelens-hover-note-modal");
		contentEl.empty();
		contentEl.addClass("notelens-hover-note");
		contentEl.createEl("h3", { text: this.dialogTitle });

		const titleField = contentEl.createEl("label", { cls: "notelens-hover-note-title-field" });
		titleField.createSpan({ text: tr("Título") });
		const titleInput = titleField.createEl("input", { cls: "notelens-hover-note-title-input", type: "text" });
		titleInput.value = this.noteTitle;
		titleInput.maxLength = 120;
		titleInput.placeholder = "Título de la etiqueta";
		titleInput.addEventListener("input", () => { this.noteTitle = titleInput.value; });

		const tabs = contentEl.createDiv({ cls: "notelens-hover-note-tabs" });
		const tabText = tabs.createEl("button", { cls: "notelens-hover-note-tab", type: "button" });
		setIcon(tabText.createSpan(), this.taskMode ? "list-checks" : "type");
		tabText.createSpan({ text: this.taskMode ? "Lista" : "Nota" });
		const tabSketch = tabs.createEl("button", { cls: "notelens-hover-note-tab", type: "button" });
		setIcon(tabSketch.createSpan(), "pen-tool");
		tabSketch.createSpan({ text: tr("Pizarra") });

		const textPane = contentEl.createDiv({ cls: `notelens-hover-note-pane ${this.taskMode ? "is-task" : ""}` });
		let checklistList: HTMLElement | null = null;
		let checklistProgress: HTMLElement | null = null;
		const updateChecklistProgress = () => {
			if (!checklistProgress) return;
			const items = this.checklist.filter(item => item.text.trim() || item.sketch);
			const completed = items.filter(item => item.done).length;
			checklistProgress.setText(items.length ? `${completed}/${items.length} completados` : "Sin pasos todavía");
		};
		let renderChecklist: (focusId?: string) => void = () => {};
		const addChecklistItem = (afterIndex = this.checklist.length - 1) => {
			const item: BadgeChecklistItem = { id: genId("task_item"), text: "", done: false };
			this.checklist.splice(Math.max(0, afterIndex + 1), 0, item);
			renderChecklist(item.id);
		};
		renderChecklist = (focusId?: string) => {
			if (!checklistList) return;
			checklistList.empty();
			for (const [index, item] of this.checklist.entries()) {
				const row = checklistList.createDiv({ cls: "notelens-task-checklist-row" });
				row.toggleClass("is-done", item.done);
				const checkbox = row.createEl("input", { cls: "notelens-task-checklist-box", type: "checkbox" });
				checkbox.checked = item.done;
				checkbox.setAttr("aria-label", `Marcar paso ${index + 1}`);
				const input = row.createEl("input", { cls: "notelens-task-checklist-input", type: "text" });
				input.value = item.text;
				input.maxLength = 500;
				input.placeholder = `Paso ${index + 1}`;
				// Pen-only users write the step by hand instead of typing it.
				const pad = row.createDiv({ cls: "notelens-task-checklist-pad" });
				const padCanvas = pad.createEl("canvas");
				const padHint = pad.createDiv({ cls: "notelens-task-checklist-pad-hint", text: tr("Escribe el paso {p0} a mano", { p0: index + 1 }) });
				const padClear = pad.createEl("button", { cls: "notelens-task-checklist-pad-clear", type: "button" });
				setIcon(padClear, "eraser");
				padClear.title = "Borrar lo escrito a mano";
				const handwriting = new StepPad(padCanvas, item.sketch, (data) => {
					item.sketch = data;
					padHint.toggleClass("hidden-hint", !!data);
					updateChecklistProgress();
				});
				padClear.onclick = () => handwriting.clear();
				const modeBtn = row.createEl("button", { cls: "notelens-task-checklist-mode", type: "button" });
				const applyStepMode = (drawn: boolean) => {
					row.toggleClass("is-drawn", drawn);
					input.style.display = drawn ? "none" : "";
					pad.style.display = drawn ? "" : "none";
					modeBtn.empty();
					setIcon(modeBtn, drawn ? "type" : "pen-line");
					modeBtn.title = drawn ? "Escribir este paso con el teclado" : "Escribir este paso a mano";
					if (drawn) handwriting.redraw();
				};
				modeBtn.onclick = () => {
					const drawn = !row.hasClass("is-drawn");
					if (!drawn) { handwriting.clear(); item.sketch = undefined; }
					applyStepMode(drawn);
					if (!drawn) requestAnimationFrame(() => input.focus());
					updateChecklistProgress();
				};
				applyStepMode(!!item.sketch);
				const remove = row.createEl("button", { cls: "notelens-task-checklist-remove", type: "button" });
				setIcon(remove, "x");
				remove.title = "Eliminar paso";
				checkbox.onchange = () => {
					item.done = checkbox.checked;
					row.toggleClass("is-done", item.done);
					updateChecklistProgress();
				};
				input.addEventListener("input", () => { item.text = input.value; updateChecklistProgress(); });
				input.addEventListener("keydown", (event) => {
					if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(); return; }
					if (event.key === "Enter") { event.preventDefault(); addChecklistItem(index); }
					else if (event.key === "Backspace" && !input.value && this.checklist.length > 1) {
						event.preventDefault();
						const next = this.checklist[index - 1]?.id ?? this.checklist[index + 1]?.id;
						this.checklist.splice(index, 1);
						renderChecklist(next);
					}
				});
				remove.onclick = () => {
					const next = this.checklist[index + 1]?.id ?? this.checklist[index - 1]?.id;
					this.checklist.splice(index, 1);
					if (!this.checklist.length) this.checklist.push({ id: genId("task_item"), text: "", done: false });
					renderChecklist(next ?? this.checklist[0].id);
				};
				if (item.id === focusId) requestAnimationFrame(() => input.focus());
			}
			updateChecklistProgress();
		};

		if (this.taskMode) {
			const checklistHeader = textPane.createDiv({ cls: "notelens-task-checklist-header" });
			const checklistHeading = checklistHeader.createDiv({ cls: "notelens-task-checklist-heading" });
			checklistHeading.createSpan({ text: tr("Pasos de la tarea") });
			checklistProgress = checklistHeading.createSpan({ cls: "notelens-task-checklist-progress" });
			const addItem = checklistHeader.createEl("button", { cls: "notelens-task-checklist-add", type: "button" });
			setIcon(addItem, "plus");
			addItem.createSpan({ text: tr("Añadir paso") });
			addItem.onclick = () => addChecklistItem();
			checklistList = textPane.createDiv({ cls: "notelens-task-checklist" });
			if (!this.checklist.length) this.checklist.push({ id: genId("task_item"), text: "", done: false });
			renderChecklist();
			textPane.createDiv({ cls: "notelens-task-description-label", text: tr("Notas de la tarea") });
		}

		const area = textPane.createEl("textarea", { cls: `notelens-prompt-textarea ${this.taskMode ? "notelens-task-description" : ""}` });
		area.value = this.text;
		area.placeholder = this.taskMode ? "Descripción, fecha, enlaces o detalles opcionales…" : this.placeholder;
		area.rows = this.taskMode ? 3 : 7;
		area.addEventListener("input", () => { this.text = area.value; });
		area.addEventListener("keydown", (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(); }
		});

		const sketchPane = contentEl.createDiv({ cls: "notelens-hover-note-pane" });
		const toolbar = sketchPane.createDiv({ cls: "notelens-hover-note-tools" });
		const drawBtn = toolbar.createEl("button", { cls: "notelens-hover-note-tool", type: "button" });
		setIcon(drawBtn, "pen-line");
		drawBtn.title = "Dibujar sobre la pizarra";
		const selectBtn = toolbar.createEl("button", { cls: "notelens-hover-note-tool", type: "button" });
		setIcon(selectBtn, "mouse-pointer-2");
		selectBtn.title = "Mover o redimensionar imágenes";
		toolbar.createDiv({ cls: "onenote-divider" });

		const swatches: HTMLElement[] = [];
		for (const color of SKETCH_COLORS) {
			const swatch = toolbar.createEl("button", { cls: "notelens-hover-note-swatch", type: "button" });
			swatch.style.backgroundColor = color;
			swatch.title = `Tinta ${color}`;
			swatch.onclick = () => { this.color = color; selectTool("draw"); };
			swatches.push(swatch);
		}
		toolbar.createDiv({ cls: "onenote-divider" });
		const widths: [HTMLElement, number][] = [];
		for (const width of [2, 4, 8]) {
			const button = toolbar.createEl("button", { cls: "notelens-hover-note-width", type: "button" });
			const dot = button.createDiv();
			dot.style.width = `${4 + width * 1.4}px`;
			dot.style.height = `${4 + width * 1.4}px`;
			button.title = `${width}px`;
			button.onclick = () => { this.width = width; selectTool("draw"); };
			widths.push([button, width]);
		}
		toolbar.createDiv({ cls: "onenote-divider" });
		const uploadBtn = toolbar.createEl("button", { cls: "notelens-hover-note-tool notelens-hover-note-upload", type: "button" });
		setIcon(uploadBtn, "image-plus");
		uploadBtn.title = "Subir imágenes desde el dispositivo";
		const pasteBtn = toolbar.createEl("button", { cls: "notelens-hover-note-tool", type: "button" });
		setIcon(pasteBtn, "clipboard-paste");
		pasteBtn.title = "Pegar imagen del portapapeles";
		const imageInput = sketchPane.createEl("input", { cls: "notelens-hover-note-file", type: "file" });
		imageInput.accept = "image/*";
		imageInput.multiple = true;
		const deleteImageBtn = toolbar.createEl("button", { cls: "notelens-hover-note-tool", type: "button" });
		setIcon(deleteImageBtn, "trash-2");
		deleteImageBtn.title = "Quitar la imagen seleccionada";
		const undoBtn = toolbar.createEl("button", { cls: "notelens-hover-note-tool", type: "button" });
		setIcon(undoBtn, "undo-2");
		undoBtn.title = "Deshacer el último trazo";
		const clearBtn = toolbar.createEl("button", { cls: "notelens-hover-note-tool", type: "button" });
		setIcon(clearBtn, "eraser");
		clearBtn.title = "Borrar todos los trazos";

		const board = sketchPane.createDiv({ cls: "notelens-hover-note-board" });
		const canvas = board.createEl("canvas");
		canvas.tabIndex = 0;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = HOVER_NOTE_BOARD_WIDTH * dpr;
		canvas.height = HOVER_NOTE_BOARD_HEIGHT * dpr;
		canvas.style.width = `${HOVER_NOTE_BOARD_WIDTH}px`;
		canvas.style.height = `${HOVER_NOTE_BOARD_HEIGHT}px`;
		const ctx = canvas.getContext("2d");
		const hint = board.createDiv({ cls: "notelens-hover-note-hint", text: tr("Dibuja, pega o suelta una imagen") });
		const imageTray = sketchPane.createDiv({ cls: "notelens-hover-note-images" });

		const drawStroke = (context: CanvasRenderingContext2D, stroke: SketchStroke) => {
			const points = stroke.points;
			if (!points.length) return;
			context.strokeStyle = stroke.color;
			context.lineWidth = stroke.width;
			context.lineCap = "round";
			context.lineJoin = "round";
			context.beginPath();
			if (points.length === 1) {
				context.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2);
				context.fillStyle = stroke.color;
				context.fill();
				return;
			}
			context.moveTo(points[0].x, points[0].y);
			for (let index = 1; index < points.length - 1; index++) {
				context.quadraticCurveTo(points[index].x, points[index].y, (points[index].x + points[index + 1].x) / 2, (points[index].y + points[index + 1].y) / 2);
			}
			context.lineTo(points[points.length - 1].x, points[points.length - 1].y);
			context.stroke();
		};

		const requestImage = (image: BadgeImage): HTMLImageElement | null => {
			const cached = this.loadedImages.get(image.id);
			if (cached) return cached;
			const node = new Image();
			node.onload = () => redraw();
			node.src = image.src;
			this.loadedImages.set(image.id, node);
			return node.complete ? node : null;
		};

		const paint = (target: HTMLCanvasElement, context: CanvasRenderingContext2D, includeImages: boolean, includeSelection: boolean) => {
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.clearRect(0, 0, target.width, target.height);
			context.setTransform(dpr, 0, 0, dpr, 0, 0);
			if (includeImages) {
				for (const image of this.images) {
					const node = requestImage(image);
					if (node?.complete && node.naturalWidth) context.drawImage(node, image.x, image.y, image.w, image.h);
				}
			}
			if (this.baseImage) context.drawImage(this.baseImage, 0, 0, HOVER_NOTE_BOARD_WIDTH, HOVER_NOTE_BOARD_HEIGHT);
			for (const stroke of this.strokes) drawStroke(context, stroke);
			if (includeSelection && this.selectedImageId) {
				const selected = this.images.find(image => image.id === this.selectedImageId);
				if (selected) {
					context.save();
					context.strokeStyle = "#38bdf8";
					context.lineWidth = 2;
					context.setLineDash([6, 4]);
					context.strokeRect(selected.x - 1, selected.y - 1, selected.w + 2, selected.h + 2);
					context.setLineDash([]);
					context.fillStyle = "#f8fafc";
					context.strokeStyle = "#0f6cbd";
					context.lineWidth = 2;
					context.fillRect(selected.x + selected.w - 6, selected.y + selected.h - 6, 12, 12);
					context.strokeRect(selected.x + selected.w - 6, selected.y + selected.h - 6, 12, 12);
					context.restore();
				}
			}
		};

		const redraw = () => {
			if (!ctx) return;
			paint(canvas, ctx, true, this.boardTool === "select");
			board.setAttr("data-board-tool", this.boardTool);
			board.toggleClass("has-image-selection", !!this.selectedImageId && this.boardTool === "select");
			hint.toggleClass("hidden-hint", !!this.baseImage || this.strokes.length > 0 || this.images.length > 0);
		};

		const removeImageById = (id: string) => {
			this.images = this.images.filter(image => image.id !== id);
			this.loadedImages.delete(id);
			if (this.selectedImageId === id) this.selectedImageId = null;
			refreshTools();
			renderImageTray();
			redraw();
		};

		const renderImageTray = () => {
			imageTray.empty();
			imageTray.toggleClass("hidden", this.images.length === 0);
			if (!this.images.length) return;
			const heading = imageTray.createDiv({ cls: "notelens-hover-note-images-heading" });
			heading.createSpan({ text: tr("Imágenes ({p0})", { p0: this.images.length }) });
			heading.createSpan({ text: tr("Selecciona una para moverla o cambiar su tamaño") });
			const list = imageTray.createDiv({ cls: "notelens-hover-note-images-list" });
			for (const image of this.images) {
				const item = list.createDiv({ cls: "notelens-hover-note-image-chip" });
				item.toggleClass("active", image.id === this.selectedImageId);
				const pick = item.createEl("button", { cls: "notelens-hover-note-image-pick", type: "button" });
				const preview = pick.createEl("img");
				preview.src = image.src;
				preview.alt = "";
				pick.createSpan({ text: image.name });
				pick.onclick = () => {
					this.selectedImageId = image.id;
					this.boardTool = "select";
					refreshTools();
					renderImageTray();
					redraw();
				};
				const remove = item.createEl("button", { cls: "notelens-hover-note-image-remove", type: "button" });
				setIcon(remove, "x");
				remove.title = `Quitar ${image.name}`;
				remove.onclick = (event) => { event.stopPropagation(); removeImageById(image.id); };
			}
		};

		const refreshTools = () => {
			drawBtn.toggleClass("active", this.boardTool === "draw");
			selectBtn.toggleClass("active", this.boardTool === "select");
			swatches.forEach((swatch, index) => swatch.toggleClass("active", SKETCH_COLORS[index] === this.color));
			for (const [button, width] of widths) button.toggleClass("active", width === this.width);
			deleteImageBtn.disabled = !this.selectedImageId;
		};

		const selectTool = (tool: "draw" | "select") => {
			this.boardTool = tool;
			if (tool === "draw") this.selectedImageId = null;
			refreshTools();
			renderImageTray();
			redraw();
		};
		drawBtn.onclick = () => selectTool("draw");
		selectBtn.onclick = () => selectTool("select");

		if (this.sketch) {
			const image = new Image();
			image.onload = () => { this.baseImage = image; redraw(); };
			image.src = this.sketch;
		}

		let action: BoardAction | null = null;
		const pointAt = (event: { clientX: number; clientY: number }) => {
			const rect = canvas.getBoundingClientRect();
			return {
				x: (event.clientX - rect.left) * (HOVER_NOTE_BOARD_WIDTH / rect.width),
				y: (event.clientY - rect.top) * (HOVER_NOTE_BOARD_HEIGHT / rect.height)
			};
		};
		let lastBoardPoint = { x: HOVER_NOTE_BOARD_WIDTH / 2, y: HOVER_NOTE_BOARD_HEIGHT / 2 };
		const imageAt = (x: number, y: number): BadgeImage | undefined => [...this.images].reverse().find(image => x >= image.x && x <= image.x + image.w && y >= image.y && y <= image.y + image.h);
		canvas.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			canvas.focus({ preventScroll: true });
			canvas.setPointerCapture(event.pointerId);
			const point = pointAt(event);
			lastBoardPoint = point;
			if (this.boardTool === "select") {
				const selected = this.images.find(image => image.id === this.selectedImageId);
				if (selected && Math.hypot(point.x - (selected.x + selected.w), point.y - (selected.y + selected.h)) <= 18) {
					action = { kind: "resize", image: selected, px: point.x, py: point.y, w: selected.w, h: selected.h };
				} else {
					const image = imageAt(point.x, point.y);
					this.selectedImageId = image?.id ?? null;
					if (image) action = { kind: "move", image, px: point.x, py: point.y, x: image.x, y: image.y };
				}
				renderImageTray();
				refreshTools();
				redraw();
				return;
			}
			const stroke: SketchStroke = { color: this.color, width: this.width, points: [point] };
			this.strokes.push(stroke);
			action = { kind: "draw", stroke };
			redraw();
		});
		canvas.addEventListener("pointermove", (event) => {
			const point = pointAt(event);
			lastBoardPoint = point;
			if (!action) return;
			if (action.kind === "draw") {
				action.stroke.points.push(point);
			} else if (action.kind === "move") {
				action.image.x = bounded(action.x + point.x - action.px, 0, HOVER_NOTE_BOARD_WIDTH - action.image.w);
				action.image.y = bounded(action.y + point.y - action.py, 0, HOVER_NOTE_BOARD_HEIGHT - action.image.h);
			} else {
				const ratio = action.w / action.h;
				let width = bounded(action.w + point.x - action.px, 48, HOVER_NOTE_BOARD_WIDTH - action.image.x);
				let height = width / ratio;
				if (height > HOVER_NOTE_BOARD_HEIGHT - action.image.y) {
					height = HOVER_NOTE_BOARD_HEIGHT - action.image.y;
					width = height * ratio;
				}
				action.image.w = width;
				action.image.h = height;
			}
			redraw();
		});
		const finishAction = () => { action = null; };
		canvas.addEventListener("pointerup", finishAction);
		canvas.addEventListener("pointercancel", finishAction);

		const removeSelectedImage = () => {
			if (!this.selectedImageId) return;
			removeImageById(this.selectedImageId);
		};
		canvas.addEventListener("keydown", (event) => {
			if ((event.key === "Delete" || event.key === "Backspace") && this.selectedImageId) {
				event.preventDefault();
				removeSelectedImage();
			}
		});

		const addFiles = async (files: File[], anchor = lastBoardPoint) => {
			const available = MAX_IMAGES - this.images.length;
			if (available <= 0) { new Notice(tr("Cada etiqueta admite hasta {p0} imágenes.", { p0: MAX_IMAGES })); return; }
			const accepted = files.filter(file => file.type.startsWith("image/")).slice(0, available);
			if (!accepted.length) { new Notice(tr("Selecciona un archivo de imagen válido.")); return; }
			const placement = { ...anchor };
			for (const file of accepted) {
				try {
					const image = await this.prepareImage(file, this.images.length, placement);
					this.images.push(image);
					this.selectedImageId = image.id;
				} catch (error) {
					new Notice(error instanceof Error ? error.message : `No se pudo añadir ${file.name}.`);
				}
			}
			this.boardTool = "select";
			refreshTools();
			renderImageTray();
			redraw();
		};
		const clipboardImageFiles = (transfer: DataTransfer | null): File[] => {
			if (!transfer) return [];
			const files: File[] = [];
			const seen = new Set<string>();
			const collect = (file: File | null) => {
				if (!file || !file.type.startsWith("image/")) return;
				const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
				if (seen.has(key)) return;
				seen.add(key);
				files.push(file);
			};
			Array.from(transfer.files ?? []).forEach(collect);
			for (const item of Array.from(transfer.items ?? [])) {
				if (item.kind === "file" && item.type.startsWith("image/")) collect(item.getAsFile());
			}
			return files;
		};
		const fileFromDataUrl = async (src: string): Promise<File | null> => {
			if (!src.startsWith("data:image/")) return null;
			const response = await fetch(src);
			const blob = await response.blob();
			const extension = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
			return new File([blob], `portapapeles-${Date.now()}.${extension}`, { type: blob.type || "image/png" });
		};
		const readClipboardImages = async () => {
			try {
				const clipboard = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
				if (!clipboard || typeof clipboard.read !== "function") throw new Error("Lectura del portapapeles no disponible");
				const files: File[] = [];
				for (const entry of await clipboard.read()) {
					for (const type of entry.types.filter(type => type.startsWith("image/"))) {
						const blob = await entry.getType(type);
						const extension = (type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
						files.push(new File([blob], `portapapeles-${Date.now()}.${extension}`, { type }));
					}
				}
				if (!files.length) { new Notice(tr("El portapapeles no contiene ninguna imagen.")); return; }
				await addFiles(files, lastBoardPoint);
			} catch {
				new Notice(tr("No pude leer la imagen del portapapeles. Prueba Ctrl+V sobre la pizarra o usa Subir imagen."));
			}
		};
		uploadBtn.onclick = () => imageInput.click();
		pasteBtn.onclick = () => void readClipboardImages();
		imageInput.onchange = () => {
			void addFiles(Array.from(imageInput.files ?? []));
			imageInput.value = "";
		};
		for (const type of ["dragenter", "dragover"]) {
			board.addEventListener(type, (event) => { event.preventDefault(); board.addClass("is-dragover"); });
		}
		for (const type of ["dragleave", "drop"]) board.addEventListener(type, () => board.removeClass("is-dragover"));
		board.addEventListener("drop", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void addFiles(Array.from(event.dataTransfer?.files ?? []), pointAt(event));
		});
		contentEl.addEventListener("paste", (event) => {
			if (this.mode !== "sketch") return;
			const target = event.target as HTMLElement | null;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
			event.preventDefault();
			event.stopPropagation();
			const files = clipboardImageFiles(event.clipboardData);
			if (files.length) { void addFiles(files, lastBoardPoint); return; }
			const html = event.clipboardData?.getData("text/html") ?? "";
			const plain = event.clipboardData?.getData("text/plain") ?? "";
			const htmlImage = html ? new DOMParser().parseFromString(html, "text/html").querySelector("img")?.src ?? "" : "";
			const dataUrl = htmlImage.startsWith("data:image/") ? htmlImage : plain.trim();
			if (dataUrl.startsWith("data:image/")) {
				void fileFromDataUrl(dataUrl).then(file => file ? addFiles([file], lastBoardPoint) : undefined);
				return;
			}
			void readClipboardImages();
		}, { capture: true });

		deleteImageBtn.onclick = removeSelectedImage;
		undoBtn.onclick = () => {
			if (this.strokes.length) this.strokes.pop();
			else this.baseImage = null;
			redraw();
		};
		clearBtn.onclick = () => { this.strokes = []; this.baseImage = null; redraw(); };

		const exportSketch = (): string | undefined => {
			if (!this.baseImage && !this.strokes.length) return undefined;
			const output = document.createElement("canvas");
			output.width = canvas.width;
			output.height = canvas.height;
			const outputContext = output.getContext("2d");
			if (!outputContext) return undefined;
			paint(output, outputContext, false, false);
			return output.toDataURL("image/png");
		};

		const footer = contentEl.createDiv({ cls: "notelens-hover-note-footer" });
		footer.createSpan({
			cls: "notelens-hover-note-help",
			text: this.taskMode ? "La lista, las notas, los trazos y las imágenes se guardan juntos." : "El título, la nota, los trazos y las imágenes se guardan juntos."
		});
		const ok = footer.createEl("button", { cls: "mod-cta", text: tr("Guardar"), type: "button" });
		const cancel = footer.createEl("button", { text: tr("Cancelar"), type: "button" });
		const submit = () => {
			const content: HoverNoteContent = {
				title: this.noteTitle.trim() || this.dialogTitle,
				text: this.text.trim(),
				sketch: exportSketch(),
				images: this.images.length ? this.images.map(image => ({ ...image })) : undefined,
				checklist: this.taskMode
					? this.checklist.filter(item => item.text.trim() || item.sketch).map(item => ({ ...item, text: item.text.trim() }))
					: undefined
			};
			this.close();
			this.onSubmit(content);
		};
		ok.onclick = submit;
		cancel.onclick = () => this.close();
		titleInput.addEventListener("keydown", (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(); }
		});

		const showMode = (mode: "text" | "sketch") => {
			this.mode = mode;
			tabText.toggleClass("active", mode === "text");
			tabSketch.toggleClass("active", mode === "sketch");
			textPane.style.display = mode === "text" ? "" : "none";
			sketchPane.style.display = mode === "sketch" ? "" : "none";
			if (mode === "text") {
				const target = this.taskMode ? checklistList?.querySelector(".notelens-task-checklist-input") as HTMLInputElement | null : area;
				requestAnimationFrame(() => (target ?? area).focus());
			}
			else requestAnimationFrame(() => { redraw(); canvas.focus({ preventScroll: true }); });
		};
		tabText.onclick = () => showMode("text");
		tabSketch.onclick = () => showMode("sketch");
		refreshTools();
		renderImageTray();
		redraw();
		showMode(this.mode);
	}

	private async prepareImage(file: File, index: number, anchor: { x: number; y: number }): Promise<BadgeImage> {
		if (file.size > MAX_IMAGE_FILE_BYTES) throw new Error(`${file.name} supera el límite de 20 MB.`);
		const source = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error(`No se pudo leer ${file.name}.`));
			reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
			reader.readAsDataURL(file);
		});
		const node = await new Promise<HTMLImageElement>((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = () => reject(new Error(`${file.name} no contiene una imagen compatible.`));
			image.src = source;
		});
		let src = source;
		const encode = (maxEdge: number, quality: number): string => {
			const scale = Math.min(1, maxEdge / Math.max(node.naturalWidth, node.naturalHeight));
			const output = document.createElement("canvas");
			output.width = Math.max(1, Math.round(node.naturalWidth * scale));
			output.height = Math.max(1, Math.round(node.naturalHeight * scale));
			output.getContext("2d")?.drawImage(node, 0, 0, output.width, output.height);
			return output.toDataURL("image/webp", quality);
		};
		if (Math.max(node.naturalWidth, node.naturalHeight) > MAX_IMAGE_SOURCE_EDGE || source.length > 3_000_000) {
			src = encode(MAX_IMAGE_SOURCE_EDGE, 0.88);
			if (src.length > 5_000_000) src = encode(1100, 0.78);
		}
		if (src.length > 6_000_000) throw new Error(`${file.name} sigue siendo demasiado grande después de optimizarla.`);
		let scale = Math.min(260 / node.naturalWidth, 180 / node.naturalHeight, 1);
		if (Math.max(node.naturalWidth * scale, node.naturalHeight * scale) < 72) {
			scale = 72 / Math.max(node.naturalWidth, node.naturalHeight);
		}
		const w = Math.max(24, node.naturalWidth * scale);
		const h = Math.max(24, node.naturalHeight * scale);
		const offset = (index % 5) * 12;
		return {
			id: genId("badge_image"),
			name: file.name || "Imagen",
			src,
			x: bounded(anchor.x - w / 2 + offset, 0, HOVER_NOTE_BOARD_WIDTH - w),
			y: bounded(anchor.y - h / 2 + offset, 0, HOVER_NOTE_BOARD_HEIGHT - h),
			w,
			h
		};
	}

	override onClose(): void {
		this.loadedImages.clear();
		this.contentEl.empty();
	}
}


/**
 * One-line handwriting surface for a task step. Small on purpose: it holds a
 * short phrase written with a stylus, and reports a trimmed PNG so an empty
 * pad never saves an image.
 */
class StepPad {
	private readonly ctx: CanvasRenderingContext2D | null;
	private readonly dpr = window.devicePixelRatio || 1;
	private strokes: { x: number; y: number }[][] = [];
	private current: { x: number; y: number }[] | null = null;
	private base: HTMLImageElement | null = null;

	static readonly WIDTH = 460;
	static readonly HEIGHT = 68;

	constructor(private canvas: HTMLCanvasElement, initial: string | undefined, private onChange: (data: string | undefined) => void) {
		canvas.width = StepPad.WIDTH * this.dpr;
		canvas.height = StepPad.HEIGHT * this.dpr;
		canvas.style.width = `${StepPad.WIDTH}px`;
		canvas.style.height = `${StepPad.HEIGHT}px`;
		this.ctx = canvas.getContext("2d");
		if (initial) {
			const img = new Image();
			img.onload = () => { this.base = img; this.redraw(); };
			img.src = initial;
		}
		const at = (event: PointerEvent) => {
			const r = canvas.getBoundingClientRect();
			return { x: (event.clientX - r.left) * (StepPad.WIDTH / r.width), y: (event.clientY - r.top) * (StepPad.HEIGHT / r.height) };
		};
		canvas.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			canvas.setPointerCapture(event.pointerId);
			this.current = [at(event)];
			this.strokes.push(this.current);
			this.redraw();
		});
		canvas.addEventListener("pointermove", (event) => {
			if (!this.current) return;
			this.current.push(at(event));
			this.redraw();
		});
		const finish = () => {
			if (!this.current) return;
			this.current = null;
			this.onChange(this.export());
		};
		canvas.addEventListener("pointerup", finish);
		canvas.addEventListener("pointercancel", finish);
	}

	redraw(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		if (this.base) {
			// A saved step is already cropped to its ink: draw it at its own size,
			// anchored left, instead of stretching it across the whole pad.
			const w = Math.min(StepPad.WIDTH, this.base.width / this.dpr);
			const h = Math.min(StepPad.HEIGHT, this.base.height / this.dpr);
			ctx.drawImage(this.base, 0, 0, w, h);
		}
		ctx.strokeStyle = "#f8fafc";
		ctx.lineWidth = 2.4;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const stroke of this.strokes) {
			if (!stroke.length) continue;
			ctx.beginPath();
			if (stroke.length === 1) {
				ctx.arc(stroke[0].x, stroke[0].y, 1.2, 0, Math.PI * 2);
				ctx.fillStyle = "#f8fafc";
				ctx.fill();
				continue;
			}
			ctx.moveTo(stroke[0].x, stroke[0].y);
			for (let i = 1; i < stroke.length - 1; i++) {
				ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, (stroke[i].x + stroke[i + 1].x) / 2, (stroke[i].y + stroke[i + 1].y) / 2);
			}
			ctx.lineTo(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y);
			ctx.stroke();
		}
	}

	clear(): void {
		this.strokes = [];
		this.base = null;
		this.redraw();
		this.onChange(undefined);
	}

	/**
	 * Crops the pad to what was actually written. Without this a short word
	 * saved a 460px-wide image and the hover card grew to fit the blank space.
	 */
	private export(): string | undefined {
		if (!this.base && !this.strokes.length) return undefined;
		const ctx = this.ctx;
		if (!ctx) return undefined;
		const { width, height } = this.canvas;
		let pixels: Uint8ClampedArray;
		try {
			pixels = ctx.getImageData(0, 0, width, height).data;
		} catch {
			return this.canvas.toDataURL("image/png");
		}
		let minX = width, minY = height, maxX = -1, maxY = -1;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				if (pixels[(y * width + x) * 4 + 3] < 12) continue;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
		if (maxX < 0) return undefined;
		const pad = Math.round(4 * this.dpr);
		const left = Math.max(0, minX - pad);
		const top = Math.max(0, minY - pad);
		const right = Math.min(width, maxX + pad + 1);
		const bottom = Math.min(height, maxY + pad + 1);
		const cropW = Math.max(1, right - left);
		const cropH = Math.max(1, bottom - top);
		const out = document.createElement("canvas");
		// Saved at CSS size: the image then renders at exactly the size it was
		// written, instead of being scaled by the screen's pixel ratio.
		out.width = Math.max(1, Math.round(cropW / this.dpr));
		out.height = Math.max(1, Math.round(cropH / this.dpr));
		const outCtx = out.getContext("2d");
		if (outCtx) {
			outCtx.imageSmoothingQuality = "high";
			outCtx.drawImage(this.canvas, left, top, cropW, cropH, 0, 0, out.width, out.height);
		}
		return out.toDataURL("image/png");
	}
}
