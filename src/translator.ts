import { App, Notice, requestUrl, setIcon } from "obsidian";
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

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

/** Splits on whitespace where possible so each request stays below the service limit. */
function splitForTranslation(value: string, maxBytes: number): string[] {
	const parts = value.split(/(\s+)/);
	const chunks: string[] = [];
	let current = "";
	for (const part of parts) {
		if (byteLength(part) > maxBytes) {
			if (current) { chunks.push(current); current = ""; }
			let segment = "";
			for (const char of part) {
				if (byteLength(segment + char) > maxBytes) {
					chunks.push(segment);
					segment = "";
				}
				segment += char;
			}
			if (segment) chunks.push(segment);
		} else if (byteLength(current + part) > maxBytes) {
			chunks.push(current);
			current = part;
		} else {
			current += part;
		}
	}
	if (current) chunks.push(current);
	return chunks.filter(Boolean);
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
};

/**
 * MyMemory answers with HTML entities (&quot;, &#39;) inside otherwise plain text.
 * Decoding them by hand keeps the reply away from the DOM: parsing it as markup
 * would run whatever the service decided to send back.
 */
function decodeEntities(value: string): string {
	return value.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
		if (body[0] === "#") {
			const hex = body[1] === "x" || body[1] === "X";
			const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
			// Lone surrogates and out-of-range points would throw; leave those written out.
			if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
			if (code >= 0xd800 && code <= 0xdfff) return match;
			return String.fromCodePoint(code);
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? match;
	});
}

/**
 * Free translation with no account behind it.
 *
 * Two public endpoints answer without a key, a sign-up or a daily cap, and both
 * come back in well under a second — which is the whole point: a model running
 * on the computer translates a paragraph in tens of seconds, and waiting that
 * long to read one sentence is not worth the privacy for most notes. MyMemory
 * stays behind them as the last door, and it is the only one with a quota.
 */
async function translateFast(source: string, from: string, to: string, endpoint: "gtx" | "dict"): Promise<string> {
	const out: string[] = [];
	for (const chunk of splitForTranslation(source, 1400)) {
		const query = encodeURIComponent(chunk);
		const url = endpoint === "gtx"
			? `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${query}`
			: `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${from}&tl=${to}&q=${query}`;
		const response = await requestUrl({ url, method: "GET", throw: false });
		if (response.status >= 400) throw new Error(`El servicio de traducción respondió ${response.status}.`);
		let data: unknown;
		try {
			data = JSON.parse(response.text);
		} catch {
			throw new Error("El servicio de traducción devolvió una respuesta ilegible.");
		}
		// gtx answers [[[piece, original, …], …], …]; the dictionary endpoint answers ["texto"].
		const pieces = endpoint === "gtx"
			? (Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [])
				.map(part => (Array.isArray(part) && typeof part[0] === "string" ? part[0] : ""))
			: (Array.isArray(data) ? data : []).map(part => (typeof part === "string" ? part : ""));
		const text = pieces.join("");
		if (!text.trim()) throw new Error("El servicio no ha devuelto ninguna traducción para este texto.");
		out.push(text);
	}
	return out.join("");
}

/** Uses MyMemory's documented GET endpoint, without requiring a per-user API key. */
async function translateViaMyMemory(source: string, from: string, to: string): Promise<string> {
	const chunks = splitForTranslation(source, 450);
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

/**
 * Translates on the web, trying the instant services first and MyMemory last.
 * Every one of them is free and needs no key; the first that answers wins.
 */
export async function translateText(source: string, from: string, to: string): Promise<string> {
	if (!source.trim()) return "";
	if (from === to) return source;
	let last: Error | null = null;
	for (const attempt of [
		() => translateFast(source, from, to, "gtx"),
		() => translateFast(source, from, to, "dict"),
		() => translateViaMyMemory(source, from, to)
	]) {
		try {
			const text = await attempt();
			if (text.trim()) return text;
		} catch (error) {
			last = error instanceof Error ? error : new Error(String(error));
		}
	}
	throw last ?? new Error("No se pudo traducir. Comprueba la conexión e inténtalo de nuevo.");
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
	/** The view owning the panel; its vault decides where the position is remembered. */
	readonly app: App;
	/** Local model settings, so translating can run on this computer. */
	aiBaseUrl: string;
	aiModel: string;
	/** When true nothing is sent anywhere: only a model on this computer translates. */
	translationPrivateOnly: boolean;
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
	makeDraggable(host.app, panel, header, container, "notelens-translator-pos");

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
			const onModel = async () => {
				status.setText(tr("Traduciendo con tu modelo local…"));
				return new LocalModelClient(host as never).translate(
					source.value,
					LANGUAGE_NAMES[fromSelect.value] ?? fromSelect.value,
					LANGUAGE_NAMES[toSelect.value] ?? toSelect.value
				);
			};
			let translated: string | null = null;
			let engine = "";
			if (host.translationPrivateOnly) {
				translated = await onModel();
				engine = tr("modelo local");
				if (!translated) throw new Error("No hay ningún modelo local disponible y has pedido traducir solo en tu ordenador. Descarga uno o desactiva esa opción en los ajustes.");
			} else {
				// The free services first: they answer in a moment, where a model on
				// this computer takes long enough to give up on reading the sentence.
				let webError: Error | null = null;
				try {
					translated = await translateText(source.value, fromSelect.value, toSelect.value);
					engine = tr("traducción instantánea");
				} catch (error) {
					webError = error instanceof Error ? error : new Error(String(error));
				}
				if (!translated) {
					// Off line, or every service refused: a local model is better than nothing.
					try {
						translated = await onModel();
						if (translated) engine = tr("modelo local");
					} catch { /* no model either: report what the web said */ }
				}
				if (!translated && webError) throw webError;
			}
			if (id !== running) return;
			if (!translated) throw new Error("No se pudo traducir. Comprueba la conexión e inténtalo de nuevo.");
			result.value = translated;
			const targetStatus = current.kind === "selection"
				? (current.count > 1 ? tr("Traducidos {p0} cuadros seleccionados", { p0: current.count }) : tr("Traducido el cuadro seleccionado"))
				: current.kind === "editor" ? tr("Traducido el cuadro que estás editando") : tr("Traducción lista");
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
