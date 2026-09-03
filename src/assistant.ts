import { Notice, requestUrl, setIcon } from "obsidian";
import { CAT_SPRITES } from "./cat-sprites";
import { LocalStudyTool, runLocalStudyTool } from "./local-intelligence";
import { recognizeInkFormula } from "./ink-math";

export type PetMood = "idle" | "thinking" | "drawing" | "sleeping";

/** Something the assistant asked to be placed on the board. */
export interface AssistantAction {
	kind: "posit" | "latex" | "texto" | "tarea";
	body: string;
	color?: string;
}

export type BoardUtility = "organize-selection" | "polish-ink";

export interface AssistantHost {
	/** Base URL of the local model server, e.g. http://localhost:11434 */
	aiBaseUrl: string;
	/** Model name to run; empty means "pick the best one available". */
	aiModel: string;
	/** What the pet is called. */
	assistantName: string;
	setAiModel(model: string): void;
	setAssistantName(name: string): void;
	/** Plain text of everything on the current page, used as optional context. */
	getBoardText(): string;
	/** Readable content in the active selection; empty means use the page. */
	getSelectionText(): string;
	/** Runs one action from the model and reports what happened, in Spanish. */
	runAssistantAction(action: AssistantAction): string;
	/** Deterministic board operations that do not need a model. */
	runBoardUtility(utility: BoardUtility): string;
	/** Opens the region-aware, offline equation reader. */
	openFormulaReader(): void;
	/** Where the pet sits, as fractions of the board; nulls mean the default corner. */
	getPetPosition(): { x: number | null; y: number | null };
	setPetPosition(x: number, y: number): void;
	/** How big to draw the pet, and whether it may speak. */
	petScale: number;
	petBubbles: boolean;
	/** Whether the board's text goes to the model without asking each time. */
	aiUseBoardContext: boolean;
}

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	images?: string[];
}

interface ServerFlavour {
	kind: "ollama" | "openai";
	models: string[];
}

const VISION_HINTS = ["llava", "bakllava", "moondream", "minicpm", "qwen2-vl", "qwen2.5vl", "qwen2.5-vl", "qwen3-vl", "qwen3vl", "vision", "gemma3", "pixtral", "internvl", "granite3.2-vision", "smolvlm"];

/**
 * Multimodal models worth suggesting, smallest first. Leen only works with
 * these: you can answer him by drawing, and a text-only model cannot see it.
 * Sizes are the usual 4-bit downloads; the RAM figure leaves room for Obsidian.
 */
export interface VisionOption {
	model: string;
	params: string;
	downloadGb: number;
	minRamGb: number;
	note: string;
}

export const VISION_CATALOGUE: VisionOption[] = [
	{ model: "moondream", params: "1.8B", downloadGb: 1.7, minRamGb: 4, note: "el más ligero; entiende dibujos sencillos" },
	{ model: "smolvlm", params: "2.2B", downloadGb: 1.8, minRamGb: 5, note: "muy rápido, respuestas cortas" },
	{ model: "qwen2.5vl:3b", params: "3B", downloadGb: 3.2, minRamGb: 6, note: "buen lector de texto escrito a mano" },
	{ model: "llava-phi3", params: "3.8B", downloadGb: 2.9, minRamGb: 6, note: "equilibrado para portátiles modestos" },
	{ model: "gemma3:4b", params: "4B", downloadGb: 3.3, minRamGb: 8, note: "de Google, buen razonamiento para su tamaño" },
	{ model: "llava:7b", params: "7B", downloadGb: 4.7, minRamGb: 10, note: "el clásico; describe imágenes con detalle" },
	{ model: "minicpm-v", params: "8B", downloadGb: 5.5, minRamGb: 12, note: "muy bueno leyendo apuntes a mano" },
	{ model: "qwen2.5vl:7b", params: "7B", downloadGb: 6.0, minRamGb: 12, note: "el más equilibrado si tu equipo da" },
	{ model: "gemma3:12b", params: "12B", downloadGb: 8.9, minRamGb: 20, note: "más listo, necesita bastante memoria" },
	{ model: "qwen2.5vl:32b", params: "32B", downloadGb: 21, minRamGb: 40, note: "solo para equipos grandes" }
];

/** The catalogue entries this computer can actually run, best last. */
export function visionOptionsFor(memoryGb = detectMemoryGb()): VisionOption[] {
	return VISION_CATALOGUE.filter(option => option.minRamGb <= memoryGb);
}
const CODE_HINTS = ["coder", "codellama", "starcoder", "deepseek-coder", "codegemma"];
const EMBED_HINTS = ["embed", "nomic-embed", "bge-", "e5-", "minilm"];

export const supportsImages = (model: string): boolean => VISION_HINTS.some(hint => model.toLowerCase().includes(hint));

/** What this computer can comfortably run, in GB of RAM. */
export function detectMemoryGb(): number {
	try {
		// Obsidian runs on Electron, so the real figure is available.
		const os = (window as unknown as { require?: (id: string) => { totalmem(): number } }).require?.("os");
		if (os?.totalmem) return Math.round(os.totalmem() / 1024 ** 3);
	} catch { /* not Electron, fall back to the browser hint */ }
	const hint = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
	return hint ? hint * 2 : 8;
}

/**
 * The multimodal model to suggest for this machine. Vision is the default
 * because the chat lets you answer by drawing, and a text-only model cannot
 * see it. Sizes assume the usual 4-bit quantisations.
 */
export function recommendedVisionModel(memoryGb = detectMemoryGb()): { model: string; pull: string; why: string } {
	const fits = visionOptionsFor(memoryGb);
	// The biggest that fits is not the best default: past ~7B the wait per answer
	// grows faster than the quality, so aim for the sweet spot and let the user
	// pick something heavier from the list if they want it.
	const sweetSpot = fits.filter(option => option.downloadGb <= 6.5);
	const pick = sweetSpot[sweetSpot.length - 1] ?? fits[0] ?? VISION_CATALOGUE[0];
	return {
		model: pick.model,
		pull: `ollama pull ${pick.model}`,
		why: `${pick.params}, ${pick.downloadGb} GB de descarga · ${pick.note}`
	};
}

/** Billions of parameters read from a model name, e.g. "qwen2.5:7b" -> 7. */
function parameterCount(model: string): number {
	const match = /(\d+(?:\.\d+)?)\s*b\b/i.exec(model.replace(/[:_-]/g, " "));
	return match ? parseFloat(match[1]) : 0;
}

/**
 * Ranks the models a local server offers for studying: general chat models win,
 * mid-sized ones beat huge ones because they answer fast on a laptop, and
 * embedding-only models are excluded because they cannot chat at all.
 */
/**
 * Ranks models for text-only work such as translating. Unlike the assistant's
 * own ranking this keeps text models, because translation needs no eyes.
 */
export function rankTextModels(models: string[], memoryGb = detectMemoryGb()): string[] {
	const comfortableB = Math.max(3, (memoryGb - 4) / 0.7);
	return models
		.filter(model => !EMBED_HINTS.some(hint => model.toLowerCase().includes(hint)))
		.map(model => {
			const name = model.toLowerCase();
			const size = parameterCount(name);
			let score = 50;
			if (size === 0) score += 5;
			else if (size <= comfortableB) score += 28;
			else if (size <= comfortableB * 1.5) score -= 8;
			else score -= 30;
			if (CODE_HINTS.some(hint => name.includes(hint))) score -= 25;
			if (/qwen|llama3|mistral|gemma|phi|aya|nous/.test(name)) score += 10;
			// Multilingual families are worth more when the job is translation.
			if (/aya|qwen|gemma|mistral/.test(name)) score += 6;
			return { model, score };
		})
		.sort((a, b) => b.score - a.score)
		.map(entry => entry.model);
}

export function rankModels(models: string[], memoryGb = detectMemoryGb()): { model: string; score: number; reason: string }[] {
	// Roughly what a 4-bit model needs, leaving room for Obsidian itself.
	const comfortableB = Math.max(3, (memoryGb - 4) / 0.7);
	return models
		.filter(model => !EMBED_HINTS.some(hint => model.toLowerCase().includes(hint)))
		.map(model => {
			const name = model.toLowerCase();
			const size = parameterCount(name);
			let score = 50;
			const notes: string[] = [];
			if (size === 0) { notes.push("tamaño desconocido"); }
			else if (size <= comfortableB * 0.6) { score += 22; notes.push(`${size}B, va sobrado en tu equipo`); }
			else if (size <= comfortableB) { score += 28; notes.push(`${size}B, buen equilibrio para tus ${memoryGb} GB`); }
			else if (size <= comfortableB * 1.5) { score -= 8; notes.push(`${size}B, justo para tus ${memoryGb} GB`); }
			else { score -= 30; notes.push(`${size}B, demasiado para tus ${memoryGb} GB`); }
			if (CODE_HINTS.some(hint => name.includes(hint))) { score -= 20; notes.push("orientado a código"); }
			const fits = size === 0 || size <= comfortableB * 1.5;
			if (!fits) notes.push("grande para tu equipo");
			if (name.includes("instruct") || name.includes("chat")) { score += 6; }
			if (/llama3|qwen2\.5|mistral|gemma|phi/.test(name)) { score += 8; notes.push("familia probada para estudiar"); }
			return { model, score, reason: notes.join(" · ") || "modelo general" };
		})
		.sort((a, b) => b.score - a.score);
}

const trimUrl = (url: string): string => url.trim().replace(/\/+$/, "");

/**
 * Talks to the local server through Node instead of the browser stack.
 * Obsidian's renderer sends `Origin: app://obsidian.md`, which Ollama rejects
 * with 403 unless it is in OLLAMA_ORIGINS; a plain Node request has no origin
 * at all, so the server always answers.
 */
function nodeRequest(url: string, method: "GET" | "POST", body?: string): Promise<{ status: number; text: string } | null> {
	interface NodeHttp {
		request(options: object, callback: (res: { statusCode?: number; setEncoding(e: string): void; on(event: string, fn: (chunk: string) => void): void }) => void): {
			on(event: string, fn: (error: Error) => void): void; write(data: string): void; end(): void; destroy(): void;
		};
	}
	let http: NodeHttp | null = null;
	try {
		const req = (window as unknown as { require?: (id: string) => unknown }).require;
		if (!req) return Promise.resolve(null);
		http = req(url.startsWith("https:") ? "https" : "http") as NodeHttp;
	} catch {
		return Promise.resolve(null);
	}
	if (!http) return Promise.resolve(null);
	const client = http;
	let parsed: URL;
	try { parsed = new URL(url); } catch { return Promise.resolve(null); }

	return new Promise(resolve => {
		let settled = false;
		const finish = (value: { status: number; text: string } | null) => { if (!settled) { settled = true; resolve(value); } };
		try {
			const request = client.request({
				protocol: parsed.protocol,
				hostname: parsed.hostname,
				port: parsed.port,
				path: `${parsed.pathname}${parsed.search}`,
				method,
				headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {},
				timeout: 120000
			}, (response) => {
				let text = "";
				response.setEncoding("utf8");
				response.on("data", chunk => { text += chunk; });
				response.on("end", () => finish({ status: response.statusCode ?? 0, text }));
			});
			request.on("error", () => finish(null));
			request.on("timeout", () => { request.destroy(); finish(null); });
			if (body) request.write(body);
			request.end();
		} catch {
			finish(null);
		}
	});
}

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

/** The operating system, or "" outside Electron. Reading `process` directly
 * throws in a plain browser, which used to break the whole assistant. */
function nodePlatform(): string {
	try {
		return (window as unknown as { process?: { platform?: string } }).process?.platform ?? "";
	} catch {
		return "";
	}
}

/** Node's child_process, available because Obsidian runs on Electron. */
function nodeSpawn(): ((cmd: string, args: string[], options: object) => { unref?: () => void }) | null {
	try {
		const req = (window as unknown as { require?: (id: string) => { spawn?: unknown } }).require;
		const mod = req?.("child_process") as { spawn?: (cmd: string, args: string[], options: object) => { unref?: () => void } } | undefined;
		return mod?.spawn ?? null;
	} catch {
		return null;
	}
}

/**
 * Starts and feeds the local model server so nobody has to open a terminal.
 * Everything runs on this computer: it launches the Ollama that is already
 * installed and asks it to download a model, nothing more.
 */
export class LocalServerManager {
	constructor(private baseUrl: () => string) {}

	get canManage(): boolean { return nodeSpawn() !== null; }

	/** Runs a command to completion and reports whether it succeeded. */
	private run(cmd: string, args: string[]): Promise<boolean> {
		const spawn = nodeSpawn();
		if (!spawn) return Promise.resolve(false);
		return new Promise(resolve => {
			try {
				const child = spawn(cmd, args, { stdio: "ignore", shell: nodePlatform() === "win32" }) as {
					on?: (event: string, handler: (code: number | null) => void) => void;
				};
				if (!child.on) return resolve(false);
				let settled = false;
				child.on("close", (code) => { if (!settled) { settled = true; resolve(code === 0); } });
				child.on("error", () => { if (!settled) { settled = true; resolve(false); } });
			} catch {
				resolve(false);
			}
		});
	}

	/** Where the ollama binary might be when it is not on the PATH. */
	private candidates(): string[] {
		const platform = nodePlatform();
		const env = (window as unknown as { process?: { env?: Record<string, string> } }).process?.env ?? {};
		if (platform === "win32") {
			return ["ollama",
				`${env.LOCALAPPDATA ?? ""}\\Programs\\Ollama\\ollama.exe`,
				`${env.ProgramFiles ?? ""}\\Ollama\\ollama.exe`].filter(path => !path.startsWith("\\"));
		}
		if (platform === "darwin") return ["ollama", "/usr/local/bin/ollama", "/opt/homebrew/bin/ollama", "/Applications/Ollama.app/Contents/Resources/ollama"];
		return ["ollama", "/usr/local/bin/ollama", "/usr/bin/ollama"];
	}

	/** The first ollama binary that answers, or null when none does. */
	private async findBinary(): Promise<string | null> {
		for (const candidate of this.candidates()) {
			if (await this.run(candidate, ["--version"])) return candidate;
		}
		return null;
	}

	/** True when the ollama command answers on this computer. */
	async isInstalled(): Promise<boolean> {
		return (await this.findBinary()) !== null;
	}

	/** How this operating system installs Ollama, for the button's label. */
	installPlan(): { label: string; cmd: string; args: string[]; manual: string } | null {
		const platform = nodePlatform();
		if (platform === "win32") {
			return { label: "Instalar Ollama con winget", cmd: "winget", args: ["install", "--id", "Ollama.Ollama", "-e", "--accept-source-agreements", "--accept-package-agreements"], manual: "https://ollama.com/download" };
		}
		if (platform === "darwin") {
			return { label: "Instalar Ollama con Homebrew", cmd: "brew", args: ["install", "ollama"], manual: "https://ollama.com/download" };
		}
		if (platform === "linux") {
			return { label: "Instalar Ollama", cmd: "sh", args: ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], manual: "https://ollama.com/download" };
		}
		return null;
	}

	/** Installs Ollama with the system's package manager, then checks it works. */
	async install(onProgress?: (text: string) => void): Promise<boolean> {
		const plan = this.installPlan();
		if (!plan) return false;
		onProgress?.("Instalando Ollama… esto puede tardar unos minutos.");
		const ok = await this.run(plan.cmd, plan.args);
		if (!ok) return false;
		onProgress?.("Ollama instalado, comprobando…");
		return this.isInstalled();
	}

	/** True when something answers on the configured port. */
	async isRunning(): Promise<boolean> {
		const base = this.baseUrl();
		const origin = /^https?:\/\/[^/]+/i.exec(base)?.[0] ?? "";
		const headers = { Origin: origin, Referer: `${origin}/` };
		for (const path of ["/api/tags", "/v1/models"]) {
			const direct = await nodeRequest(`${base}${path}`, "GET");
			if (direct && direct.status < 400) return true;
			try {
				const response = await requestUrl({ url: `${base}${path}`, method: "GET", headers, throw: false });
				if (response.status < 400) return true;
			} catch { /* try the next shape */ }
		}
		return false;
	}

	/** Launches `ollama serve` in the background and waits until it answers. */
	async start(onProgress?: (text: string) => void): Promise<boolean> {
		if (await this.isRunning()) return true;
		const spawn = nodeSpawn();
		if (!spawn) return false;
		const binary = await this.findBinary();
		if (!binary) return false;
		onProgress?.("Arrancando el servidor local…");
		try {
			const child = spawn(binary, ["serve"], { detached: true, stdio: "ignore", shell: nodePlatform() === "win32" });
			child.unref?.();
		} catch {
			return false;
		}
		for (let attempt = 0; attempt < 15; attempt++) {
			await sleep(600);
			if (await this.isRunning()) {
				onProgress?.("Servidor local en marcha");
				return true;
			}
		}
		return false;
	}

	/**
	 * Downloads a model with `ollama pull` and reports progress by watching the
	 * catalogue, which avoids holding an HTTP request open for several minutes.
	 */
	async pull(model: string, onProgress?: (text: string) => void): Promise<boolean> {
		const spawn = nodeSpawn();
		if (!spawn) return false;
		const binary = await this.findBinary() ?? "ollama";
		try {
			const child = spawn(binary, ["pull", model], { detached: true, stdio: "ignore", shell: nodePlatform() === "win32" });
			child.unref?.();
		} catch {
			return false;
		}
		const started = Date.now();
		while (Date.now() - started < 20 * 60 * 1000) {
			await sleep(3000);
			const minutes = Math.floor((Date.now() - started) / 60000);
			const seconds = Math.floor((Date.now() - started) / 1000) % 60;
			onProgress?.(`Descargando ${model}… ${minutes}:${String(seconds).padStart(2, "0")}`);
			try {
				const origin = /^https?:\/\/[^/]+/i.exec(this.baseUrl())?.[0] ?? "";
				const response = await requestUrl({ url: `${this.baseUrl()}/api/tags`, method: "GET", headers: { Origin: origin, Referer: `${origin}/` }, throw: false });
				const names: string[] = (response.json?.models ?? []).map((m: { name?: string }) => m.name).filter(Boolean);
				if (names.some(name => name === model || name.startsWith(`${model}:`))) {
					onProgress?.(`${model} listo`);
					return true;
				}
			} catch { /* keep waiting */ }
		}
		return false;
	}
}

const actionPrompt = (name: string) =>
	`Eres ${name}, el ayudante de estudio de NoteLens, una pizarra infinita para tomar apuntes. ` +
	"Respondes en español, breve y claro, con pasos numerados cuando ayuden.\n\n" +
	"Puedes colocar cosas en la pizarra escribiendo estas etiquetas en tu respuesta:\n" +
	"[[posit:amarillo]]texto corto[[/posit]] para una nota adhesiva (colores: amarillo, naranja, rosa, verde, azul, lila)\n" +
	"[[latex]]x^2/2 + sqrt(x)[[/latex]] para una fórmula\n" +
	"[[texto]]párrafo más largo[[/texto]] para un cuadro de texto\n" +
	"[[tarea]]Título; paso 1; paso 2; paso 3[[/tarea]] para una tarea con pasos\n\n" +
	"Usa las etiquetas solo cuando te pidan escribir o dibujar algo en la pizarra; el resto del tiempo responde en texto normal. " +
	"Si te dan apuntes como contexto, apóyate en ellos y di cuándo algo no aparece en ellos.";

/**
 * Reads the tags the model may emit and returns them plus the prose left over.
 * Anything malformed is simply left in the text, so a model that ignores the
 * protocol still produces a readable answer.
 */
export function parseAssistantActions(text: string): { prose: string; actions: AssistantAction[] } {
	const actions: AssistantAction[] = [];
	let prose = text;
	const patterns: [RegExp, AssistantAction["kind"]][] = [
		[/\[\[posit(?::([a-záéíóúñ]+))?\]\]([\s\S]*?)\[\[\/posit\]\]/gi, "posit"],
		[/\[\[latex\]\]([\s\S]*?)\[\[\/latex\]\]/gi, "latex"],
		[/\[\[texto\]\]([\s\S]*?)\[\[\/texto\]\]/gi, "texto"],
		[/\[\[tarea\]\]([\s\S]*?)\[\[\/tarea\]\]/gi, "tarea"]
	];
	for (const [pattern, kind] of patterns) {
		prose = prose.replace(pattern, (_match, first: string, second: string) => {
			const body = (kind === "posit" ? second : first) ?? "";
			if (body.trim()) actions.push({ kind, body: body.trim(), color: kind === "posit" ? first : undefined });
			return "";
		});
	}
	return { prose: prose.replace(/\n{3,}/g, "\n\n").trim(), actions };
}

/**
 * Talks to a model running on this computer. No accounts, no keys and nothing
 * leaving the machine: it speaks Ollama's API and the OpenAI-compatible one
 * used by LM Studio, Jan and llama.cpp.
 */
export class LocalModelClient {
	private flavour: ServerFlavour | null = null;
	/** Why the last probe failed, so the chat can say something useful. */
	lastProbeError = "";
	/** The address that actually answered, which may differ from the setting. */
	workingBase: string | null = null;

	constructor(private host: AssistantHost) {}

	get baseUrl(): string { return trimUrl(this.host.aiBaseUrl) || "http://127.0.0.1:11434"; }

	/** The same address written the other way, to dodge an IPv6-only lookup. */
	private altUrl(url: string): string | null {
		if (url.includes("//localhost")) return url.replace("//localhost", "//127.0.0.1");
		if (url.includes("//127.0.0.1")) return url.replace("//127.0.0.1", "//localhost");
		return null;
	}

	/**
	 * Reads a URL through Obsidian first and plain fetch second: some setups
	 * refuse one of the two for localhost, and either answer is good enough.
	 */
	/** Headers that keep a local server from rejecting us as a foreign origin. */
	private localHeaders(url: string, extra: Record<string, string> = {}): Record<string, string> {
		const origin = /^https?:\/\/[^/]+/i.exec(url)?.[0] ?? "";
		return { Origin: origin, Referer: `${origin}/`, ...extra };
	}

	private async getJson(url: string): Promise<{ status: number; json: unknown } | null> {
		const direct = await nodeRequest(url, "GET");
		if (direct && direct.status < 400) {
			try { return { status: direct.status, json: JSON.parse(direct.text) }; } catch { /* not JSON, try the others */ }
		} else if (direct) {
			this.lastProbeError = `respondió ${direct.status}`;
		}
		try {
			const response = await requestUrl({ url, method: "GET", headers: this.localHeaders(url), throw: false });
			if (response.status < 400) return { status: response.status, json: response.json };
			this.lastProbeError = response.status === 403
				? "el servidor rechazó el origen (403); revisa OLLAMA_ORIGINS"
				: `respondió ${response.status}`;
		} catch (error) {
			this.lastProbeError = error instanceof Error ? error.message : String(error);
		}
		try {
			const response = await fetch(url, { method: "GET" });
			if (response.ok) return { status: response.status, json: await response.json() };
			this.lastProbeError = `respondió ${response.status}`;
		} catch (error) {
			this.lastProbeError = error instanceof Error ? error.message : String(error);
		}
		return null;
	}

	async probe(): Promise<ServerFlavour> {
		let base = this.baseUrl;
		this.lastProbeError = "";
		let ollama = await this.getJson(`${base}/api/tags`);
		if (!ollama) {
			// "localhost" can resolve to ::1 while Ollama only listens on 127.0.0.1.
			const alternative = this.altUrl(base);
			if (alternative) {
				const retry = await this.getJson(`${alternative}/api/tags`);
				if (retry) { base = alternative; this.workingBase = alternative; ollama = retry; }
			}
		}
		const ollamaModels = (ollama?.json as { models?: { name?: string }[] } | undefined)?.models;
		if (Array.isArray(ollamaModels)) {
			this.flavour = { kind: "ollama", models: ollamaModels.map(m => m.name).filter((name): name is string => !!name) };
			return this.flavour;
		}
		const openai = await this.getJson(`${base}/v1/models`);
		const openaiModels = (openai?.json as { data?: { id?: string }[] } | undefined)?.data;
		if (Array.isArray(openaiModels)) {
			this.flavour = { kind: "openai", models: openaiModels.map(m => m.id).filter((id): id is string => !!id) };
			return this.flavour;
		}
		const detail = this.lastProbeError ? ` (${this.lastProbeError})` : "";
		throw new Error(`No hay ningún modelo local escuchando en ${base}${detail}.`);
	}

	/** Reachable plus the catalogue, without collapsing "empty" into "down". */
	async describeServer(): Promise<{ reachable: boolean; models: string[] }> {
		try {
			const flavour = await this.probe();
			return { reachable: true, models: flavour.models };
		} catch {
			return { reachable: false, models: [] };
		}
	}

	/** The model to use: the chosen one, or the best available when none is set. */
	async resolveModel(): Promise<string> {
		const flavour = this.flavour ?? await this.probe();
		if (this.host.aiModel && flavour.models.includes(this.host.aiModel)) return this.host.aiModel;
		const best = rankModels(flavour.models)[0];
		if (!best) throw new Error("El servidor local no tiene ningún modelo de chat. Descarga uno, por ejemplo con «ollama pull llama3.2».");
		return best.model;
	}

	async chat(messages: ChatMessage[], context: string, name: string): Promise<string> {
		const flavour = this.flavour ?? await this.probe();
		const model = await this.resolveModel();
		const base = this.workingBase ?? this.baseUrl;
		const system = context
			? `${actionPrompt(name)}\n\nApuntes de la pizarra:\n"""\n${context}\n"""`
			: actionPrompt(name);
		const hasImages = messages.some(message => message.images?.length);
		if (hasImages && !supportsImages(model)) {
			const tip = recommendedVisionModel();
			throw new Error(`El modelo «${model}» no entiende imágenes. Instala uno multimodal con «${tip.pull}»: ${tip.why}.`);
		}

		const post = async (path: string, payload: unknown): Promise<unknown> => {
			const body = JSON.stringify(payload);
			const direct = await nodeRequest(`${base}${path}`, "POST", body);
			if (direct) {
				if (direct.status >= 400) throw new Error(this.describeError(direct.status, direct.text, model));
				try { return JSON.parse(direct.text); } catch { throw new Error("El modelo devolvió una respuesta ilegible."); }
			}
			const response = await requestUrl({
				url: `${base}${path}`,
				method: "POST",
				headers: this.localHeaders(base, { "Content-Type": "application/json" }),
				body,
				throw: false
			});
			if (response.status >= 400) throw new Error(this.describeError(response.status, response.text, model));
			return response.json;
		};

		if (flavour.kind === "ollama") {
			const payload = [
				{ role: "system", content: system },
				...messages.map(message => message.images?.length
					? { role: message.role, content: message.content, images: message.images }
					: { role: message.role, content: message.content })
			];
			const json = await post("/api/chat", { model, messages: payload, stream: false }) as { message?: { content?: string } };
			const text = json?.message?.content;
			if (!text) throw new Error("El modelo respondió sin texto.");
			return String(text).trim();
		}

		const payload = [
			{ role: "system", content: system },
			...messages.map(message => message.images?.length
				? {
					role: message.role,
					content: [
						{ type: "text", text: message.content },
						...message.images.map(image => ({ type: "image_url", image_url: { url: `data:image/png;base64,${image}` } }))
					]
				}
				: { role: message.role, content: message.content })
		];
		const json = await post("/v1/chat/completions", { model, messages: payload, stream: false }) as { choices?: { message?: { content?: string } }[] };
		const text = json?.choices?.[0]?.message?.content;
		if (!text) throw new Error("El modelo respondió sin texto.");
		return String(text).trim();
	}

	private describeError(status: number, body: string, model: string): string {
		if (status === 404) return `El servidor local no encuentra el modelo «${model}». Comprueba el nombre en los ajustes.`;
		const detail = body?.slice(0, 160).replace(/\s+/g, " ").trim();
		return `El servidor local respondió ${status}${detail ? `: ${detail}` : ""}.`;
	}

	/**
	 * Translates with a model on this computer, so there is no quota and no
	 * text leaves the machine. Returns null when no local model is available,
	 * letting the caller fall back to the web service.
	 */
	async translate(text: string, fromName: string, toName: string): Promise<string | null> {
		let models: string[] = [];
		try {
			models = (await this.probe()).models;
		} catch {
			return null;
		}
		const model = this.host.aiModel && models.includes(this.host.aiModel)
			? this.host.aiModel
			: rankTextModels(models)[0];
		if (!model) return null;
		const flavour = this.flavour ?? await this.probe();
		const base = this.workingBase ?? this.baseUrl;
		const payload = [
			{
				role: "system",
				content: `Eres un traductor. Traduces de ${fromName} a ${toName}. Devuelves únicamente la traducción, sin comillas, sin explicaciones y sin repetir el original. Conservas los saltos de línea y el formato.`
			},
			{ role: "user", content: text }
		];
		const path = flavour.kind === "ollama" ? "/api/chat" : "/v1/chat/completions";
		const body = JSON.stringify({ model, messages: payload, stream: false });
		const direct = await nodeRequest(`${base}${path}`, "POST", body);
		let json: unknown = null;
		if (direct && direct.status < 400) {
			try { json = JSON.parse(direct.text); } catch { return null; }
		} else if (!direct) {
			const response = await requestUrl({
				url: `${base}${path}`,
				method: "POST",
				headers: this.localHeaders(base, { "Content-Type": "application/json" }),
				body,
				throw: false
			});
			if (response.status >= 400) return null;
			json = response.json;
		} else {
			return null;
		}
		const answer = flavour.kind === "ollama"
			? (json as { message?: { content?: string } })?.message?.content
			: (json as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
		const clean = typeof answer === "string" ? answer.trim() : "";
		return clean || null;
	}

	async listModels(): Promise<string[]> {
		try { return (await this.probe()).models; } catch { return []; }
	}

	forgetServer(): void { this.flavour = null; this.workingBase = null; }
}

/**
 * The pixel cat that lives on the board. Clicking it opens the chat with the
 * local model; its pose mirrors what it is doing, and it can answer by writing
 * on the board itself.
 */
export function createAssistantPet(host: AssistantHost, container: HTMLElement): { toggle: () => void; isOpen: () => boolean; destroy: () => void; refresh: () => void } {
	const client = new LocalModelClient(host);
	const server = new LocalServerManager(() => client.baseUrl);
	const messages: ChatMessage[] = [];
	let open = false;
	let busy = false;
	let useBoardContext = host.aiUseBoardContext;
	let sleepTimer: number | null = null;
	let composerMode: "tools" | "text" | "draw" = "tools";

	const petName = () => "Leen";

	// ------------------------------------------------------------------ pet
	const pet = container.createDiv({ cls: "notelens-pet" });
	for (const type of ["pointerdown", "pointerup", "dblclick"]) pet.addEventListener(type, (event) => event.stopPropagation());
	const sprite = pet.createEl("img", { cls: "notelens-pet-sprite" });
	sprite.draggable = false;
	// The pet can be made smaller to stay out of the way, or bigger for a tablet.
	pet.style.setProperty("--pet-scale", String(host.petScale || 1));
	const bubble = pet.createDiv({ cls: "notelens-pet-bubble hidden" });

	const setMood = (mood: PetMood) => {
		sprite.src = CAT_SPRITES[mood];
		pet.setAttr("data-mood", mood);
	};
	const wake = () => {
		if (pet.getAttr("data-mood") === "sleeping") setMood("idle");
		if (sleepTimer !== null) window.clearTimeout(sleepTimer);
		sleepTimer = window.setTimeout(() => { if (!busy && !open) setMood("sleeping"); }, 45000);
	};
	const say = (text: string, ms = 3200) => {
		if (!host.petBubbles) return;
		bubble.setText(text);
		bubble.removeClass("hidden");
		window.setTimeout(() => bubble.addClass("hidden"), ms);
	};
	setMood("idle");
	wake();

	// Assigned once the panel exists; the drag handler above may fire first.
	let placePanelNearPet: () => void = () => {};

	// Drag the cat anywhere on the board; the spot is remembered per vault.
	const applyPetPosition = () => {
		const saved = host.getPetPosition();
		if (saved.x === null || saved.y === null) return;
		const bounds = container.getBoundingClientRect();
		const size = pet.getBoundingClientRect();
		const width = size.width || 78;
		const height = size.height || 78;
		const left = Math.min(Math.max(saved.x * bounds.width - width / 2, 6), Math.max(6, bounds.width - width - 6));
		const top = Math.min(Math.max(saved.y * bounds.height - height / 2, 6), Math.max(6, bounds.height - height - 6));
		pet.style.left = `${left}px`;
		pet.style.top = `${top}px`;
		pet.setCssStyles({ right: "auto", bottom: "auto" });
		if (open) placePanelNearPet();
	};

	let dragMoved = false;
	pet.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const bounds = container.getBoundingClientRect();
		const size = pet.getBoundingClientRect();
		const grabX = event.clientX - size.left;
		const grabY = event.clientY - size.top;
		dragMoved = false;
		const onMove = (move: PointerEvent) => {
			if (Math.abs(move.clientX - event.clientX) + Math.abs(move.clientY - event.clientY) < 4) return;
			dragMoved = true;
			pet.addClass("is-dragging");
			const left = Math.min(Math.max(move.clientX - bounds.left - grabX, 6), bounds.width - size.width - 6);
			const top = Math.min(Math.max(move.clientY - bounds.top - grabY, 6), bounds.height - size.height - 6);
			pet.style.left = `${left}px`;
			pet.style.top = `${top}px`;
			pet.setCssStyles({ right: "auto", bottom: "auto" });
			if (open) placePanelNearPet();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove, true);
			window.removeEventListener("pointerup", onUp, true);
			pet.removeClass("is-dragging");
			if (!dragMoved) return;
			const size2 = pet.getBoundingClientRect();
			host.setPetPosition(
				(size2.left - bounds.left + size2.width / 2) / bounds.width,
				(size2.top - bounds.top + size2.height / 2) / bounds.height
			);
			panel.addClass("is-anchored");
			say("Aquí estoy bien", 1600);
		};
		window.addEventListener("pointermove", onMove, true);
		window.addEventListener("pointerup", onUp, true);
	});

	// ------------------------------------------------------------ chat panel
	const panel = container.createDiv({ cls: "notelens-assistant hidden" });
	for (const type of ["pointerdown", "pointerup", "dblclick"]) panel.addEventListener(type, (event) => event.stopPropagation());
	panel.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
	panel.addEventListener("keydown", (event) => {
		event.stopPropagation();
		if (event.key === "Escape") { event.preventDefault(); if (open) toggle(); }
	});

	const header = panel.createDiv({ cls: "notelens-assistant-header" });
	const avatar = header.createEl("img", { cls: "notelens-assistant-avatar" });
	avatar.src = CAT_SPRITES.idle;
	header.createSpan({ cls: "notelens-assistant-name", text: petName() });
	const modelSelect = header.createEl("select", { cls: "notelens-assistant-model" });
	modelSelect.title = "Modelo local que responde";
	modelSelect.addClass("hidden");
	// A plain glyph rather than an icon lookup: on some Obsidian versions the
	// icon came out as an empty square and the chat looked like it had no close.
	const closeBtn = header.createEl("button", { cls: "notelens-embed-close notelens-assistant-close is-glyph", text: "✕" });
	closeBtn.title = "Cerrar el ayudante (Esc)";
	closeBtn.setAttr("aria-label", "Cerrar el ayudante");
	sprite.alt = petName();

	const status = panel.createDiv({ cls: "notelens-assistant-status" });
	const chooser = panel.createDiv({ cls: "notelens-assistant-chooser hidden" });
	const chooserSelect = chooser.createEl("select", { cls: "notelens-assistant-chooser-select" });
	const chooserCustom = chooser.createEl("input", { cls: "notelens-assistant-chooser-custom", type: "text" });
	chooserCustom.placeholder = "…o escribe otro modelo";
	chooserCustom.title = "Cualquier modelo multimodal que exista en Ollama";
	const serverBtn = panel.createEl("button", { cls: "notelens-assistant-server hidden" });

	type InstantTool = LocalStudyTool | "board-latex" | BoardUtility;
	const instantPane = panel.createDiv({ cls: "notelens-assistant-instant" });
	const instantHeader = instantPane.createDiv({ cls: "notelens-assistant-instant-header" });
	instantHeader.createSpan({ text: "Acciones locales" });
	const instantScope = instantHeader.createSpan({ cls: "notelens-assistant-scope", text: "selección o página" });
	const instantGrid = instantPane.createDiv({ cls: "notelens-assistant-instant-grid" });
	let runInstantTool: (tool: InstantTool) => void = () => {};
	const instantTools: { id: InstantTool; icon: string; label: string; hint: string }[] = [
		{ id: "summary", icon: "align-left", label: "Resumir", hint: "Crea un resumen extractivo sin inventar contenido" },
		{ id: "key-ideas", icon: "lightbulb", label: "Ideas clave", hint: "Extrae definiciones y afirmaciones importantes" },
		{ id: "tasks", icon: "list-checks", label: "Plan de repaso", hint: "Convierte pendientes o conceptos en una checklist" },
		{ id: "outline", icon: "list-tree", label: "Esquema", hint: "Ordena los apuntes en una estructura breve" },
		{ id: "flashcards", icon: "panels-top-left", label: "Tarjetas", hint: "Genera preguntas y respuestas desde los apuntes" },
		{ id: "clean-notes", icon: "list-filter", label: "Limpiar texto", hint: "Quita duplicados y normaliza listas" },
		{ id: "board-latex", icon: "sigma", label: "Pizarra → LaTeX", hint: "Lee una región usando objetos y trazos vectoriales" },
		{ id: "organize-selection", icon: "layout-grid", label: "Ordenar selección", hint: "Distribuye los objetos seleccionados en una cuadrícula" },
		{ id: "polish-ink", icon: "wand-sparkles", label: "Pulir tinta", hint: "Suaviza el trazo seleccionado y endereza líneas" }
	];
	for (const tool of instantTools) {
		const button = instantGrid.createEl("button", { cls: "notelens-assistant-instant-tool" });
		setIcon(button.createSpan({ cls: "notelens-assistant-instant-icon" }), tool.icon);
		button.createSpan({ text: tool.label });
		button.title = tool.hint;
		button.onclick = () => runInstantTool(tool.id);
	}

	/** Fills the picker with what this computer can run, and returns the choice getter. */
	const fillChooser = (): (() => string) => {
		const options = visionOptionsFor();
		chooserSelect.empty();
		for (const option of [...options].reverse()) {
			const entry = chooserSelect.createEl("option", {
				value: option.model,
				text: `${option.model} · ${option.params} · ${option.downloadGb} GB`
			});
			entry.title = option.note;
		}
		chooser.removeClass("hidden");
		return () => chooserCustom.value.trim() || chooserSelect.value;
	};
	const hideChooser = () => chooser.addClass("hidden");
	const log = panel.createDiv({ cls: "notelens-assistant-log" });

	const setStatus = (text: string, kind: "info" | "error" | "ok" = "info") => {
		status.setText(text);
		status.toggleClass("is-error", kind === "error");
		status.toggleClass("is-ok", kind === "ok");
	};

	const renderLog = () => {
		log.empty();
		if (messages.length === 0) {
			const empty = log.createDiv({ cls: "notelens-assistant-empty" });
			empty.createDiv({ text: "Selecciona una zona o usa la página completa. Estas herramientas actúan al instante y no envían nada fuera de Obsidian." });
			return;
		}
		for (const message of messages) {
			const row = log.createDiv({ cls: `notelens-assistant-msg is-${message.role}` });
			if (message.images?.length) {
				const preview = row.createEl("img", { cls: "notelens-assistant-msg-image" });
				preview.src = `data:image/png;base64,${message.images[0]}`;
				preview.alt = "Lo que dibujaste";
			}
			if (message.content) row.createDiv({ cls: "notelens-assistant-msg-text", text: message.content });
			if (message.role === "assistant") {
				const actions = row.createDiv({ cls: "notelens-assistant-msg-actions" });
				const insert = actions.createEl("button", { cls: "notelens-assistant-action" });
				setIcon(insert.createSpan(), "arrow-down-to-line");
				insert.createSpan({ text: "A la pizarra" });
				insert.onclick = () => {
					setMood("drawing");
					host.runAssistantAction({ kind: "texto", body: message.content });
					say("¡Listo!", 1600);
					window.setTimeout(() => setMood("idle"), 1300);
				};
				const copy = actions.createEl("button", { cls: "notelens-assistant-action" });
				setIcon(copy.createSpan(), "copy");
				copy.createSpan({ text: "Copiar" });
				copy.onclick = () => { void navigator.clipboard.writeText(message.content); new Notice("Respuesta copiada"); };
			}
		}
		log.scrollTop = log.scrollHeight;
	};

	runInstantTool = (tool: InstantTool) => {
		wake();
		if (tool === "board-latex") {
			setStatus("Selecciona la región que contiene la fórmula.", "ok");
			if (open) toggle();
			host.openFormulaReader();
			return;
		}
		if (tool === "organize-selection" || tool === "polish-ink") {
			setMood("drawing");
			const report = host.runBoardUtility(tool);
			messages.push({ role: "assistant", content: report });
			renderLog();
			setStatus(report, /selecciona/i.test(report) ? "info" : "ok");
			say(report, 2200);
			window.setTimeout(() => setMood("idle"), 700);
			return;
		}
		const selected = host.getSelectionText().trim();
		const source = selected || host.getBoardText().trim();
		instantScope.setText(selected ? "selección actual" : "página completa");
		const result = runLocalStudyTool(tool, source);
		if (result.empty || !result.content.trim()) {
			setStatus("No hay texto legible en la selección ni en esta página.", "error");
			say("Necesito algo de texto", 1800);
			return;
		}
		setMood("drawing");
		let report = "";
		if (tool === "tasks") {
			report = host.runAssistantAction({ kind: "tarea", body: [result.title, ...result.items].join("; ") });
		} else if (tool === "key-ideas") {
			report = host.runAssistantAction({ kind: "posit", body: `${result.title}\n${result.content}`, color: "amarillo" });
		} else {
			report = host.runAssistantAction({ kind: "texto", body: `${result.title}\n\n${result.content}` });
		}
		messages.push({ role: "assistant", content: `${result.title}\n${result.content}\n\nCreado: ${report}.` });
		renderLog();
		setStatus(`${result.title} creado desde la ${selected ? "selección" : "página"}.`, "ok");
		say("Listo en la pizarra", 1800);
		window.setTimeout(() => setMood("idle"), 700);
	};

	const contextRow = panel.createEl("label", { cls: "notelens-assistant-context" });
	const contextToggle = contextRow.createEl("input");
	contextToggle.type = "checkbox";
	contextToggle.checked = useBoardContext;
	contextRow.createSpan({ text: "Usar el texto de la pizarra como contexto" });
	contextToggle.onchange = () => { useBoardContext = contextToggle.checked; };

	// ------------------------------------------------------------- composer
	const modeRow = panel.createDiv({ cls: "notelens-assistant-modes" });
	const toolsModeBtn = modeRow.createEl("button", { cls: "notelens-assistant-mode" });
	setIcon(toolsModeBtn.createSpan(), "wand-sparkles");
	toolsModeBtn.createSpan({ text: "Acciones" });
	const textModeBtn = modeRow.createEl("button", { cls: "notelens-assistant-mode" });
	setIcon(textModeBtn.createSpan(), "message-square-text");
	textModeBtn.createSpan({ text: "Chat local" });
	const drawModeBtn = modeRow.createEl("button", { cls: "notelens-assistant-mode" });
	setIcon(drawModeBtn.createSpan(), "pen-line");
	drawModeBtn.createSpan({ text: "Fórmula rápida" });
	panel.insertBefore(modeRow, instantPane);

	const composer = panel.createDiv({ cls: "notelens-assistant-composer" });
	const input = composer.createEl("textarea", { cls: "notelens-assistant-input" });
	input.rows = 2;
	input.placeholder = "Escribe tu pregunta y pulsa Enter";

	const sketchPane = composer.createDiv({ cls: "notelens-assistant-sketch" });
	const sketchCanvas = sketchPane.createEl("canvas");
	const SKETCH_W = 300, SKETCH_H = 150;
	const dpr = window.devicePixelRatio || 1;
	sketchCanvas.width = SKETCH_W * dpr;
	sketchCanvas.height = SKETCH_H * dpr;
	sketchCanvas.style.width = `${SKETCH_W}px`;
	sketchCanvas.style.height = `${SKETCH_H}px`;
	const sketchCtx = sketchCanvas.getContext("2d");
	const sketchHint = sketchPane.createDiv({ cls: "notelens-assistant-sketch-hint", text: "Escribe una fórmula; se lee desde los trazos" });
	const requests = panel.createDiv({ cls: "notelens-assistant-requests" });
	panel.insertBefore(requests, composer);
	const REQUESTS: [string, string][] = [];
	let chosenRequest = "";
	const requestButtons: HTMLElement[] = [];
	requests.createSpan({ cls: "notelens-assistant-requests-label", text: "Reconocimiento vectorial local · fracciones, potencias y operadores" });
	for (const [label, prompt] of REQUESTS) {
		const chip = requests.createEl("button", { cls: "notelens-assistant-request", text: label });
		chip.title = prompt;
		chip.onclick = () => {
			chosenRequest = chosenRequest === prompt ? "" : prompt;
			for (const other of requestButtons) other.toggleClass("active", false);
			chip.toggleClass("active", !!chosenRequest);
		};
		requestButtons.push(chip);
	}
	const sketchClear = sketchPane.createEl("button", { cls: "notelens-assistant-sketch-clear" });
	setIcon(sketchClear, "eraser");
	sketchClear.title = "Borrar el dibujo";
	let sketchStrokes: { x: number; y: number }[][] = [];
	let sketchCurrent: { x: number; y: number }[] | null = null;

	const redrawSketch = () => {
		if (!sketchCtx) return;
		sketchCtx.setTransform(1, 0, 0, 1, 0, 0);
		sketchCtx.fillStyle = "#ffffff";
		sketchCtx.fillRect(0, 0, sketchCanvas.width, sketchCanvas.height);
		sketchCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
		sketchCtx.strokeStyle = "#0f172a";
		sketchCtx.lineWidth = 2.6;
		sketchCtx.lineCap = "round";
		sketchCtx.lineJoin = "round";
		for (const stroke of sketchStrokes) {
			if (!stroke.length) continue;
			sketchCtx.beginPath();
			sketchCtx.moveTo(stroke[0].x, stroke[0].y);
			for (let i = 1; i < stroke.length; i++) sketchCtx.lineTo(stroke[i].x, stroke[i].y);
			sketchCtx.stroke();
		}
		sketchHint.toggleClass("hidden-hint", sketchStrokes.length > 0);
	};
	redrawSketch();
	const sketchPoint = (event: PointerEvent) => {
		const rect = sketchCanvas.getBoundingClientRect();
		return { x: (event.clientX - rect.left) * (SKETCH_W / rect.width), y: (event.clientY - rect.top) * (SKETCH_H / rect.height) };
	};
	sketchCanvas.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		sketchCanvas.setPointerCapture(event.pointerId);
		sketchCurrent = [sketchPoint(event)];
		sketchStrokes.push(sketchCurrent);
		redrawSketch();
	});
	sketchCanvas.addEventListener("pointermove", (event) => {
		if (!sketchCurrent) return;
		sketchCurrent.push(sketchPoint(event));
		redrawSketch();
	});
	const endSketch = () => { sketchCurrent = null; };
	sketchCanvas.addEventListener("pointerup", endSketch);
	sketchCanvas.addEventListener("pointercancel", endSketch);
	sketchClear.onclick = () => { sketchStrokes = []; redrawSketch(); };

	const send = composer.createEl("button", { cls: "notelens-assistant-send" });
	setIcon(send, "send-horizontal");
	send.title = "Enviar (Enter)";

	const setComposerMode = (mode: "tools" | "text" | "draw") => {
		composerMode = mode;
		panel.setAttr("data-mode", mode);
		toolsModeBtn.toggleClass("active", mode === "tools");
		textModeBtn.toggleClass("active", mode === "text");
		drawModeBtn.toggleClass("active", mode === "draw");
		instantPane.style.display = mode === "tools" ? "" : "none";
		composer.style.display = mode === "tools" ? "none" : "";
		input.style.display = mode === "text" ? "" : "none";
		sketchPane.style.display = mode === "draw" ? "" : "none";
		requests.style.display = mode === "draw" ? "" : "none";
		contextRow.style.display = mode === "text" ? "" : "none";
		modelSelect.toggleClass("hidden", mode !== "text");
		if (mode === "tools") {
			serverBtn.addClass("hidden");
			hideChooser();
			setStatus("Acciones instantáneas · sin red ni modelos", "ok");
		} else if (mode === "draw") {
			serverBtn.addClass("hidden");
			hideChooser();
			setStatus("Escribe y pulsa enviar · lectura vectorial local", "ok");
		} else {
			void refreshModels();
			input.focus();
		}
		if (open) window.requestAnimationFrame(placePanelNearPet);
	};
	toolsModeBtn.onclick = () => setComposerMode("tools");
	textModeBtn.onclick = () => setComposerMode("text");
	drawModeBtn.onclick = () => setComposerMode("draw");
	setComposerMode("tools");

	// --------------------------------------------------------------- models
	const showServerButton = (label: string, icon: string, run: () => Promise<void>) => {
		serverBtn.empty();
		setIcon(serverBtn.createSpan(), icon);
		serverBtn.createSpan({ text: label });
		serverBtn.removeClass("hidden");
		serverBtn.disabled = false;
		serverBtn.onclick = async () => {
			serverBtn.disabled = true;
			await run();
			serverBtn.disabled = false;
		};
	};

	/**
	 * Shows the picker with the multimodal models this computer can run. When
	 * none fit, Leen says so plainly instead of pretending he can work.
	 */
	const offerDownload = (reason: string) => {
		const options = visionOptionsFor();
		if (options.length === 0) {
			hideChooser();
			serverBtn.addClass("hidden");
			setStatus(`${reason} Tu equipo tiene ${detectMemoryGb()} GB de RAM y el modelo multimodal más pequeño necesita ${VISION_CATALOGUE[0].minRamGb} GB, así que Leen no puede funcionar aquí.`, "error");
			return;
		}
		if (!server.canManage) {
			hideChooser();
			setStatus(`${reason} Descárgalo en una terminal, por ejemplo: ${recommendedVisionModel().pull}`, "info");
			return;
		}
		const choice = fillChooser();
		setStatus(reason, "info");
		showServerButton("Descargar el modelo elegido", "download", async () => {
			const model = choice();
			if (!model) { setStatus("Elige un modelo de la lista o escribe su nombre.", "error"); return; }
			const ok = await server.pull(model, text => setStatus(text));
			if (!ok) { setStatus(`No he podido descargar ${model}. Prueba en una terminal: ollama pull ${model}`, "error"); return; }
			client.forgetServer();
			host.setAiModel(model);
			hideChooser();
			await refreshModels();
		});
	};

	const refreshModels = async () => {
		setStatus("Buscando un modelo local…");
		serverBtn.addClass("hidden");
		hideChooser();
		let { reachable, models } = await client.describeServer();
		let missingOllama = false;
		if (!reachable && server.canManage) {
			// Check the command first: starting a server that is not installed
			// would just burn ten seconds before failing.
			missingOllama = !(await server.isInstalled());
			if (!missingOllama) {
				// The plugin runs the server itself instead of asking for a terminal.
				const started = await server.start(text => setStatus(text));
				if (started) {
					client.forgetServer();
					({ reachable, models } = await client.describeServer());
				}
			}
		}
		modelSelect.empty();

		// Reachable but with nothing downloaded: the one case that used to be
		// reported as "the server does not answer".
		if (reachable && models.length === 0) {
			modelSelect.createEl("option", { value: "", text: "sin modelos" });
			offerDownload(`Ollama funciona en ${client.baseUrl} pero no tienes ningún modelo. Elige uno y lo descargo.`);
			return;
		}

		if (models.length === 0) {
			modelSelect.createEl("option", { value: "", text: "sin conexión" });
			if (server.canManage) {
				if (missingOllama) {
					const plan = server.installPlan();
					if (plan) {
						setStatus("No tienes Ollama en este equipo. Puedo instalarlo por ti; todo se queda en tu ordenador.", "info");
						showServerButton(plan.label, "download", async () => {
							const ok = await server.install(text => setStatus(text));
							if (!ok) { setStatus(`No he podido instalarlo. Descárgalo a mano en ${plan.manual}`, "error"); return; }
							await refreshModels();
						});
					} else {
						setStatus(`Instala Ollama desde https://ollama.com/download y vuelve a abrirme.`, "error");
					}
					return;
				}
				const why = client.lastProbeError ? ` El intento dijo: ${client.lastProbeError}.` : "";
				setStatus(`Ollama está instalado pero no responde en ${client.baseUrl}.${why} Comprueba la dirección en los ajustes del plugin.`, "error");
				showServerButton("Reintentar arrancar el servidor", "play", async () => { await refreshModels(); });
			} else {
				const why = client.lastProbeError ? ` (${client.lastProbeError})` : "";
				setStatus(`No encuentro ningún servidor en ${client.baseUrl}${why}. Arranca Ollama o LM Studio.`, "error");
			}
			return;
		}
		const ranked = rankModels(models);
		const best = ranked[0];
		if (!best) {
			modelSelect.createEl("option", { value: "", text: "sin modelo de chat" });
			offerDownload(`Tienes ${models.length} modelo${models.length === 1 ? "" : "s"}, pero ninguno puede conversar.`);
			return;
		}
		hideChooser();
		modelSelect.createEl("option", { value: "", text: best ? `Automático (${best.model})` : "Automático" });
		for (const entry of ranked) {
			const option = modelSelect.createEl("option", { value: entry.model, text: entry.model === best?.model ? `${entry.model} ★` : entry.model });
			option.title = entry.reason;
		}
		modelSelect.value = host.aiModel && models.includes(host.aiModel) ? host.aiModel : "";
		const chosen = modelSelect.value || best?.model || "";
		setStatus(host.aiModel
			? `Conectado a ${client.baseUrl} · ${chosen}`
			: `Elegido para tu equipo: ${best.model} (${best.reason})`, "ok");
	};
	modelSelect.onchange = () => {
		host.setAiModel(modelSelect.value);
		void refreshModels();
	};

	// ------------------------------------------------------------- sending
	const ask = async () => {
		if (busy) return;
		const question = input.value.trim();
		const drawing = composerMode === "draw" && sketchStrokes.length > 0;
		if (!question && !drawing) return;
		busy = true;
		if (drawing) {
			const recognition = recognizeInkFormula(sketchStrokes.map(points => ({ points })));
			if (!recognition.source) {
				setStatus("No distingo una fórmula todavía. Añade algún trazo más.", "error");
				busy = false;
				return;
			}
			setMood("drawing");
			const report = host.runAssistantAction({ kind: "latex", body: recognition.source });
			messages.push({ role: "assistant", content: `${recognition.source}\n\n${recognition.detail}. Creado: ${report}.` });
			sketchStrokes = [];
			redrawSketch();
			renderLog();
			setStatus(`${recognition.detail} · fórmula insertada`, recognition.confidence < 0.56 ? "info" : "ok");
			say("Fórmula insertada", 1800);
			busy = false;
			window.setTimeout(() => setMood("idle"), 700);
			return;
		}
		if (!question) {
			setStatus("Escribe una pregunta para el chat local.", "error");
			busy = false;
			return;
		}
		const images = drawing ? [sketchCanvas.toDataURL("image/png").split(",")[1]] : undefined;
		const content = question || chosenRequest;
		input.value = "";
		if (drawing) {
			sketchStrokes = [];
			redrawSketch();
			chosenRequest = "";
			for (const chip of requestButtons) chip.toggleClass("active", false);
		}
		messages.push({ role: "user", content, images });
		renderLog();
		setMood("thinking");
		setStatus("Pensando…");
		const pending = log.createDiv({ cls: "notelens-assistant-msg is-assistant is-pending", text: "…" });
		log.scrollTop = log.scrollHeight;
		try {
			const context = useBoardContext ? host.getBoardText().slice(0, 6000) : "";
			const answer = await client.chat(messages, context, petName());
			const { prose, actions } = parseAssistantActions(answer);
			const reports: string[] = [];
			if (actions.length) {
				setMood("drawing");
				for (const action of actions) reports.push(host.runAssistantAction(action));
				say(`${actions.length} cosa${actions.length === 1 ? "" : "s"} en la pizarra`, 2400);
			}
			const body = [prose, reports.length ? `✍️ ${reports.join(" · ")}` : ""].filter(Boolean).join("\n\n");
			messages.push({ role: "assistant", content: body || "Hecho." });
			setStatus(actions.length ? "Escrito en la pizarra" : "Respuesta lista", "ok");
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			messages.push({ role: "assistant", content: `No he podido responder. ${reason}` });
			setStatus(reason, "error");
			client.forgetServer();
		} finally {
			pending.remove();
			busy = false;
			renderLog();
			window.setTimeout(() => { if (!busy) setMood("idle"); }, 900);
			wake();
		}
	};

	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); }
	});
	send.onclick = () => void ask();

	/**
	 * Places the chat beside the cat: to whichever side has room, aligned with
	 * him vertically and always kept inside the board.
	 */
	placePanelNearPet = () => {
		const bounds = container.getBoundingClientRect();
		const petBox = pet.getBoundingClientRect();
		const gap = 14;
		const width = panel.offsetWidth || 360;
		const height = panel.offsetHeight || 420;
		const petLeft = petBox.left - bounds.left;
		const petTop = petBox.top - bounds.top;
		const roomRight = bounds.width - (petLeft + petBox.width) - gap;
		const roomLeft = petLeft - gap;
		let left = roomRight >= width || roomRight >= roomLeft
			? petLeft + petBox.width + gap
			: petLeft - width - gap;
		left = Math.min(Math.max(left, 8), Math.max(8, bounds.width - width - 8));
		// Everything the chat must not cover: the toolbars, the corner controls
		// and the minimap. Measured live, so hiding one frees its space.
		const obstacles = ([".onenote-ribbon-dock", ".notelens-insert-dock", ".notelens-document-dock", ".onenote-quick-tags",
			".notelens-settings-btn", ".notelens-settings-panel", ".notelens-bookmarks-dock", ".notelens-pages-dock",
			".notelens-navigation-controls", ".notelens-minimap", ".notelens-focus-toggle"]
			.map(selector => container.querySelector(selector) as HTMLElement | null)
			.filter((el): el is HTMLElement => !!el && !el.hasClass("hidden") && el.offsetWidth > 0)
			.map(el => {
				const box = el.getBoundingClientRect();
				return { left: box.left - bounds.left, right: box.right - bounds.left, top: box.top - bounds.top, bottom: box.bottom - bounds.top };
			}));
		const overlapsColumn = (rect: { left: number; right: number }) => rect.right > left - 6 && rect.left < left + width + 6;
		const ceiling = obstacles.filter(rect => overlapsColumn(rect) && rect.bottom < bounds.height * 0.5)
			.reduce((lowest, rect) => Math.max(lowest, rect.bottom + 10), 8);
		const floor = obstacles.filter(rect => overlapsColumn(rect) && rect.top > bounds.height * 0.5)
			.reduce((highest, rect) => Math.min(highest, rect.top - 10), bounds.height - 8);

		let top = petTop + petBox.height / 2 - height / 2;
		if (top + height > floor) top = floor - height;
		if (top < ceiling) top = ceiling;
		// When the free band is shorter than the panel, sit in it and let the
		// panel's own scrolling take over rather than covering a toolbar.
		if (ceiling + height > floor) top = Math.max(8, Math.min(ceiling, bounds.height - height - 8));
		top = Math.min(Math.max(top, 8), Math.max(8, bounds.height - height - 8));
		panel.style.left = `${left}px`;
		panel.style.top = `${top}px`;
		panel.setCssStyles({ right: "auto", bottom: "auto" });
		// The arrow sits on the edge facing the cat: on the panel's right when
		// the panel ended up to his left, and vice versa.
		panel.toggleClass("points-left", left < petLeft);
		// The little arrow keeps pointing at the cat even when the panel slid away.
		const arrowTop = Math.min(Math.max(petTop + petBox.height / 2 - top, 16), Math.max(16, height - 16));
		panel.style.setProperty("--arrow-top", `${arrowTop}px`);
	};

	const toggle = () => {
		open = !open;
		panel.toggleClass("hidden", !open);
		pet.toggleClass("is-open", open);
		if (open) window.requestAnimationFrame(placePanelNearPet);
		if (open) {
			setMood("idle");
			wake();
			if (composerMode === "text") void refreshModels();
			if (composerMode === "text") input.focus();
		}
	};
	closeBtn.onclick = toggle;
	pet.addEventListener("click", () => {
		wake();
		if (dragMoved) { dragMoved = false; return; }
		toggle();
	});
	pet.addEventListener("pointerenter", () => {
		wake();
		if (!open && !busy) say(`Soy ${petName()}, haz clic`, 2200);
	});

	// The chat grows when you switch to the drawing pad or a long answer lands.
	// Re-place it on every size change so it never spills off the board.
	if (typeof ResizeObserver !== "undefined") {
		const observer = new ResizeObserver(() => { if (open) placePanelNearPet(); });
		observer.observe(panel);
	}

	applyPetPosition();
	renderLog();
	return {
		toggle,
		isOpen: () => open,
		destroy: () => {
			if (sleepTimer !== null) window.clearTimeout(sleepTimer);
			pet.remove();
			panel.remove();
		},
		/** Re-reads the settings that change how the pet looks and behaves. */
		refresh: () => {
			pet.style.setProperty("--pet-scale", String(host.petScale || 1));
			useBoardContext = host.aiUseBoardContext;
			contextToggle.checked = useBoardContext;
			applyPetPosition();
			if (open) placePanelNearPet();
		}
	};
}
