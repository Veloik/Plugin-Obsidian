import { Notice, requestUrl, setIcon } from "obsidian";
import { LocalModelClient } from "./assistant";
import { makeDraggable, shieldPanel } from "./panels";
import { tr } from "./i18n";

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
		// throw:false so the service's own explanation reaches the user instead of
		// a bare HTTP error: its quota and language messages are the useful part.
		const response = await requestUrl({ url, method: "GET", throw: false });
		const data = response.json as {
			responseStatus?: number | string;
			responseDetails?: string;
			responseData?: { translatedText?: string };
			matches?: { translation?: string; quality?: number | string }[];
		};
		const status = Number(data?.responseStatus ?? response.status);
		const details = (data?.responseDetails || "").trim();
		if (response.status >= 400 || (Number.isFinite(status) && status !== 200)) {
			if (/QUOTA|ALL AVAILABLE FREE TRANSLATIONS/i.test(details)) {
				throw new Error("El servicio gratuito de traducción ha agotado su cuota diaria para esta red. Vuelve a intentarlo mañana.");
			}
			if (/DISTINCT LANGUAGES/i.test(details)) {
				throw new Error("Elige dos idiomas distintos para traducir.");
			}
			if (/INVALID LANGUAGE|NOT SUPPORTED/i.test(details)) {
				throw new Error(`El servicio no admite la combinación ${from} → ${to}.`);
			}
			throw new Error(details || `El servicio de traducción respondió ${response.status}.`);
		}
		let result = typeof data?.responseData?.translatedText === "string" ? data.responseData.translatedText : "";
		if (!result.trim()) {
			// It sometimes answers with an empty string but a usable match.
			const best = (data?.matches ?? [])
				.filter(match => typeof match.translation === "string" && match.translation.trim())
				.sort((a, b) => Number(b.quality ?? 0) - Number(a.quality ?? 0))[0];
			result = best?.translation ?? "";
		}
		if (!result.trim()) throw new Error("El servicio no ha devuelto ninguna traducción para este texto.");
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

/** Human names for the prompt, so the model knows what it is translating. */
const LANGUAGE_NAMES: Record<string, string> = {
	es: "español", en: "inglés", fr: "francés", de: "alemán", it: "italiano", pt: "portugués", ca: "catalán",
	eu: "euskera", gl: "gallego", nl: "neerlandés", pl: "polaco", ru: "ruso", uk: "ucraniano", ar: "árabe",
	"zh-CN": "chino simplificado", ja: "japonés", ko: "coreano"
};

export interface TranslatorHost {
	/** Local model settings, so translating can run on this computer. */
	aiBaseUrl: string;
	aiModel: string;
	/** When true the web service is never used, so nothing depends on a quota. */
	translationLocalOnly: boolean;
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
	header.createSpan({ cls: "notelens-calculator-title", text: tr("Traductor") });
	const closeBtn = header.createEl("button", { cls: "notelens-embed-close" });
	setIcon(closeBtn, "x");
	makeDraggable(panel, header, container, "notelens-translator-pos");

	const languages = panel.createDiv({ cls: "notelens-translator-languages" });
	const fromSelect = languages.createEl("select", { cls: "dropdown notelens-translator-select" });
	const swap = languages.createEl("button", { cls: "notelens-nav-btn" });
	setIcon(swap, "arrow-left-right");
	swap.title = tr("Intercambiar idiomas");
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
	const sourceLabel = sourceRow.createDiv({ cls: "notelens-panel-label", text: tr("Texto") });
	const captureBtn = sourceRow.createEl("button", { cls: "notelens-translator-capture" });
	setIcon(captureBtn.createSpan(), "scan-text");
	captureBtn.createSpan({ text: tr("Capturar de la pizarra (OCR)") });
	captureBtn.title = tr("Dibuja un rectángulo sobre la pizarra: se reconoce el texto de imágenes, PDFs y escritura a mano en el idioma de origen y se traduce.");
	const source = panel.createEl("textarea", { cls: "notelens-translator-text" });
	source.placeholder = tr("Selecciona un cuadro de texto en la pizarra o escribe aquí.");
	source.rows = 4;
	const result = panel.createEl("textarea", { cls: "notelens-translator-text notelens-translator-result" });
	result.placeholder = tr("Traducción");
	result.rows = 4;
	result.readOnly = false;
	const status = panel.createDiv({ cls: "notelens-translator-status" });

	const actions = panel.createDiv({ cls: "notelens-translator-actions" });
	const translateBtn = actions.createEl("button", { cls: "mod-cta", text: tr("Traducir") });
	const replaceBtn = actions.createEl("button", { text: tr("Sustituir") });
	replaceBtn.title = tr("Cambia el texto original por la traducción");
	const addBtn = actions.createEl("button", { text: tr("Añadir a la pizarra") });
	addBtn.title = tr("Crea un cuadro de texto con la traducción junto al original");
	const copyBtn = actions.createEl("button", { text: tr("Copiar") });

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
		status.setText(tr("Traduciendo…"));
		try {
			// A model on this computer first: free, offline and with no daily cap.
			let translated: string | null = null;
			let engine = "";
			try {
				const client = new LocalModelClient(host as never);
				status.setText(tr("Traduciendo con tu modelo local…"));
				translated = await client.translate(
					source.value,
					LANGUAGE_NAMES[fromSelect.value] ?? fromSelect.value,
					LANGUAGE_NAMES[toSelect.value] ?? toSelect.value
				);
				if (translated) engine = "modelo local";
			} catch { /* no local model: use the web service */ }
			if (!translated && host.translationLocalOnly) {
				throw new Error("No hay ningún modelo local disponible y has pedido traducir solo en local. Descarga uno o desactiva esa opción en los ajustes.");
			}
			if (!translated) {
				status.setText(tr("Traduciendo con el servicio gratuito…"));
				translated = await translateText(source.value, fromSelect.value, toSelect.value);
				engine = "servicio web";
			}
			if (id !== running) return;
			result.value = translated;
			const targetStatus = current.kind === "selection"
				? (current.count > 1 ? `Traducidos ${current.count} cuadros seleccionados` : "Traducido el cuadro seleccionado")
				: current.kind === "editor" ? "Traducido el cuadro que estás editando" : "Traducción lista";
			status.setText(tr("{p0} · {p1}.", { p0: targetStatus, p1: engine }));
		} catch (error) {
			if (id !== running) return;
			console.error("NoteLens: translation failed", error);
			// The service explains itself (quota, unsupported pair); show that
			// rather than a generic line the user cannot act on.
			const reason = error instanceof Error ? error.message.trim() : "";
			status.setText(reason || tr("No se pudo traducir. Comprueba la conexión e inténtalo de nuevo."));
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
			sourceLabel.setText(current.kind === "editor" ? tr("Cuadro que estás editando") : current.count > 1 ? tr("{p0} cuadros seleccionados", { p0: current.count }) : tr("Cuadro seleccionado"));
			void run();
		} else {
			sourceLabel.setText(tr("Texto"));
			status.setText(source.value.trim() ? "" : tr("Selecciona un cuadro en la pizarra, o escribe aquí y pulsa Traducir."));
		}
		refreshButtons();
	};

	translateBtn.onclick = () => void run();
	captureBtn.onclick = async () => {
		captureBtn.disabled = true;
		status.setText(tr("Dibuja un rectángulo sobre la zona que quieres traducir. Esc cancela."));
		try {
			const text = await host.captureBoardText(fromSelect.value, (message) => status.setText(message));
			if (text.trim()) {
				current = { text, kind: "none", count: 0 };
				source.value = text;
				sourceLabel.setText(tr("Texto capturado"));
				await run();
			} else {
				status.setText(tr("No se encontró texto en esa zona."));
			}
		} catch (error) {
			console.error("NoteLens: OCR failed", error);
			status.setText(tr("No se pudo reconocer el texto: {p0}", { p0: error instanceof Error ? error.message : String(error) }));
		} finally {
			captureBtn.disabled = false;
		}
	};
	source.addEventListener("input", () => { current = { text: source.value, kind: "none", count: 0 }; sourceLabel.setText(tr("Texto")); refreshButtons(); });
	source.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void run(); } });
	result.addEventListener("input", refreshButtons);
	replaceBtn.onclick = () => { if (result.value.trim()) { host.replaceTranslationTarget(result.value); status.setText(tr("Texto sustituido. Ctrl+Z deshace.")); } };
	addBtn.onclick = () => { if (result.value.trim()) { host.addTranslationToBoard(result.value); status.setText(tr("Traducción añadida a la pizarra.")); } };
	copyBtn.onclick = async () => {
		if (!result.value.trim()) return;
		try { await navigator.clipboard.writeText(result.value); new Notice(tr("Traducción copiada")); }
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
