import { App, FuzzySuggestModal, Menu, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSource from "pdfjs-dist/build/pdf.worker.min.mjs?raw";
import { Embed, genId } from "./types";
import { mountChartFrame } from "./charts";
import { VIDEO_EXTENSIONS, clamp, toRemoteVideoEmbed } from "./tools";
import { tr } from "./i18n";
import { notePreview } from "./rich-text";

/** Callbacks the embed frames need from the view. */
export interface EmbedHost {
	app: App;
	pluginDir: string;
	/** Drag routing with selection support. Returns true when handled (select tool). */
	startEmbedDrag(e: PointerEvent, el: HTMLElement, embed: Embed, force?: boolean): boolean;
	onEmbedChanged(): void;
	onEmbedDeleted(embed: Embed): void;
	onDragStart(): void;
	onDragEnd(): void;
	openVaultFile(path: string): void;
	/** Opens a note or board, in this tab or a new one. */
	openLink(path: string, newLeaf: boolean): void;
	/** Opens the chart editor for a chart embed. */
	editChart(embed: Embed): void;
	selectEmbed(embed: Embed): void;
	shouldPassPointerToCanvas(): boolean;
}

const MIN_W = 240;
const MIN_H = 160;
const PAGE_GAP = 16;
/** PDF pages render at 2× device resolution for crisp text when zooming. */
const PDF_RENDER_BOOST = 2;
const MAX_CANVAS_EDGE = 8192;

function pdfViewport(page: any, cssWidth: number): { viewport: any; cssHeight: number } {
	const base = page.getViewport({ scale: 1 });
	const cssScale = cssWidth / base.width;
	const dpr = window.devicePixelRatio || 1;
	const maxScale = MAX_CANVAS_EDGE / Math.max(base.width, base.height);
	const scale = Math.min(cssScale * dpr * PDF_RENDER_BOOST, maxScale);
	return {
		viewport: page.getViewport({ scale }),
		cssHeight: Math.floor(base.height * cssScale)
	};
}

const KIND_ICONS: Record<string, string> = {
	pdf: "file-text",
	youtube: "youtube",
	"web-video": "play-square",
	video: "play",
	audio: "audio-lines",
	epub: "book-open",
	image: "image",
	file: "paperclip",
	note: "file-text",
	board: "presentation",
	chart: "bar-chart-3"
};

// ---------------------------------------------------------------------------
// The worker is embedded in main.js so Obsidian and BRAT only need the three
// standard plugin files. PDF parsing still happens away from the UI thread.
// ---------------------------------------------------------------------------
let workerConfigured = false;
let workerUrl: string | null = null;
function ensurePdfWorker(): void {
	if (workerConfigured) return;
	workerConfigured = true;
	try {
		workerUrl = URL.createObjectURL(new Blob([pdfWorkerSource], { type: "text/javascript" }));
		(pdfjsLib.GlobalWorkerOptions as any).workerSrc = workerUrl;
	} catch (e) {
		workerConfigured = false;
		console.warn("NoteLens: pdf.js worker unavailable", e);
	}
}

export function disposePdfWorker(): void {
	if (workerUrl) URL.revokeObjectURL(workerUrl);
	workerUrl = null;
	workerConfigured = false;
}

async function loadPdf(host: EmbedHost, src: string): Promise<any | null> {
	const file = host.app.vault.getAbstractFileByPath(src);
	if (!(file instanceof TFile)) return null;
	ensurePdfWorker();
	try {
		const buf = await host.app.vault.readBinary(file);
		return await pdfjsLib.getDocument({ data: buf }).promise;
	} catch (e) {
		console.error("NoteLens: could not load PDF", e);
		return null;
	}
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function renderEmbedFrame(host: EmbedHost, layer: HTMLElement, embed: Embed): void {
	if (embed.kind === "pdf" && embed.pdfMode === "pages") {
		void mountPdfPages(host, layer, embed);
		return;
	}
	if (embed.kind === "image") {
		mountLooseImage(host, layer, embed);
		return;
	}
	if (embed.kind === "epub" || embed.kind === "file") {
		mountAttachmentCard(host, layer, embed);
		return;
	}
	if (embed.kind === "note" || embed.kind === "board") {
		mountLinkCard(host, layer, embed);
		return;
	}
	if (embed.kind === "chart") {
		mountChartFrame(host, layer, embed);
		return;
	}

	const frame = layer.createDiv({ cls: "notelens-embed" });
	frame.setAttr("data-id", embed.id);
	frame.style.left = `${embed.x}px`;
	frame.style.top = `${embed.y}px`;
	if (embed.rotation) frame.style.transform = `rotate(${embed.rotation}deg)`;
	frame.style.width = `${embed.w}px`;
	frame.style.height = `${embed.h}px`;

	const header = frame.createDiv({ cls: "notelens-embed-header" });
	const iconEl = header.createSpan({ cls: "notelens-embed-icon" });
	setIcon(iconEl, KIND_ICONS[embed.kind] ?? "file");
	const title = header.createSpan({ cls: "notelens-embed-title" });
	title.setText(embedTitle(embed));

	if (embed.kind !== "youtube" && embed.kind !== "web-video") {
		const openBtn = header.createEl("button", { cls: "notelens-embed-open" });
		setIcon(openBtn, "external-link");
		openBtn.title = tr("Abrir archivo original");
		openBtn.onclick = (e) => {
			e.stopPropagation();
			host.openVaultFile(embed.src);
		};
	}
	if (embed.kind === "youtube" || embed.kind === "web-video") {
		const openBtn = header.createEl("button", { cls: "notelens-embed-open" });
		setIcon(openBtn, "external-link");
		openBtn.title = tr("Abrir publicación original");
		openBtn.setAttr("aria-label", openBtn.title);
		openBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
		openBtn.onclick = (event) => {
			event.stopPropagation();
			host.openVaultFile(embed.originalUrl ?? embed.src);
		};
	}

	if (embed.kind === "video") {
		const captionsBtn = header.createEl("button", { cls: "notelens-embed-open" });
		setIcon(captionsBtn, "captions");
		captionsBtn.title = embed.captionSrc ? tr("Cambiar subtítulos WebVTT") : tr("Añadir subtítulos WebVTT");
		captionsBtn.onclick = (event) => {
			event.stopPropagation();
			void pickCaptionTrack(host, embed, body, captionsBtn);
		};
	}

	const closeBtn = header.createEl("button", { cls: "notelens-embed-close notelens-object-close" });
	setIcon(closeBtn, "x");
	closeBtn.title = tr("Cerrar y quitar de la pizarra");
	closeBtn.setAttr("aria-label", tr("Cerrar y quitar de la pizarra"));
	closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
	closeBtn.onclick = (e) => {
		e.stopPropagation();
		frame.remove();
		host.onEmbedDeleted(embed);
	};

	const body = frame.createDiv({ cls: "notelens-embed-body" });

	if (embed.kind === "pdf") {
		void mountPdfViewer(host, header, body, embed);
	} else if (embed.kind === "youtube" || embed.kind === "web-video") {
		const remote = toRemoteVideoEmbed(embed.originalUrl ?? embed.src) ?? toRemoteVideoEmbed(embed.src);
		body.addClass("notelens-remote-video");
		if (remote?.embedUrl) {
			const iframe = body.createEl("iframe");
			iframe.src = remote.embedUrl;
			iframe.title = embedTitle(embed);
			iframe.referrerPolicy = "strict-origin-when-cross-origin";
			iframe.setAttr("frameborder", "0");
			iframe.setAttr("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen");
			iframe.setAttr("allowfullscreen", "true");
		}
		const fallback = body.createDiv({ cls: "notelens-video-fallback" });
		fallback.createSpan({ text: tr(remote?.embedUrl ? "¿No se reproduce dentro de Obsidian?" : "Este enlace se reproduce en su aplicación o navegador.") });
		if (remote) {
			const link = fallback.createEl("a", { text: tr("Abrir vídeo original") });
			link.href = remote.originalUrl;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			link.addEventListener("pointerdown", (event) => event.stopPropagation());
			link.addEventListener("click", (event) => event.stopPropagation());
		}
	} else {
		const file = host.app.vault.getAbstractFileByPath(embed.src);
		if (file instanceof TFile) {
			if (embed.kind === "audio") {
				const audio = body.createEl("audio", { cls: "notelens-audio-player" });
				audio.src = host.app.vault.getResourcePath(file);
				audio.controls = true;
				audio.preload = "metadata";
			} else {
				const video = body.createEl("video");
				video.src = host.app.vault.getResourcePath(file);
				video.controls = true;
				video.playsInline = true;
				video.preload = "metadata";
				attachCaptionToVideo(host, embed, video);
			}
		} else {
			body.createDiv({ cls: "notelens-embed-missing", text: tr("Archivo no encontrado: {p0}", { p0: embed.src }) });
		}
	}

	setupFrameDrag(host, header, frame, embed);
	setupFrameResize(host, frame, embed);

	// Media interactions must not pan/zoom the canvas.
	body.addEventListener("pointerdown", (e) => {
		if (!host.shouldPassPointerToCanvas()) e.stopPropagation();
	});
	body.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
}

function attachCaptionToVideo(host: EmbedHost, embed: Embed, video: HTMLVideoElement): void {
	if (!embed.captionSrc) return;
	const caption = host.app.vault.getAbstractFileByPath(embed.captionSrc);
	if (!(caption instanceof TFile)) return;
	video.querySelector("track")?.remove();
	const track = video.createEl("track");
	track.kind = "subtitles";
	track.label = "Subtítulos";
	track.srclang = "es";
	track.src = host.app.vault.getResourcePath(caption);
	track.default = true;
}

async function pickCaptionTrack(host: EmbedHost, embed: Embed, body: HTMLElement, button: HTMLElement): Promise<void> {
	const picker = createEl("input");
	picker.type = "file";
	picker.accept = ".vtt,text/vtt";
	picker.onchange = async () => {
		const file = picker.files?.[0];
		if (!file) return;
		if (!file.name.toLowerCase().endsWith(".vtt")) {
			new Notice(tr("Selecciona un archivo WebVTT (.vtt)."));
			return;
		}
		try {
			const safeName = file.name.replace(/[\\/:*?"<>|]/g, "-");
			let path = safeName || `subtitulos-${Date.now()}.vtt`;
			try {
				path = await (host.app.fileManager as any).getAvailablePathForAttachment(path, "");
			} catch { /* retain vault-root fallback */ }
			const parent = path.split("/").slice(0, -1).join("/");
			if (parent && !host.app.vault.getAbstractFileByPath(parent)) {
				await host.app.vault.createFolder(parent).catch(() => { /* folder already exists */ });
			}
			const saved = await host.app.vault.createBinary(path, await file.arrayBuffer());
			embed.captionSrc = saved.path;
			const video = body.querySelector("video");
			if (video) attachCaptionToVideo(host, embed, video);
			button.title = tr("Cambiar subtítulos WebVTT");
			host.onEmbedChanged();
			new Notice(tr("Subtítulos añadidos: {p0}", { p0: saved.name }));
		} catch (error) {
			console.error("NoteLens: caption upload failed", error);
			new Notice(tr("No se pudieron añadir los subtítulos."));
		}
	};
	picker.click();
}

function embedTitle(embed: Embed): string {
	if (embed.kind === "youtube") return "YouTube";
	if (embed.kind === "web-video") {
		const names: Record<string, string> = {
			tiktok: "TikTok", instagram: "Instagram", x: "X", vimeo: "Vimeo",
			dailymotion: "Dailymotion", streamable: "Streamable", loom: "Loom", facebook: "Facebook"
		};
		return names[embed.provider ?? ""] ?? "V\u00eddeo web";
	}
	const name = embed.src.split("/").pop() || embed.src;
	return name;
}

/** A real canvas attachment for formats that are not browser-renderable. */
/** Card that jumps to another note or whiteboard of the vault; notes show a short preview. */
function mountLinkCard(host: EmbedHost, layer: HTMLElement, embed: Embed): void {
	const card = layer.createDiv({ cls: "notelens-attachment-card notelens-link-card" });
	card.setAttr("data-id", embed.id);
	card.setAttr("data-kind", embed.kind);
	card.style.left = `${embed.x}px`;
	card.style.top = `${embed.y}px`;
	if (embed.rotation) card.style.transform = `rotate(${embed.rotation}deg)`;
	card.style.width = `${embed.w || 320}px`;

	const head = card.createDiv({ cls: "notelens-link-head" });
	setIcon(head.createDiv({ cls: "notelens-attachment-icon" }), KIND_ICONS[embed.kind]);
	const details = head.createDiv({ cls: "notelens-attachment-details" });
	const file = host.app.vault.getAbstractFileByPath(embed.src);
	const name = file instanceof TFile ? file.basename : embed.src.split("/").pop()?.replace(/\.[^.]+$/, "") ?? embed.src;
	details.createDiv({ cls: "notelens-attachment-title", text: name });
	const folder = embed.src.includes("/") ? embed.src.slice(0, embed.src.lastIndexOf("/")) : "";
	details.createDiv({ cls: "notelens-attachment-meta", text: (embed.kind === "board" ? "Pizarra" : "Nota") + (folder ? tr(" · {p0}", { p0: folder }) : "") });

	const open = head.createEl("button", { cls: "notelens-attachment-open" });
	setIcon(open, "external-link");
	open.title = embed.kind === "board" ? tr("Abrir la pizarra (Ctrl: en pestaña nueva)") : tr("Abrir la nota (Ctrl: en pestaña nueva)");
	open.onclick = (e) => { e.stopPropagation(); host.openLink(embed.src, e.ctrlKey || e.metaKey); };
	const remove = head.createEl("button", { cls: "notelens-embed-close notelens-object-close" });
	setIcon(remove, "x");
	remove.title = tr("Quitar el enlace de la pizarra");
	remove.setAttr("aria-label", tr("Quitar el enlace de la pizarra"));
	remove.addEventListener("pointerdown", (e) => e.stopPropagation());
	remove.onclick = (e) => { e.stopPropagation(); card.remove(); host.onEmbedDeleted(embed); };

	const preview = card.createDiv({ cls: "notelens-link-preview" });
	if (!(file instanceof TFile)) {
		preview.setText(tr("No se encuentra el archivo. ¿Se ha movido o borrado?"));
		card.addClass("is-missing");
	} else if (embed.kind === "note") {
		void host.app.vault.cachedRead(file).then(content => {
			preview.setText(notePreview(content) || tr("Nota vacía"));
		}).catch(() => preview.setText(""));
	} else {
		preview.setText(tr("Doble clic para ir a esta pizarra."));
	}

	card.addEventListener("pointerdown", (e) => host.startEmbedDrag(e, card, embed));
	card.addEventListener("dblclick", (e) => {
		e.stopPropagation();
		e.preventDefault();
		host.openLink(embed.src, e.ctrlKey || e.metaKey);
	});
}

function mountAttachmentCard(host: EmbedHost, layer: HTMLElement, embed: Embed): void {
	const card = layer.createDiv({ cls: "notelens-attachment-card" });
	card.setAttr("data-id", embed.id);
	card.style.left = `${embed.x}px`;
	card.style.top = `${embed.y}px`;
	if (embed.rotation) card.style.transform = `rotate(${embed.rotation}deg)`;
	card.style.width = `${embed.w || 360}px`;

	const icon = card.createDiv({ cls: "notelens-attachment-icon" });
	setIcon(icon, KIND_ICONS[embed.kind] ?? "paperclip");
	const details = card.createDiv({ cls: "notelens-attachment-details" });
	details.createDiv({ cls: "notelens-attachment-title", text: embedTitle(embed) });
	const extension = embed.src.split(".").pop()?.toUpperCase() || "ARCHIVO";
	details.createDiv({ cls: "notelens-attachment-meta", text: extension });

	const open = card.createEl("button", { cls: "notelens-attachment-open" });
	setIcon(open, "external-link");
	open.title = embed.kind === "epub" ? tr("Abrir EPUB") : tr("Abrir archivo");
	open.onclick = (e) => {
		e.stopPropagation();
		host.openVaultFile(embed.src);
	};

	const remove = card.createEl("button", { cls: "notelens-embed-close notelens-object-close" });
	setIcon(remove, "x");
	remove.title = tr("Quitar archivo de la pizarra");
	remove.setAttr("aria-label", tr("Quitar archivo de la pizarra"));
	remove.addEventListener("pointerdown", (e) => e.stopPropagation());
	remove.onclick = (e) => {
		e.stopPropagation();
		card.remove();
		host.onEmbedDeleted(embed);
	};

	card.addEventListener("pointerdown", (e) => host.startEmbedDrag(e, card, embed));
	card.addEventListener("dblclick", (e) => {
		e.stopPropagation();
		host.selectEmbed(embed);
	});
}

// ---------------------------------------------------------------------------
// PDF floating viewer (one page at a time)
// ---------------------------------------------------------------------------

async function mountPdfViewer(host: EmbedHost, header: HTMLElement, body: HTMLElement, embed: Embed): Promise<void> {
	const pdf = await loadPdf(host, embed.src);
	if (!pdf) {
		body.createDiv({ cls: "notelens-embed-missing", text: tr("No se pudo cargar: {p0}", { p0: embed.src }) });
		return;
	}

	// Header page navigation
	const nav = header.createDiv({ cls: "notelens-pdf-nav" });
	const closeControl = header.querySelector(".notelens-embed-close");
	if (closeControl) header.insertBefore(nav, closeControl);
	const prevBtn = nav.createEl("button", { cls: "notelens-pdf-nav-btn" });
	setIcon(prevBtn, "chevron-left");
	const pageLabel = nav.createSpan({ cls: "notelens-pdf-page" });
	const nextBtn = nav.createEl("button", { cls: "notelens-pdf-nav-btn" });
	setIcon(nextBtn, "chevron-right");
	for (const btn of [prevBtn, nextBtn]) {
		btn.addEventListener("pointerdown", (e) => e.stopPropagation());
	}

	const wrap = body.createDiv({ cls: "notelens-pdf-wrap" });
	const canvas = wrap.createEl("canvas", { cls: "notelens-pdf-canvas" });

	let current = clamp(embed.page ?? 1, 1, pdf.numPages);
	let renderToken = 0;

	async function showPage(n: number): Promise<void> {
		current = clamp(n, 1, pdf.numPages);
		const token = ++renderToken;
		try {
			const page = await pdf.getPage(current);
			const { viewport, cssHeight } = pdfViewport(page, embed.w);

			canvas.width = Math.floor(viewport.width);
			canvas.height = Math.floor(viewport.height);
			canvas.style.width = `${embed.w}px`;
			canvas.style.height = `${cssHeight}px`;

			const ctx = canvas.getContext("2d");
			if (!ctx) return;
			await page.render({ canvasContext: ctx, viewport }).promise;
			if (token !== renderToken) return; // superseded by a newer render

			pageLabel.setText(tr("{p0} / {p1}", { p0: current, p1: pdf.numPages }));
			embed.page = current;
			host.onEmbedChanged();
		} catch (e) {
			if (token === renderToken) console.error("NoteLens: PDF page render failed", e);
		}
	}

	prevBtn.onclick = () => void showPage(current - 1);
	nextBtn.onclick = () => void showPage(current + 1);

	void showPage(current);
}

// ---------------------------------------------------------------------------
// PDF loose pages: every page pasted vertically on the canvas, frame-less.
// Lazy-rendered as they approach the viewport so huge books stay light.
// ---------------------------------------------------------------------------

async function mountPdfPages(host: EmbedHost, layer: HTMLElement, embed: Embed): Promise<void> {
	const stack = layer.createDiv({ cls: "notelens-pdf-stack" });
	stack.setAttr("data-id", embed.id);
	stack.style.left = `${embed.x}px`;
	stack.style.top = `${embed.y}px`;
	if (embed.rotation) stack.style.transform = `rotate(${embed.rotation}deg)`;
	stack.style.width = `${embed.w}px`;

	// The close control stays visible so loose pages behave like every other object.
	const controls = stack.createDiv({ cls: "notelens-stack-controls" });
	const delBtn = controls.createEl("button", { cls: "notelens-embed-close notelens-object-close" });
	setIcon(delBtn, "x");
	delBtn.title = tr("Quitar documento de la pizarra");
	delBtn.setAttr("aria-label", tr("Quitar documento de la pizarra"));
	delBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
	delBtn.onclick = (e) => {
		e.stopPropagation();
		stack.remove();
		host.onEmbedDeleted(embed);
	};

	stack.addEventListener("pointerdown", (e) => {
		host.startEmbedDrag(e, stack, embed);
	});

	stack.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		menu.addItem(item => item
			.setTitle(tr("Eliminar documento"))
			.setIcon("trash-2")
			.onClick(() => {
				stack.remove();
				host.onEmbedDeleted(embed);
			}));
		menu.showAtMouseEvent(e);
	});

	const pdf = await loadPdf(host, embed.src);
	if (!pdf) {
		stack.createDiv({ cls: "notelens-embed-missing", text: tr("No se pudo cargar: {p0}", { p0: embed.src }) });
		return;
	}

	const rendered = new Set<number>();

	// Aspect ratio of page 1 as placeholder estimate for every page.
	const firstPage = await pdf.getPage(1);
	const firstBase = firstPage.getViewport({ scale: 1 });
	const estimatedRatio = firstBase.height / firstBase.width;

	async function renderPage(pageNum: number, canvas: HTMLCanvasElement): Promise<void> {
		if (rendered.has(pageNum)) return;
		rendered.add(pageNum);
		try {
			const page = await pdf.getPage(pageNum);
			const { viewport, cssHeight } = pdfViewport(page, embed.w);

			canvas.width = Math.floor(viewport.width);
			canvas.height = Math.floor(viewport.height);
			canvas.style.width = `${embed.w}px`;
			canvas.style.height = `${cssHeight}px`;
			const holder = canvas.parentElement;
			if (holder) holder.setCssStyles({ height: "" });

			const ctx = canvas.getContext("2d");
			if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
		} catch (e) {
			console.error(`NoteLens: PDF page ${pageNum} render failed`, e);
		}
	}

	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			const holder = entry.target as HTMLElement;
			const pageNum = parseInt(holder.getAttr("data-page") || "0", 10);
			const canvas = holder.querySelector("canvas");
			if (pageNum > 0 && canvas) void renderPage(pageNum, canvas);
		}
	}, { rootMargin: "800px" });

	for (let n = 1; n <= pdf.numPages; n++) {
		const holder = stack.createDiv({ cls: "notelens-pdf-page-holder" });
		holder.setAttr("data-page", String(n));
		holder.style.height = `${Math.floor(embed.w * estimatedRatio)}px`;
		holder.style.marginBottom = `${PAGE_GAP}px`;
		holder.createEl("canvas", { cls: "notelens-pdf-canvas" });
		observer.observe(holder);
	}

	// Cache the page count so future openings can size holders instantly.
	if (embed.pages !== pdf.numPages) {
		embed.pages = pdf.numPages;
		host.onEmbedChanged();
	}
}

// ---------------------------------------------------------------------------
// Loose images: pasted straight onto the canvas, no frame (like PDF pages)
// ---------------------------------------------------------------------------

function mountLooseImage(host: EmbedHost, layer: HTMLElement, embed: Embed): void {
	const wrap = layer.createDiv({ cls: "notelens-loose-image" });
	wrap.setAttr("data-id", embed.id);
	wrap.style.left = `${embed.x}px`;
	wrap.style.top = `${embed.y}px`;
	wrap.style.width = `${embed.w}px`;
	wrap.style.transform = embed.rotation ? `rotate(${embed.rotation}deg)` : "";

	const file = host.app.vault.getAbstractFileByPath(embed.src);
	if (file instanceof TFile) {
		const img = wrap.createEl("img", { cls: "notelens-embed-img" });
		img.src = host.app.vault.getResourcePath(file);
		img.draggable = false;
	} else {
		wrap.createDiv({ cls: "notelens-embed-missing", text: tr("Imagen no encontrada: {p0}", { p0: embed.src }) });
	}

	// Permanent close control, matching framed files and charts.
	const controls = wrap.createDiv({ cls: "notelens-stack-controls" });
	const delBtn = controls.createEl("button", { cls: "notelens-embed-close notelens-object-close" });
	setIcon(delBtn, "x");
	delBtn.title = tr("Quitar imagen de la pizarra");
	delBtn.setAttr("aria-label", tr("Quitar imagen de la pizarra"));
	delBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
	delBtn.onclick = (e) => {
		e.stopPropagation();
		wrap.remove();
		host.onEmbedDeleted(embed);
	};

	wrap.addEventListener("pointerdown", (e) => {
		host.startEmbedDrag(e, wrap, embed);
	});

	wrap.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		menu.addItem(item => item
			.setTitle(tr("Eliminar imagen"))
			.setIcon("trash-2")
			.onClick(() => {
				wrap.remove();
				host.onEmbedDeleted(embed);
			}));
		menu.showAtMouseEvent(e);
	});

	// Resize via corner handle (width only; height follows the aspect ratio)
	const handle = wrap.createDiv({ cls: "notelens-embed-resize" });
	handle.addEventListener("pointerdown", (e) => {
		e.stopPropagation();
		e.preventDefault();
		host.onDragStart();
		const startX = e.clientX;
		const origW = embed.w;
		const scale = currentScale(wrap);

		const onMove = (ev: PointerEvent) => {
			embed.w = Math.max(80, origW + (ev.clientX - startX) / scale);
			wrap.style.width = `${embed.w}px`;
			host.onEmbedChanged();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			host.onEmbedChanged();
			host.onDragEnd();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	});
}

// ---------------------------------------------------------------------------
// Frame interactions
// ---------------------------------------------------------------------------

function setupFrameDrag(host: EmbedHost, header: HTMLElement, frame: HTMLElement, embed: Embed): void {
	header.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		if ((e.target as HTMLElement).closest(".notelens-embed-close, .notelens-embed-open, .notelens-pdf-nav")) return;
		if (host.shouldPassPointerToCanvas()) return;
		// Frame headers are draggable with any tool (force=true).
		host.startEmbedDrag(e, frame, embed, true);
	});
}

function setupFrameResize(host: EmbedHost, frame: HTMLElement, embed: Embed): void {
	const handle = frame.createDiv({ cls: "notelens-embed-resize" });
	handle.addEventListener("pointerdown", (e) => {
		e.stopPropagation();
		e.preventDefault();
		host.onDragStart();
		const startX = e.clientX;
		const startY = e.clientY;
		const origW = embed.w;
		const origH = embed.h;
		const scale = currentScale(frame);

		const onMove = (ev: PointerEvent) => {
			embed.w = Math.max(MIN_W, origW + (ev.clientX - startX) / scale);
			embed.h = Math.max(MIN_H, origH + (ev.clientY - startY) / scale);
			frame.style.width = `${embed.w}px`;
			if (embed.kind !== "image") frame.style.height = `${embed.h}px`;
			host.onEmbedChanged();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			host.onEmbedChanged();
			host.onDragEnd();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	});
}

/** Reads the current zoom from the stage's CSS transform. */
function currentScale(el: HTMLElement): number {
	const stage = el.closest(".onenote-stage") as HTMLElement | null;
	if (!stage) return 1;
	const s = /scale\(([^)]+)\)/.exec(stage.style.transform || "");
	return s ? parseFloat(s[1]) : 1;
}

// ---------------------------------------------------------------------------
// Insert modals
// ---------------------------------------------------------------------------

export class PdfPickModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder(tr("Elige un PDF de la bóveda…"));
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter(f => f.extension.toLowerCase() === "pdf");
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.onPick(item);
	}
}

/** Picker for images already stored in the vault. Clipboard paste remains available too. */
export class ImagePickModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder(tr("Elige una imagen de la bóveda…"));
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter(file => ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(file.extension.toLowerCase()));
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.onPick(item);
	}
}

/** One picker for every file type available in the vault. */
/** Picks a Markdown note or another whiteboard, newest first. */
export class NoteOrBoardPickModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private currentPath: string | null, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder(tr("Nota o pizarra a la que enlazar…"));
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles()
			.filter(file => ["md", "notelens", "onenote"].includes(file.extension.toLowerCase()) && file.path !== this.currentPath)
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	getItemText(item: TFile): string {
		return (item.extension.toLowerCase() === "md" ? "Nota: " : "Pizarra: ") + item.path;
	}

	onChooseItem(item: TFile): void {
		this.onPick(item);
	}
}

export class VaultFilePickModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder(tr("Busca cualquier archivo de la bóveda…"));
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter(file => !["notelens", "onenote"].includes(file.extension.toLowerCase()));
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.onPick(item);
	}
}

/** Lets the user choose how a PDF is embedded: floating viewer or loose pages. */
export class PdfModeModal extends Modal {
	constructor(app: App, private onPick: (mode: "viewer" | "pages") => void) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: tr("¿Cómo insertar el PDF?") });

		const make = (icon: string, title: string, desc: string, mode: "viewer" | "pages") => {
			const btn = contentEl.createDiv({ cls: "notelens-mode-choice" });
			const head = btn.createDiv({ cls: "notelens-mode-title" });
			setIcon(head.createSpan({ cls: "notelens-mode-icon" }), icon);
			head.createSpan({ text: tr(" {p0}", { p0: title }) });
			btn.createDiv({ cls: "notelens-mode-desc", text: desc });
			btn.onclick = () => {
				this.close();
				this.onPick(mode);
			};
		};

		make(
			"picture-in-picture-2",
			"Visor flotante",
			"Ventana compacta con navegación página a página.",
			"viewer"
		);
		make(
			"layers",
			"Páginas en el lienzo",
			"Cada página se pega verticalmente sobre la pizarra — ideal para rellenar ejercicios encima con el lápiz.",
			"pages"
		);
	}
}

export class VideoInsertModal extends Modal {
	constructor(app: App, private onPick: (embed: Embed) => void) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: tr("Insertar vídeo") });
		contentEl.createEl("p", {
			text: tr("Pega un enlace de YouTube/Shorts, TikTok, Instagram, X, Vimeo, Dailymotion, Streamable, Loom o Facebook; también puedes usar un vídeo local."),
			cls: "notelens-modal-hint"
		});

		let value = "";
		const submit = () => {
			const v = value.trim();
			if (!v) return;

			const remote = toRemoteVideoEmbed(v);
			if (remote) {
				this.close();
				this.onPick({
					id: genId("embed"), kind: "web-video", src: remote.embedUrl || remote.originalUrl, originalUrl: remote.originalUrl,
					provider: remote.provider, x: 0, y: 0, w: remote.width, h: remote.height
				});
				return;
			}

			const file = this.app.vault.getAbstractFileByPath(v);
			const ext = v.split(".").pop()?.toLowerCase() ?? "";
			if (file instanceof TFile && VIDEO_EXTENSIONS.includes(ext)) {
				this.close();
				this.onPick({ id: genId("embed"), kind: "video", src: v, x: 0, y: 0, w: 560, h: 315 });
				return;
			}

			new Notice(tr("Usa un enlace de vídeo compatible o la ruta de un vídeo de la bóveda."));
		};

		new Setting(contentEl)
			.setName(tr("URL o ruta"))
			.addText(text => {
				text.setPlaceholder(tr("https://instagram.com/reel/... o carpeta/video.mp4"));
				text.onChange(v => { value = v; });
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") { e.preventDefault(); submit(); }
				});
				window.setTimeout(() => text.inputEl.focus(), 50);
			});

		new Setting(contentEl)
			.addButton(btn => btn.setButtonText(tr("Insertar")).setCta().onClick(submit))
			.addButton(btn => btn.setButtonText(tr("Cancelar")).onClick(() => this.close()));
	}
}
