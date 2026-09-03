import { PSM, createWorker, type Worker } from "tesseract.js";
import { pickFormulaCandidate } from "./ink-math";

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


// ---------------------------------------------------------------------------
// Formula recognition
// ---------------------------------------------------------------------------

/** Characters a formula can contain; anything else is a misread. */
// ASCII only: a whitelist carrying Greek or maths symbols made Tesseract 5
// return nothing at all, and those characters are normalised afterwards.
const MATH_WHITELIST = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-=/*^_().,<>[]{}|!";

let mathWorker: Promise<Worker> | null = null;

/**
 * A worker tuned for formulas. Tesseract's "equ" pack looks tempting but it is
 * a legacy Tesseract 3 model: under the LSTM engine that tesseract.js uses it
 * silently recognises nothing, so English plus single-line segmentation and an
 * ASCII whitelist is what actually reads maths here. Vector handwriting is
 * handled before this worker; this path is mainly for photos and rare glyphs.
 */
async function getMathWorker(onProgress?: (message: string) => void): Promise<Worker> {
	if (mathWorker) return mathWorker;
	mathWorker = (async () => {
		const logger = (m: { status: string; progress: number }) => {
			if (!onProgress) return;
			const labels: Record<string, string> = {
				"loading tesseract core": "Cargando el reconocedor…",
				"initializing tesseract": "Iniciando el reconocedor…",
				"loading language traineddata": "Descargando el modelo de ecuaciones (solo la primera vez)…",
				"initializing api": "Preparando el modelo…",
				"recognizing text": "Leyendo la ecuación…"
			};
			const label = labels[m.status] ?? m.status;
			onProgress(m.progress > 0 && m.progress < 1 ? `${label} ${Math.round(m.progress * 100)}%` : label);
		};
		let worker: Worker;
		try {
			// The equation pack is not in the default CDN for this version, but it
			// is in Tesseract's own tessdata mirror, so ask for it there.
			worker = await createWorker("eng", 1, { logger });
		} catch {
			onProgress?.("El modelo de ecuaciones no está disponible; uso el general.");
			worker = await createWorker("eng", 1, { logger });
		}
		await worker.setParameters({
			// One line of maths, not a page of prose.
			tessedit_pageseg_mode: PSM.SINGLE_LINE,
			tessedit_char_whitelist: MATH_WHITELIST,
			preserve_interword_spaces: "1"
		});
		return worker;
	})();
	try {
		return await mathWorker;
	} catch (error) {
		mathWorker = null;
		throw error;
	}
}

/**
 * Converts any board colour to black ink on white paper, crops the empty
 * border and upscales the useful region. Sampling the border as the paper
 * colour also fixes white pen on a dark NoteLens page, which the old fixed
 * luminance threshold turned into a solid black rectangle.
 */
function prepareForMath(source: HTMLCanvasElement): HTMLCanvasElement {
	const scratch = createEl("canvas");
	scratch.width = Math.max(1, source.width);
	scratch.height = Math.max(1, source.height);
	const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
	if (!scratchCtx) return source;
	scratchCtx.fillStyle = "#ffffff";
	scratchCtx.fillRect(0, 0, scratch.width, scratch.height);
	scratchCtx.drawImage(source, 0, 0);

	let pixels: ImageData;
	try { pixels = scratchCtx.getImageData(0, 0, scratch.width, scratch.height); }
	catch { return source; }
	const lumaAt = (x: number, y: number): number => {
		const i = (y * scratch.width + x) * 4;
		return 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2];
	};
	const border: number[] = [];
	const step = Math.max(1, Math.floor(Math.min(scratch.width, scratch.height) / 90));
	for (let x = 0; x < scratch.width; x += step) { border.push(lumaAt(x, 0), lumaAt(x, scratch.height - 1)); }
	for (let y = 0; y < scratch.height; y += step) { border.push(lumaAt(0, y), lumaAt(scratch.width - 1, y)); }
	border.sort((a, b) => a - b);
	const paper = border[Math.floor(border.length / 2)] ?? 255;

	const histogram = new Uint32Array(256);
	for (let y = 0; y < scratch.height; y++) for (let x = 0; x < scratch.width; x++) histogram[Math.round(Math.abs(lumaAt(x, y) - paper))]++;
	const total = scratch.width * scratch.height;
	let sum = 0;
	for (let i = 0; i < 256; i++) sum += i * histogram[i];
	let backgroundWeight = 0, backgroundSum = 0, bestVariance = -1, otsu = 28;
	for (let threshold = 1; threshold < 255; threshold++) {
		backgroundWeight += histogram[threshold];
		if (!backgroundWeight) continue;
		const foregroundWeight = total - backgroundWeight;
		if (!foregroundWeight) break;
		backgroundSum += threshold * histogram[threshold];
		const meanBackground = backgroundSum / backgroundWeight;
		const meanForeground = (sum - backgroundSum) / foregroundWeight;
		const variance = backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
		if (variance > bestVariance) { bestVariance = variance; otsu = threshold; }
	}
	const contrastThreshold = Math.max(24, Math.min(105, otsu));
	const mask = new Uint8Array(total);
	let minX = scratch.width, minY = scratch.height, maxX = -1, maxY = -1;
	for (let y = 0; y < scratch.height; y++) for (let x = 0; x < scratch.width; x++) {
		const foreground = Math.abs(lumaAt(x, y) - paper) >= contrastThreshold;
		if (!foreground) continue;
		mask[y * scratch.width + x] = 1;
		minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
	}
	if (maxX < minX) return scratch;

	const binary = createEl("canvas");
	binary.width = scratch.width;
	binary.height = scratch.height;
	const binaryCtx = binary.getContext("2d");
	if (!binaryCtx) return scratch;
	const binaryImage = binaryCtx.createImageData(binary.width, binary.height);
	for (let i = 0; i < mask.length; i++) {
		const value = mask[i] ? 0 : 255;
		const at = i * 4;
		binaryImage.data[at] = binaryImage.data[at + 1] = binaryImage.data[at + 2] = value;
		binaryImage.data[at + 3] = 255;
	}
	binaryCtx.putImageData(binaryImage, 0, 0);

	const cropPad = Math.max(4, Math.round(Math.max(maxX - minX, maxY - minY) * 0.035));
	minX = Math.max(0, minX - cropPad); minY = Math.max(0, minY - cropPad);
	maxX = Math.min(binary.width - 1, maxX + cropPad); maxY = Math.min(binary.height - 1, maxY + cropPad);
	const cropW = maxX - minX + 1, cropH = maxY - minY + 1;
	const target = 1400;
	const scale = Math.min(4, Math.max(1.4, target / Math.max(cropW, cropH)));
	const outerPad = 36;
	const out = createEl("canvas");
	out.width = Math.round(cropW * scale) + outerPad * 2;
	out.height = Math.round(cropH * scale) + outerPad * 2;
	const outCtx = out.getContext("2d");
	if (!outCtx) return binary;
	outCtx.fillStyle = "#ffffff";
	outCtx.fillRect(0, 0, out.width, out.height);
	outCtx.imageSmoothingEnabled = false;
	outCtx.drawImage(binary, minX, minY, cropW, cropH, outerPad, outerPad, out.width - outerPad * 2, out.height - outerPad * 2);
	return out;
}

interface FractionRegion { x0: number; x1: number; y0: number; y1: number }

/** Detects a long bar with real ink both above and below it. */
function detectFractionRegion(canvas: HTMLCanvasElement): FractionRegion | null {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return null;
	const { width, height } = canvas;
	const data = ctx.getImageData(0, 0, width, height).data;
	const dark = (x: number, y: number) => data[(y * width + x) * 4] < 100;
	let best: FractionRegion | null = null;
	let bestWidth = 0;
	for (let y = Math.floor(height * 0.16); y < Math.ceil(height * 0.84); y++) {
		let start = -1, gaps = 0;
		for (let x = 1; x < width - 1; x++) {
			if (dark(x, y)) { if (start < 0) start = x; gaps = 0; }
			else if (start >= 0 && ++gaps > 2) {
				const end = x - gaps;
				if (end - start > bestWidth) { bestWidth = end - start; best = { x0: start, x1: end, y0: y, y1: y }; }
				start = -1; gaps = 0;
			}
		}
	}
	if (!best || bestWidth < width * 0.2) return null;
	for (let y = best.y0 - 1; y >= 0 && y >= best.y0 - Math.max(3, height * 0.025); y--) {
		let hits = 0;
		for (let x = best.x0; x <= best.x1; x++) if (dark(x, y)) hits++;
		if (hits > bestWidth * 0.55) best.y0 = y; else break;
	}
	for (let y = best.y1 + 1; y < height && y <= best.y1 + Math.max(3, height * 0.025); y++) {
		let hits = 0;
		for (let x = best.x0; x <= best.x1; x++) if (dark(x, y)) hits++;
		if (hits > bestWidth * 0.55) best.y1 = y; else break;
	}
	const occupiedRows = (from: number, to: number): number => {
		let rows = 0;
		for (let y = Math.max(0, from); y < Math.min(height, to); y++) {
			let hits = 0;
			for (let x = best!.x0; x <= best!.x1; x++) if (dark(x, y)) hits++;
			if (hits > 2 && hits < bestWidth * 0.72) rows++;
		}
		return rows;
	};
	if (occupiedRows(0, best.y0 - 3) < Math.max(5, height * 0.025)) return null;
	if (occupiedRows(best.y1 + 4, height) < Math.max(5, height * 0.025)) return null;
	return best;
}

function cropCanvas(source: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement | null {
	x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
	w = Math.min(source.width - x, Math.ceil(w)); h = Math.min(source.height - y, Math.ceil(h));
	if (w < 5 || h < 5) return null;
	const out = createEl("canvas");
	out.width = w; out.height = h;
	const ctx = out.getContext("2d", { willReadFrequently: true });
	if (!ctx) return null;
	ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
	const pixels = ctx.getImageData(0, 0, w, h).data;
	let dark = 0;
	for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 120) dark++;
	return dark > 8 ? out : null;
}

async function recognizeMathLine(worker: Worker, canvas: HTMLCanvasElement, onProgress?: (message: string) => void): Promise<{ text: string; confidence: number }> {
	await worker.setParameters({
		tessedit_pageseg_mode: PSM.SINGLE_LINE,
		tessedit_char_whitelist: MATH_WHITELIST,
		preserve_interword_spaces: "1",
		user_defined_dpi: "300"
	});
	const { data } = await worker.recognize(canvas);
	onProgress?.("Interpretando símbolos y estructura…");
	return { text: data.text.replace(/\s+/g, " ").trim(), confidence: Number(data.confidence) || 0 };
}

/** Reads a handwritten or printed formula and returns local LaTeX/AsciiMath. */
export async function recognizeFormula(canvas: HTMLCanvasElement, onProgress?: (message: string) => void): Promise<string> {
	try {
		const worker = await getMathWorker(onProgress);
		const prepared = prepareForMath(canvas);
		const whole = await recognizeMathLine(worker, prepared, onProgress);
		const candidates: { source: string; bonus?: number }[] = [{ source: whole.text, bonus: whole.confidence / 22 }];
		const fraction = detectFractionRegion(prepared);
		if (fraction) {
			onProgress?.("He detectado una fracción; separando numerador y denominador…");
			const pad = Math.max(10, Math.round(prepared.width * 0.012));
			const numeratorCanvas = cropCanvas(prepared, fraction.x0 - pad, 0, fraction.x1 - fraction.x0 + pad * 2, fraction.y0 - 2);
			const denominatorCanvas = cropCanvas(prepared, fraction.x0 - pad, fraction.y1 + 2, fraction.x1 - fraction.x0 + pad * 2, prepared.height - fraction.y1 - 2);
			if (numeratorCanvas && denominatorCanvas) {
				const numerator = await recognizeMathLine(worker, numeratorCanvas, onProgress);
				const denominator = await recognizeMathLine(worker, denominatorCanvas, onProgress);
				const leftCanvas = cropCanvas(prepared, 0, 0, fraction.x0 - pad, prepared.height);
				const rightCanvas = cropCanvas(prepared, fraction.x1 + pad, 0, prepared.width - fraction.x1 - pad, prepared.height);
				const left = leftCanvas ? (await recognizeMathLine(worker, leftCanvas, onProgress)).text : "";
				const right = rightCanvas ? (await recognizeMathLine(worker, rightCanvas, onProgress)).text : "";
				candidates.push({ source: [left, `\\frac{${numerator.text || "?"}}{${denominator.text || "?"}}`, right].filter(Boolean).join(" "), bonus: 9 });
			}
		}
		return pickFormulaCandidate(candidates)
			// A printed caret is commonly split into `x*` by English OCR.
			.replace(/\b([A-Z])x\*?(\d+)\b/g, (_match, base: string, exponent: string) => `${base.toLowerCase()}^${exponent}`)
			.replace(/[\u2212\u2013\u2014]/g, "-")
			.trim();
	} catch (error) {
		mathWorker = null;
		throw error;
	}
}
