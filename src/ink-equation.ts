import { App, Modal, setIcon } from "obsidian";
import { recognizeFormula } from "./ocr";
import { InkMathRecognition, pickFormulaCandidate, recognizeInkFormula } from "./ink-math";
import { tr } from "./i18n";

type InkTool = "write" | "erase";

interface InkStroke {
	points: { x: number; y: number }[];
	width: number;
}

const BOARD_W = 620;
const BOARD_H = 300;

/**
 * Handwrite an equation and watch it become a formula, the way OneNote's ink
 * equation dialog works. Recognition runs locally with Tesseract, so it needs
 * no model, no account and no connection.
 */
export class InkEquationModal extends Modal {
	private strokes: InkStroke[] = [];
	private redoStack: InkStroke[] = [];
	private current: InkStroke | null = null;
	private tool: InkTool = "write";
	private penWidth = 3;
	private source: string;
	private recognizeTimer: number | null = null;
	private recognizing = false;
	private pending = false;

	constructor(
		app: App,
		initial: string,
		private onSubmit: (source: string) => void,
		/** Renders the notation as HTML; the view owns MathJax. */
		private renderFormula: (source: string, into: HTMLElement) => void,
		/** Cleans up what OCR returns for maths. */
		private tidy: (raw: string) => string,
		/** Reads a region of the real board, for formulas already written there. */
		private readFromBoard?: (onProgress: (message: string) => void) => Promise<string>
	) {
		super(app);
		this.source = initial;
	}

	override onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("notelens-ink-equation-modal");
		contentEl.empty();
		contentEl.addClass("notelens-ink-equation");
		contentEl.createEl("h3", { text: tr("Insertar ecuación") });

		// --- the recognised formula, on top, exactly like OneNote
		const preview = contentEl.createDiv({ cls: "notelens-ink-preview" });

		// --- the writing surface
		const board = contentEl.createDiv({ cls: "notelens-ink-board" });
		const canvas = board.createEl("canvas");
		const dpr = window.devicePixelRatio || 1;
		canvas.width = BOARD_W * dpr;
		canvas.height = BOARD_H * dpr;
		canvas.style.width = `${BOARD_W}px`;
		canvas.style.height = `${BOARD_H}px`;
		const ctx = canvas.getContext("2d");
		const hint = board.createDiv({ cls: "notelens-ink-hint", text: tr("Escribe aquí la ecuación con el lápiz o el ratón") });

		// --- notation, editable so you can fix what the reader got wrong
		const sourceRow = contentEl.createDiv({ cls: "notelens-ink-source-row" });
		sourceRow.createSpan({ cls: "notelens-ink-source-label", text: tr("Notación") });
		const input = sourceRow.createEl("input", { cls: "notelens-ink-source", type: "text" });
		input.value = this.source;
		input.placeholder = "\\frac{a}{b} + \\sqrt{x}";

		const status = contentEl.createDiv({ cls: "notelens-ink-status" });
		const candidates = contentEl.createDiv({ cls: "notelens-ink-candidates hidden" });
		let lastAutomatic = "";
		let editedByUser = false;

		const drawPreview = () => {
			preview.empty();
			const src = input.value.trim();
			if (!src) { preview.createSpan({ cls: "notelens-ink-placeholder", text: tr("Aquí verás la ecuación") }); return; }
			this.renderFormula(src, preview);
		};
		input.addEventListener("input", () => { this.source = input.value; editedByUser = input.value !== lastAutomatic; drawPreview(); });
		drawPreview();

		// Common structures are faster and less error-prone than typing every
		// brace on a tablet. The inserted example stays selected for replacement.
		const structures = contentEl.createDiv({ cls: "notelens-ink-structures" });
		structures.createSpan({ cls: "notelens-ink-structures-label", text: tr("Estructuras") });
		const structureItems: { label: string; value: string; select: [number, number] }[] = [
			{ label: "a⁄b", value: "\\frac{a}{b}", select: [6, 7] },
			{ label: "xⁿ", value: "x^{n}", select: [3, 4] },
			{ label: "√x", value: "\\sqrt{x}", select: [6, 7] },
			{ label: "∫", value: "\\int_{a}^{b} f(x)\\,dx", select: [6, 7] },
			{ label: "Σ", value: "\\sum_{i=1}^{n}", select: [6, 9] },
			{ label: "π", value: "\\pi", select: [0, 3] }
		];
		for (const item of structureItems) {
			const button = structures.createEl("button", { cls: "notelens-ink-structure", text: item.label });
			button.title = `Insertar ${item.value}`;
			button.onclick = () => {
				const start = input.selectionStart ?? input.value.length;
				const end = input.selectionEnd ?? start;
				input.setRangeText(item.value, start, end, "end");
				input.setSelectionRange(start + item.select[0], start + item.select[1]);
				this.source = input.value;
				editedByUser = true;
				drawPreview();
				input.focus();
			};
		}

		const showCandidates = (recognition: InkMathRecognition) => {
			candidates.empty();
			const uncertain = recognition.tokens.filter(token => token.value.length === 1 && token.confidence < 0.72 && token.alternatives.length > 1).slice(0, 7);
			candidates.toggleClass("hidden", uncertain.length === 0);
			if (!uncertain.length) return;
			candidates.createSpan({ cls: "notelens-ink-candidates-label", text: tr("Revisar") });
			let searchFrom = 0;
			for (const token of uncertain) {
				const tokenStart = input.value.indexOf(token.value, searchFrom);
				if (tokenStart >= 0) searchFrom = tokenStart + token.value.length;
				const select = candidates.createEl("select", { cls: "notelens-ink-candidate" });
				for (const alternative of token.alternatives) select.createEl("option", { value: alternative, text: alternative });
				select.value = token.value;
				select.title = `Confianza ${Math.round(token.confidence * 100)}%. Elige el símbolo correcto.`;
				select.onchange = () => {
					if (tokenStart < 0) return;
					input.setRangeText(select.value, tokenStart, tokenStart + token.value.length, "end");
					this.source = input.value;
					editedByUser = true;
					drawPreview();
				};
			}
		};

		// --- painting
		const redraw = () => {
			if (!ctx) return;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.strokeStyle = "#1a1a1a";
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			for (const stroke of this.strokes) {
				if (stroke.points.length === 0) continue;
				ctx.lineWidth = stroke.width;
				ctx.beginPath();
				if (stroke.points.length === 1) {
					ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
					ctx.fillStyle = "#1a1a1a";
					ctx.fill();
					continue;
				}
				ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
				for (let i = 1; i < stroke.points.length - 1; i++) {
					const mid = { x: (stroke.points[i].x + stroke.points[i + 1].x) / 2, y: (stroke.points[i].y + stroke.points[i + 1].y) / 2 };
					ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, mid.x, mid.y);
				}
				ctx.lineTo(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y);
				ctx.stroke();
			}
			hint.toggleClass("hidden-hint", this.strokes.length > 0);
		};
		redraw();

		const pointAt = (event: PointerEvent) => {
			const rect = canvas.getBoundingClientRect();
			return { x: (event.clientX - rect.left) * (BOARD_W / rect.width), y: (event.clientY - rect.top) * (BOARD_H / rect.height) };
		};
		const eraseAt = (point: { x: number; y: number }) => {
			const before = this.strokes.length;
			this.strokes = this.strokes.filter(stroke => !stroke.points.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 14));
			if (this.strokes.length !== before) { redraw(); this.scheduleRecognition(); }
		};
		canvas.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			canvas.setPointerCapture(event.pointerId);
			if (this.tool === "erase") { eraseAt(pointAt(event)); return; }
			this.redoStack = [];
			this.current = { points: [pointAt(event)], width: this.penWidth };
			this.strokes.push(this.current);
			redraw();
		});
		canvas.addEventListener("pointermove", (event) => {
			if (this.tool === "erase") { if (event.buttons === 1) eraseAt(pointAt(event)); return; }
			if (!this.current) return;
			this.current.points.push(pointAt(event));
			redraw();
		});
		const endStroke = () => {
			if (!this.current) return;
			this.current = null;
			this.scheduleRecognition();
		};
		canvas.addEventListener("pointerup", endStroke);
		canvas.addEventListener("pointercancel", endStroke);

		// --- the tool row, mirroring OneNote's
		const tools = contentEl.createDiv({ cls: "notelens-ink-tools" });
		const toolButton = (icon: string, label: string, run: () => void) => {
			const button = tools.createEl("button", { cls: "notelens-ink-tool" });
			setIcon(button.createSpan(), icon);
			button.createSpan({ text: label });
			button.onclick = run;
			return button;
		};
		const writeBtn = toolButton("pen-line", "Escribir", () => setTool("write"));
		const eraseBtn = toolButton("eraser", "Borrar", () => setTool("erase"));
		toolButton("undo-2", "Deshacer", () => {
			const last = this.strokes.pop();
			if (last) { this.redoStack.push(last); redraw(); this.scheduleRecognition(); }
		});
		toolButton("redo-2", "Rehacer", () => {
			const next = this.redoStack.pop();
			if (next) { this.strokes.push(next); redraw(); this.scheduleRecognition(); }
		});
		toolButton("trash-2", "Eliminar", () => {
			this.strokes = [];
			this.redoStack = [];
			redraw();
			input.value = "";
			this.source = "";
			lastAutomatic = "";
			editedByUser = false;
			drawPreview();
			status.setText("");
			candidates.addClass("hidden");
		});
		if (this.readFromBoard) {
			toolButton("scan-text", "Leer de la pizarra", async () => {
				status.setText(tr("Elige la zona de la pizarra…"));
				const text = await this.readFromBoard?.(message => status.setText(message)).catch(() => "") ?? "";
				if (!text.trim()) { status.setText(tr("No he leído nada. Prueba con una zona más ajustada.")); return; }
				input.value = this.tidy(text);
				this.source = input.value;
				lastAutomatic = input.value;
				editedByUser = false;
				drawPreview();
				status.setText(tr("Leído desde los objetos y trazos de la pizarra. Revisa solo los símbolos marcados."));
			});
		}
		const setTool = (tool: InkTool) => {
			this.tool = tool;
			writeBtn.toggleClass("active", tool === "write");
			eraseBtn.toggleClass("active", tool === "erase");
			canvas.toggleClass("is-erasing", tool === "erase");
		};
		setTool("write");

		// --- footer
		const footer = contentEl.createDiv({ cls: "notelens-ink-footer" });
		const insert = footer.createEl("button", { cls: "mod-cta", text: tr("Insertar") });
		const cancel = footer.createEl("button", { text: tr("Cancelar") });
		insert.onclick = () => {
			const value = input.value.trim();
			this.close();
			if (value) this.onSubmit(value);
		};
		cancel.onclick = () => this.close();
		contentEl.addEventListener("keydown", (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); insert.click(); }
		});

		// Recognition, debounced so it runs when you pause rather than per stroke.
		this.scheduleRecognition = () => {
			if (this.recognizeTimer !== null) window.clearTimeout(this.recognizeTimer);
			this.recognizeTimer = window.setTimeout(() => void runRecognition(), 700);
		};
		const runRecognition = async () => {
			if (this.strokes.length === 0) return;
			if (this.recognizing) { this.pending = true; return; }
			this.recognizing = true;
			status.setText(tr("Analizando trazos y estructura…"));
			try {
				// The vector pass is instant and retains fractions, superscripts and
				// stroke grouping. It is the primary recogniser for board ink.
				const vector = recognizeInkFormula(this.strokes);
				let text = vector.source;
				if (text && (!editedByUser || input.value === lastAutomatic || !input.value.trim())) {
					const tidied = this.tidy(text);
					input.value = tidied;
					this.source = tidied;
					lastAutomatic = tidied;
					editedByUser = false;
					drawPreview();
					showCandidates(vector);
				}
				status.setText(vector.detail);

				// White page, thick black ink: what the recogniser handles best.
				const shot = document.createElement("canvas");
				shot.width = canvas.width;
				shot.height = canvas.height;
				const shotCtx = shot.getContext("2d");
				if (shotCtx) {
					shotCtx.fillStyle = "#ffffff";
					shotCtx.fillRect(0, 0, shot.width, shot.height);
					shotCtx.drawImage(canvas, 0, 0);
				}
				// Only ask the local OCR fallback when geometry is unsure. This keeps
				// the normal pen flow immediate and still covers uncommon letters.
				if (vector.confidence < 0.78 || /\?/.test(vector.source)) {
					const ocr = await recognizeFormula(shot, message => status.setText(message));
					text = pickFormulaCandidate([
						{ source: vector.source, bonus: vector.confidence * 8 },
						{ source: ocr, bonus: 1.5 }
					]);
				}
				const tidied = this.tidy(text);
				if (tidied && (!editedByUser || input.value === lastAutomatic || !input.value.trim())) {
					input.value = tidied;
					this.source = tidied;
					lastAutomatic = tidied;
					editedByUser = false;
					drawPreview();
					showCandidates(vector);
					status.setText(vector.confidence >= 0.78 ? vector.detail : "Lectura local combinada. Los símbolos dudosos aparecen debajo.");
				} else {
					status.setText(tidied ? "He respetado tu corrección manual." : "No he reconocido nada todavía; sigue escribiendo o usa las estructuras.");
				}
			} catch {
				status.setText(tr("No he podido leer la escritura. Escribe la notación abajo."));
			} finally {
				this.recognizing = false;
				if (this.pending) { this.pending = false; this.scheduleRecognition(); }
			}
		};
	}

	/** Replaced in onOpen; declared so the handlers above can call it. */
	private scheduleRecognition: () => void = () => {};

	override onClose(): void {
		if (this.recognizeTimer !== null) window.clearTimeout(this.recognizeTimer);
		this.contentEl.empty();
	}
}
