import { formulaTokenPositions } from "./formula-candidates";
import { inkHitsPoint } from "./ink-region";
import { App, Modal, setIcon } from "obsidian";
import { recognizeFormula } from "./ocr";
import { InkMathRecognition, pickFormulaCandidate, recognizeInkFormula } from "./ink-math";
import { tr } from "./i18n";
import { MATH_GROUPS, insertMathSnippet } from "./math-palette";

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
	private undoStack: InkStroke[][] = [];
	private redoStack: InkStroke[][] = [];
	private current: InkStroke | null = null;
	private tool: InkTool = "write";
	private penWidth = 3;
	private source: string;
	private recognizeTimer: number | null = null;
	private recognizing = false;
	private pending = false;
	private recognitionRevision = 0;

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

		// Two ways in, not two dialogs: the pen and the keyboard write into the
		// same notation, so a formula can be started by hand and finished typed.
		const modeRow = contentEl.createDiv({ cls: "notelens-ink-modes" });
		const handBtn = modeRow.createEl("button", { cls: "notelens-ink-mode" });
		setIcon(handBtn.createSpan(), "pen-line");
		handBtn.createSpan({ text: tr("A mano") });
		const typeBtn = modeRow.createEl("button", { cls: "notelens-ink-mode" });
		setIcon(typeBtn.createSpan(), "keyboard");
		typeBtn.createSpan({ text: tr("Teclado") });

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
		// A LaTeX sample, identical in every language, so it stays out of the catalogue.
		input.placeholder = "\\frac{a}{b} + \\sqrt{x}";

		// --- the keyboard pane: the same palette the formula box carries
		const keyboard = contentEl.createDiv({ cls: "notelens-ink-keyboard hidden" });
		const groupRow = keyboard.createDiv({ cls: "notelens-ink-groups" });
		const keyGrid = keyboard.createDiv({ cls: "notelens-ink-keys" });
		const showGroup = (name: string) => {
			keyGrid.empty();
			for (const item of MATH_GROUPS.find(group => group.name === name)?.keys ?? []) {
				const button = keyGrid.createEl("button", { cls: "notelens-ink-key", text: item.glyph });
				button.title = tr(item.name);
				button.onclick = () => {
					insertMathSnippet(input, item.snippet);
					this.source = input.value;
					editedByUser = true;
					candidates.addClass("hidden");
					drawPreview();
				};
			}
			for (const tab of Array.from(groupRow.children)) tab.toggleClass("active", tab.getAttribute("data-group") === name);
		};
		for (const group of MATH_GROUPS) {
			const tab = groupRow.createEl("button", { cls: "notelens-ink-group", text: tr(group.name) });
			tab.setAttr("data-group", group.name);
			tab.onclick = () => showGroup(group.name);
		}
		showGroup(MATH_GROUPS[0].name);
		keyboard.createDiv({
			cls: "notelens-ink-cheatsheet",
			text: tr("También entiende la notación de la calculadora: x^2/2, sqrt(x), sum_(i=1)^n i, int_0^1 x^2 dx, [[a,b],[c,d]]. Y LaTeX tal cual.")
		});

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
		input.addEventListener("input", () => { candidates.addClass("hidden"); this.source = input.value; editedByUser = input.value !== lastAutomatic; drawPreview(); });
		drawPreview();

		const showCandidates = (recognition: InkMathRecognition) => {
			candidates.empty();
			// Unknown glyphs come first: those are the ones the reader refused to
			// name, and the ones the user most needs to fix.
			const doubtful = recognition.tokens.filter(token => token.unknown
				|| (token.value.length === 1 && token.confidence < 0.72 && token.alternatives.length > 1));
			const uncertain = [...doubtful].sort((a, b) => Number(!!b.unknown) - Number(!!a.unknown)).slice(0, 7);
			candidates.toggleClass("hidden", uncertain.length === 0);
			if (!uncertain.length) return;
			candidates.createSpan({
				cls: "notelens-ink-candidates-label",
				text: uncertain.some(token => token.unknown) ? tr("Sin reconocer") : tr("Revisar")
			});
			const candidateSource = input.value;
			const positions = formulaTokenPositions(candidateSource, recognition.tokens.map(token => token.value));
			for (const token of uncertain) {
				const tokenStart = positions[recognition.tokens.indexOf(token)];
				if (tokenStart < 0) continue;
				const select = candidates.createEl("select", { cls: "notelens-ink-candidate" });
				select.toggleClass("is-unknown", !!token.unknown);
				// The value it holds has to be among the options or the select
				// renders empty, which is what an unknown "?" did.
				const options = [token.value, ...token.alternatives.filter(alternative => alternative !== token.value)];
				for (const alternative of options) select.createEl("option", { value: alternative, text: alternative });
				select.value = token.value;
				select.title = token.unknown
					? tr("No he reconocido este símbolo. Elige uno de los parecidos, o escríbelo otra vez.")
					: tr("Confianza {p0}%. Elige el símbolo correcto.", { p0: Math.round(token.confidence * 100) });
				select.onchange = () => {
					if (tokenStart < 0 || input.value !== candidateSource) return;
					candidates.addClass("hidden");
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

		let activePointer: number | null = null;
		const remember = () => {
			this.undoStack.push(this.strokes.map(s => ({ ...s, points: [...s.points] })));
			if (this.undoStack.length > 100) this.undoStack.shift();
			this.redoStack = [];
		};
		const pointAt = (event: PointerEvent) => {
			const rect = canvas.getBoundingClientRect();
			return { x: (event.clientX - rect.left) * (BOARD_W / rect.width), y: (event.clientY - rect.top) * (BOARD_H / rect.height) };
		};
		const eraseAt = (point: { x: number; y: number }) => {
			const before = this.strokes.length;
			this.strokes = this.strokes.filter(stroke => !inkHitsPoint(stroke, point, 14 + stroke.width / 2));
			if (this.strokes.length !== before) { redraw(); this.scheduleRecognition(); }
		};
		canvas.addEventListener("pointerdown", (event) => {
			if (event.button !== 0 || activePointer !== null) return;
			activePointer = event.pointerId;
			remember();
			this.recognitionRevision++;
			event.preventDefault();
			canvas.setPointerCapture(event.pointerId);
			if (this.tool === "erase") { eraseAt(pointAt(event)); return; }
			this.redoStack = [];
			this.current = { points: [pointAt(event)], width: this.penWidth };
			this.strokes.push(this.current);
			redraw();
		});
		canvas.addEventListener("pointermove", (event) => {
			if (event.pointerId !== activePointer) return;
			if (this.tool === "erase") { if (event.buttons === 1) eraseAt(pointAt(event)); return; }
			if (!this.current) return;
			this.current.points.push(pointAt(event));
			redraw();
		});
		const endStroke = (event: PointerEvent) => {
			if (event.pointerId !== activePointer) return;
			activePointer = null;
			this.current = null;
			this.scheduleRecognition();
		};
		canvas.addEventListener("pointerup", endStroke);
		canvas.addEventListener("pointercancel", endStroke);
		canvas.addEventListener("lostpointercapture", endStroke);

		// --- the tool row, mirroring OneNote's
		const tools = contentEl.createDiv({ cls: "notelens-ink-tools" });
		const toolButton = (icon: string, label: string, run: () => void) => {
			const button = tools.createEl("button", { cls: "notelens-ink-tool" });
			setIcon(button.createSpan(), icon);
			button.createSpan({ text: label });
			button.onclick = run;
			return button;
		};
		const writeBtn = toolButton("pen-line", tr("Escribir"), () => setTool("write"));
		const eraseBtn = toolButton("eraser", tr("Borrar"), () => setTool("erase"));
		const undoButton = toolButton("undo-2", tr("Deshacer"), () => {
			const last = this.undoStack.pop();
			if (last) { this.redoStack.push(this.strokes); this.strokes = last; redraw(); this.scheduleRecognition(); }
		});
		const redoButton = toolButton("redo-2", tr("Rehacer"), () => {
			const next = this.redoStack.pop();
			if (next) { this.undoStack.push(this.strokes); this.strokes = next; redraw(); this.scheduleRecognition(); }
		});
		toolButton("trash-2", tr("Eliminar"), () => {
			remember();
			this.recognitionRevision++;
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
			toolButton("scan-text", tr("Leer de la pizarra"), async () => {
				status.setText(tr("Elige la zona de la pizarra…"));
				this.recognitionRevision++;
				// The modal's backdrop otherwise intercepts the region-selection gesture.
				const previousDisplay = this.containerEl.style.display;
				this.containerEl.setCssStyles({ display: "none" });
				let text = "";
				try {
					text = await this.readFromBoard?.(message => status.setText(message)) ?? "";
				} catch {
					status.setText(tr("No he podido leer la escritura. Escribe la notación abajo."));
					return;
				} finally {
					this.containerEl.setCssStyles({ display: previousDisplay });
				}
				if (!this.containerEl.isConnected) return;
				if (!text.trim()) { status.setText(tr("No he leído nada. Prueba con una zona más ajustada.")); return; }
				input.value = this.tidy(text);
				this.source = input.value;
				lastAutomatic = input.value;
				editedByUser = true;
				candidates.addClass("hidden");
				drawPreview();
				status.setText(tr("Leído desde los objetos y trazos de la pizarra. Revisa solo los símbolos marcados."));
			});
		}
		const setMode = (mode: "hand" | "type") => {
			handBtn.toggleClass("active", mode === "hand");
			typeBtn.toggleClass("active", mode === "type");
			board.toggleClass("hidden", mode !== "hand");
			tools.toggleClass("hidden", mode !== "hand");
			keyboard.toggleClass("hidden", mode !== "type");
			candidates.toggleClass("hidden", mode !== "hand" || !candidates.childElementCount);
			if (mode === "type") input.focus();
		};
		handBtn.onclick = () => setMode("hand");
		typeBtn.onclick = () => setMode("type");

		const setTool = (tool: InkTool) => {
			this.tool = tool;
			writeBtn.toggleClass("active", tool === "write");
			eraseBtn.toggleClass("active", tool === "erase");
			canvas.toggleClass("is-erasing", tool === "erase");
		};
		setTool("write");
		// Handwriting first, as OneNote does; the keyboard is one click away.
		setMode(this.source.trim() ? "type" : "hand");

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
			const target = event.target as HTMLElement;
			if ((event.ctrlKey || event.metaKey) && !target.matches("input, textarea, [contenteditable=true]")) {
				const key = event.key.toLowerCase();
				if (key === "z" || key === "y") {
					event.preventDefault(); event.stopPropagation();
					if (key === "y" || event.shiftKey) redoButton.click(); else undoButton.click();
					return;
				}
			}
			if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); insert.click(); }
		});

		// Recognition, debounced so it runs when you pause rather than per stroke.
		this.scheduleRecognition = () => {
			this.recognitionRevision++;
			if (this.recognizeTimer !== null) window.clearTimeout(this.recognizeTimer);
			this.recognizeTimer = window.setTimeout(() => void runRecognition(), 700);
		};
		const runRecognition = async () => {
			if (!this.containerEl.isConnected || this.current) return;
			if (this.strokes.length === 0) {
				if (!editedByUser) { input.value = this.source = lastAutomatic = ""; drawPreview(); }
				candidates.addClass("hidden"); status.setText(""); return;
			}
			if (this.recognizing) { this.pending = true; return; }
			this.recognizing = true;
			const revision = this.recognitionRevision;
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
					if (text === vector.source) showCandidates(vector); else candidates.addClass("hidden");
				}
				status.setText(vector.detail);

				// White page, thick black ink: what the recogniser handles best.
				const shot = createEl("canvas");
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
					let ocr = "";
					try {
						ocr = await recognizeFormula(shot, message => { if (revision === this.recognitionRevision) status.setText(message); });
					} catch {
						// Keep the vector result when the optional image recognizer is unavailable.
					}
					if (revision !== this.recognitionRevision || !this.containerEl.isConnected) return;
					if (vector.unknown > 0) {
						// A symbol the stroke reader refused to name is not a symbol the
						// image reader gets to name unannounced: it read a spiral as "9".
						// The guess is offered instead, next to the "?" it belongs to.
						const guess = this.tidy(ocr).trim();
						if (guess && guess.length <= 2) {
							for (const token of vector.tokens) {
								if (token.unknown && !token.alternatives.includes(guess)) token.alternatives.unshift(guess);
							}
						}
						text = vector.source;
					} else {
						text = pickFormulaCandidate([
							{ source: vector.source, bonus: vector.confidence * 8 },
							{ source: ocr, bonus: 1.5 }
						]);
					}
				}
				const tidied = this.tidy(text);
				if (tidied && (!editedByUser || input.value === lastAutomatic || !input.value.trim())) {
					input.value = tidied;
					this.source = tidied;
					lastAutomatic = tidied;
					editedByUser = false;
					drawPreview();
					if (text === vector.source) showCandidates(vector); else candidates.addClass("hidden");
					status.setText(vector.unknown > 0
					? vector.detail
					: vector.confidence >= 0.78 ? vector.detail : tr("Lectura local combinada. Los símbolos dudosos aparecen debajo."));
				} else {
					status.setText(tidied ? tr("He respetado tu corrección manual.") : tr("No he reconocido nada todavía; sigue escribiendo o usa las estructuras."));
				}
			} catch {
				if (revision === this.recognitionRevision && this.containerEl.isConnected) status.setText(tr("No he podido leer la escritura. Escribe la notación abajo."));
			} finally {
				this.recognizing = false;
				if (this.pending && this.containerEl.isConnected) { this.pending = false; this.scheduleRecognition(); }
			}
		};
	}

	/** Replaced in onOpen; declared so the handlers above can call it. */
	private scheduleRecognition: () => void = () => {};

	override onClose(): void {
		this.recognitionRevision++;
		this.pending = false;
		if (this.recognizeTimer !== null) window.clearTimeout(this.recognizeTimer);
		this.contentEl.empty();
	}
}
