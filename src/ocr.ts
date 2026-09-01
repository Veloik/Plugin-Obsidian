import { createWorker, type Worker } from "tesseract.js";

/**
 * Text recognition with Tesseract, running locally inside Obsidian. The
 * first use downloads the recogniser and the language data (a few MB) and
 * keeps them cached; no text ever leaves the device.
 */

/** Translator language codes → Tesseract language packs. */
export const OCR_LANGS: Record<string, string> = {
	es: "spa", en: "eng", fr: "fra", de: "deu", it: "ita", pt: "por", ca: "cat", eu: "eus", gl: "glg", nl: "nld",
	pl: "pol", ru: "rus", uk: "ukr", ar: "ara", "zh-CN": "chi_sim", ja: "jpn", ko: "kor"
};

let workerPromise: Promise<Worker> | null = null;
let workerLang = "";

async function getWorker(lang: string, onProgress?: (message: string) => void): Promise<Worker> {
	if (!workerPromise) {
		workerLang = lang;
		workerPromise = createWorker(lang, 1, {
			logger: (m: { status: string; progress: number }) => {
				if (!onProgress) return;
				const labels: Record<string, string> = {
					"loading tesseract core": "Cargando el reconocedor…",
					"initializing tesseract": "Iniciando el reconocedor…",
					"loading language traineddata": "Descargando el idioma (solo la primera vez)…",
					"initializing api": "Preparando el idioma…",
					"recognizing text": "Reconociendo texto…"
				};
				const label = labels[m.status] ?? m.status;
				onProgress(m.progress > 0 && m.progress < 1 ? `${label} ${Math.round(m.progress * 100)}%` : label);
			}
		});
	}
	const worker = await workerPromise;
	if (workerLang !== lang) {
		onProgress?.("Cambiando de idioma…");
		await worker.reinitialize(lang);
		workerLang = lang;
	}
	return worker;
}

/** Reads the text in a canvas; `langCode` is a translator code such as "es". */
export async function recognizeImage(canvas: HTMLCanvasElement, langCode: string, onProgress?: (message: string) => void): Promise<string> {
	const lang = OCR_LANGS[langCode] ?? "eng";
	try {
		const worker = await getWorker(lang, onProgress);
		const { data } = await worker.recognize(canvas);
		return data.text.replace(/[ \t]+\n/g, "\n").trim();
	} catch (error) {
		// A failed download or a crashed worker must not poison later attempts.
		workerPromise = null;
		throw error;
	}
}
