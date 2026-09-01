import { Notice, requestUrl, setIcon } from "obsidian";
import { makeDraggable, shieldPanel } from "./panels";

interface Language {
	code: string;
	label: string;
}

export const LANGUAGES: Language[] = [
	{ code: "es", label: "Español" }, { code: "en", label: "English" },
	{ code: "fr", label: "Français" }, { code: "de", label: "Deutsch" },
	{ code: "it", label: "Italiano" }, { code: "pt", label: "Português" },
	{ code: "ca", label: "Català" }, { code: "eu", label: "Euskara" },
	{ code: "gl", label: "Galego" }, { code: "nl", label: "Nederlands" },
	{ code: "pl", label: "Polski" }, { code: "ru", label: "Русский" },
	{ code: "uk", label: "Українська" }, { code: "ar", label: "العربية" },
	{ code: "zh-CN", label: "中文（简体）" }, { code: "ja", label: "日本語" }, { code: "ko", label: "한국어" }
];

const MAX_REQUEST_BYTES = 450;

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

/** Splits on whitespace where possible so each API request stays below the service limit. */
function splitForTranslation(value: string): string[] {
	const parts = value.split(/(\s+)/);
	const chunks: string[] = [];
	let current = "";
	for (const part of parts) {
		if (byteLength(part) > MAX_REQUEST_BYTES) {
			if (current) { chunks.push(current); current = ""; }
			let segment = "";
			for (const char of part) {
				if (byteLength(segment + char) > MAX_REQUEST_BYTES) {
					chunks.push(segment);
					segment = "";
				}
				segment += char;
			}
			if (segment) chunks.push(segment);
		} else if (byteLength(current + part) > MAX_REQUEST_BYTES) {
			chunks.push(current);
			current = part;
		} else {
			current += part;
		}
	}
	if (current) chunks.push(current);
	return chunks.filter(Boolean);
}

function decodeEntities(value: string): string {
	const el = document.createElement("textarea");
	el.innerHTML = value;
	return el.value;
}

/** Uses MyMemory's documented GET endpoint, without requiring a per-user API key. */
export async function translateText(source: string, from: string, to: string): Promise<string> {
	if (!source.trim()) return "";
	if (from === to) return source;
	const chunks = splitForTranslation(source);
	const translated: string[] = [];
	for (const chunk of chunks) {
		const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(`${from}|${to}`)}&mt=1`;
		const response = await requestUrl({ url, method: "GET" });
		const data = response.json as { responseStatus?: number; responseDetails?: string; responseData?: { translatedText?: string } };
		const result = data?.responseData?.translatedText;
		if (response.status >= 400 || data?.responseStatus && data.responseStatus !== 200 || typeof result !== "string") {
			throw new Error(data?.responseDetails || "El servicio de traducción no devolvió un resultado válido.");
		}
		translated.push(decodeEntities(result));
	}
	return translated.join("");
}

/** Where the text to translate comes from. */
export interface TranslationSource {
	text: string;
	kind: "editor" | "selection" | "none";
	/** Number of selected boxes when kind is "selection". */
	count: number;
}

export interface TranslatorHost {
	translateFrom: string;
	translateTo: string;
	setTranslateLanguages(from: string, to: string): void;
	getTranslationSource(): TranslationSource;
	/** Puts the translation back where the source came from (editor or selected boxes). */
	replaceTranslationTarget(text: string): void;
	/** Adds the translation as a new text box on the board. */
	addTranslationToBoard(text: string): void;
	/** Lets the user drag a rectangle over the board and returns the text found there (typed text plus OCR of images, PDFs and ink). */
	captureBoardText(langCode: string, onProgress: (message: string) => void): Promise<string>;
}

/** Floating translator that lives on the board and works on whatever is selected. */
export function createTranslatorPanel(host: TranslatorHost, container: HTMLElement): { open: () => void; toggle: () => void; isOpen: () => boolean } {
	const panel = container.createDiv({ cls: "notelens-translator hidden" });
	shieldPanel(panel);

	const header = panel.createDiv({ cls: "notelens-translator-header" });
	setIcon(header.createSpan({ cls: "notelens-calculator-icon" }), "languages");
	header.createSpan({ cls: "notelens-calculator-title", text: "Traductor" });
	const closeBtn = header.createEl("button", { cls: "notelens-embed-close" });
	setIcon(closeBtn, "x");
	makeDraggable(panel, header, container, "notelens-translator-pos");

	const languages = panel.createDiv({ cls: "notelens-translator-languages" });
	const fromSelect = languages.createEl("select", { cls: "dropdown notelens-translator-select" });
	const swap = languages.createEl("button", { cls: "notelens-nav-btn" });
	setIcon(swap, "arrow-left-right");
	swap.title = "Intercambiar idiomas";
	const toSelect = languages.createEl("select", { cls: "dropdown notelens-translator-select" });
	for (const language of LANGUAGES) {
		fromSelect.createEl("option", { value: language.code, text: language.label });
		toSelect.createEl("option", { value: language.code, text: language.label });
	}
	fromSelect.value = host.translateFrom;
	toSelect.value = host.translateTo;
	const languagesChanged = () => { host.setTranslateLanguages(fromSelect.value, toSelect.value); void run(); };
	fromSelect.onchange = languagesChanged;
	toSelect.onchange = languagesChanged;
	swap.onclick = () => {
		const from = fromSelect.value;
		fromSelect.value = toSelect.value;
		toSelect.value = from;
		if (result.value.trim()) { source.value = result.value; result.value = ""; }
		languagesChanged();
	};

	const sourceRow = panel.createDiv({ cls: "notelens-translator-source-row" });
	const sourceLabel = sourceRow.createDiv({ cls: "notelens-panel-label", text: "Texto" });
	const captureBtn = sourceRow.createEl("button", { cls: "notelens-translator-capture" });
	setIcon(captureBtn.createSpan(), "scan-text");
	captureBtn.createSpan({ text: "Capturar de la pizarra (OCR)" });
	captureBtn.title = "Dibuja un rectángulo sobre la pizarra: se reconoce el texto de imágenes, PDFs y escritura a mano en el idioma de origen y se traduce.";
	const source = panel.createEl("textarea", { cls: "notelens-translator-text" });
	source.placeholder = "Selecciona un cuadro de texto en la pizarra o escribe aquí.";
	source.rows = 4;
	const result = panel.createEl("textarea", { cls: "notelens-translator-text notelens-translator-result" });
	result.placeholder = "Traducción";
	result.rows = 4;
	result.readOnly = false;
	const status = panel.createDiv({ cls: "notelens-translator-status" });

	const actions = panel.createDiv({ cls: "notelens-translator-actions" });
	const translateBtn = actions.createEl("button", { cls: "mod-cta", text: "Traducir" });
	const replaceBtn = actions.createEl("button", { text: "Sustituir" });
	replaceBtn.title = "Cambia el texto original por la traducción";
	const addBtn = actions.createEl("button", { text: "Añadir a la pizarra" });
	addBtn.title = "Crea un cuadro de texto con la traducción junto al original";
	const copyBtn = actions.createEl("button", { text: "Copiar" });

	let current: TranslationSource = { text: "", kind: "none", count: 0 };
	let running = 0;

	const refreshButtons = () => {
		const has = !!result.value.trim();
		replaceBtn.disabled = !has || current.kind === "none";
		addBtn.disabled = !has;
		copyBtn.disabled = !has;
	};

	const run = async () => {
		const text = source.value.trim();
		if (!text) { result.value = ""; status.setText(""); refreshButtons(); return; }
		const id = ++running;
		translateBtn.disabled = true;
		status.setText("Traduciendo…");
		try {
			const translated = await translateText(source.value, fromSelect.value, toSelect.value);
			if (id !== running) return;
			result.value = translated;
			status.setText(current.kind === "selection" ? (current.count > 1 ? `Traducidos ${current.count} cuadros seleccionados.` : "Traducido el cuadro seleccionado.") : current.kind === "editor" ? "Traducido el cuadro que estás editando." : "");
		} catch (error) {
			if (id !== running) return;
			console.error("NoteLens: translation failed", error);
			status.setText("No se pudo traducir. Comprueba la conexión e inténtalo de nuevo.");
		} finally {
			if (id === running) translateBtn.disabled = false;
			refreshButtons();
		}
	};

	/** Pulls the selected text (or the box being edited) into the panel and translates it. */
	const loadFromBoard = () => {
		current = host.getTranslationSource();
		if (current.kind !== "none") {
			source.value = current.text;
			sourceLabel.setText(current.kind === "editor" ? "Cuadro que estás editando" : current.count > 1 ? `${current.count} cuadros seleccionados` : "Cuadro seleccionado");
			void run();
		} else {
			sourceLabel.setText("Texto");
			status.setText(source.value.trim() ? "" : "Selecciona un cuadro en la pizarra, o escribe aquí y pulsa Traducir.");
		}
		refreshButtons();
	};

	translateBtn.onclick = () => void run();
	captureBtn.onclick = async () => {
		captureBtn.disabled = true;
		status.setText("Dibuja un rectángulo sobre la zona que quieres traducir. Esc cancela.");
		try {
			const text = await host.captureBoardText(fromSelect.value, (message) => status.setText(message));
			if (text.trim()) {
				current = { text, kind: "none", count: 0 };
				source.value = text;
				sourceLabel.setText("Texto capturado");
				await run();
			} else {
				status.setText("No se encontró texto en esa zona.");
			}
		} catch (error) {
			console.error("NoteLens: OCR failed", error);
			status.setText(`No se pudo reconocer el texto: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			captureBtn.disabled = false;
		}
	};
	source.addEventListener("input", () => { current = { text: source.value, kind: "none", count: 0 }; sourceLabel.setText("Texto"); refreshButtons(); });
	source.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void run(); } });
	result.addEventListener("input", refreshButtons);
	replaceBtn.onclick = () => { if (result.value.trim()) { host.replaceTranslationTarget(result.value); status.setText("Texto sustituido. Ctrl+Z deshace."); } };
	addBtn.onclick = () => { if (result.value.trim()) { host.addTranslationToBoard(result.value); status.setText("Traducción añadida a la pizarra."); } };
	copyBtn.onclick = async () => {
		if (!result.value.trim()) return;
		try { await navigator.clipboard.writeText(result.value); new Notice("Traducción copiada"); }
		catch { result.focus(); result.select(); document.execCommand("copy"); }
	};

	let open = false;
	const show = (visible: boolean) => { open = visible; panel.toggleClass("hidden", !visible); };
	const api = {
		open: () => { show(true); loadFromBoard(); },
		toggle: () => { if (open) show(false); else api.open(); },
		isOpen: () => open
	};
	closeBtn.onclick = () => show(false);
	refreshButtons();
	return api;
}
