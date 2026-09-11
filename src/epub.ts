import { TFile, sanitizeHTMLToDom } from "obsidian";
import { unzipSync } from "fflate";
import { tr } from "./i18n";

/** One entry of the book's reading order. */
export interface EpubChapter {
	/** Path inside the archive, already resolved against the package document. */
	href: string;
	title: string;
}

export interface EpubBook {
	title: string;
	chapters: EpubChapter[];
	/** Every file of the archive, by its path inside it. */
	files: Record<string, Uint8Array>;
}

/** A book this big is a sign of something that is not a book. */
const MAX_EPUB_BYTES = 96 * 1024 * 1024;
const MAX_EPUB_ENTRIES = 8000;

const decoder = new TextDecoder();

/** Resolves a relative href against the folder its document lives in. */
function resolveHref(base: string, href: string): string {
	const clean = href.split("#")[0].trim();
	if (!clean) return "";
	const parts = base.split("/").slice(0, -1).concat(clean.split("/"));
	const out: string[] = [];
	for (const part of parts) {
		if (!part || part === ".") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return out.join("/");
}

/** Reads one XML file out of the archive, or null when it is not there. */
function parseXml(files: Record<string, Uint8Array>, path: string): Document | null {
	const raw = files[path];
	if (!raw) return null;
	const doc = new DOMParser().parseFromString(decoder.decode(raw), "application/xml");
	return doc.querySelector("parsererror") ? null : doc;
}

/**
 * Opens an EPUB: a zip holding a package document that lists the book's files
 * and the order they are read in. Everything is taken from the archive itself
 * — nothing is fetched, and nothing is executed.
 */
export async function openEpub(read: () => Promise<ArrayBuffer>, file: TFile): Promise<EpubBook> {
	const buffer = await read();
	if (buffer.byteLength > MAX_EPUB_BYTES) throw new Error(tr("El libro es demasiado grande para abrirlo en la pizarra."));
	let entries = 0;
	const files = unzipSync(new Uint8Array(buffer), {
		filter: () => ++entries <= MAX_EPUB_ENTRIES
	});

	const container = parseXml(files, "META-INF/container.xml");
	const opfPath = container?.querySelector("rootfile")?.getAttribute("full-path")?.trim()
		// Some books skip the container; the package document is then found by its extension.
		?? Object.keys(files).find(name => name.toLowerCase().endsWith(".opf"));
	const opf = opfPath ? parseXml(files, opfPath) : null;
	if (!opf || !opfPath) throw new Error(tr("Este EPUB no trae el índice que dice qué leer primero."));

	const hrefById = new Map<string, string>();
	for (const item of Array.from(opf.querySelectorAll("manifest > item"))) {
		const id = item.getAttribute("id");
		const href = item.getAttribute("href");
		if (id && href) hrefById.set(id, resolveHref(opfPath, href));
	}

	// The table of contents names the chapters; the spine says what order they come in.
	const titles = new Map<string, string>();
	const navPath = Array.from(opf.querySelectorAll("manifest > item"))
		.find(item => item.getAttribute("properties")?.split(/\s+/).includes("nav"))
		?.getAttribute("href");
	const nav = navPath ? parseXml(files, resolveHref(opfPath, navPath)) : null;
	for (const link of Array.from(nav?.querySelectorAll("nav a") ?? [])) {
		const href = link.getAttribute("href");
		const text = link.textContent?.trim();
		if (href && text) titles.set(resolveHref(resolveHref(opfPath, navPath ?? ""), href), text);
	}
	// EPUB 2 keeps the same thing in an NCX file instead.
	const ncxPath = hrefById.get(opf.querySelector("spine")?.getAttribute("toc") ?? "");
	const ncx = ncxPath ? parseXml(files, ncxPath) : null;
	for (const point of Array.from(ncx?.querySelectorAll("navPoint") ?? [])) {
		const href = point.querySelector("content")?.getAttribute("src");
		const text = point.querySelector("navLabel > text")?.textContent?.trim();
		if (href && text) titles.set(resolveHref(ncxPath ?? "", href), text);
	}

	const chapters: EpubChapter[] = [];
	for (const ref of Array.from(opf.querySelectorAll("spine > itemref"))) {
		if (ref.getAttribute("linear") === "no") continue;
		const href = hrefById.get(ref.getAttribute("idref") ?? "");
		if (!href || !files[href]) continue;
		chapters.push({ href, title: titles.get(href) ?? tr("Capítulo {p0}", { p0: chapters.length + 1 }) });
	}
	if (!chapters.length) throw new Error(tr("Este EPUB no trae capítulos que se puedan leer."));

	const title = opf.querySelector("metadata title")?.textContent?.trim() || file.basename;
	return { title, chapters, files };
}

/** The media type a file inside the book should be served as. */
function mimeOf(path: string): string {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	if (ext === "png") return "image/png";
	if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
	if (ext === "gif") return "image/gif";
	if (ext === "webp") return "image/webp";
	if (ext === "svg") return "image/svg+xml";
	return "application/octet-stream";
}

/**
 * Paints one chapter into an element. The markup goes through Obsidian's
 * sanitiser, so nothing the book carries can run; what survives is the text,
 * its headings and emphasis, and the pictures — which are served from the
 * archive as blobs, because a book's own files have no address of their own.
 *
 * Returns the object URLs it made, for the caller to release.
 */
export function paintEpubChapter(book: EpubBook, index: number, into: HTMLElement): string[] {
	const chapter = book.chapters[index];
	into.empty();
	if (!chapter) return [];
	const raw = book.files[chapter.href];
	if (!raw) {
		into.createDiv({ cls: "notelens-embed-missing", text: tr("Falta este capítulo dentro del libro.") });
		return [];
	}
	const source = new DOMParser().parseFromString(decoder.decode(raw), "application/xhtml+xml");
	const body = source.querySelector("body") ?? source.documentElement;
	// Serialised child by child rather than read off `innerHTML`, so the body
	// element itself is left behind and nothing but its contents is sanitised.
	const serializer = new XMLSerializer();
	const markup = Array.from(body.childNodes).map(node => serializer.serializeToString(node)).join("");
	into.appendChild(sanitizeHTMLToDom(markup));

	const urls: string[] = [];
	for (const img of Array.from(into.querySelectorAll("img"))) {
		const src = img.getAttribute("src");
		const data = src ? book.files[resolveHref(chapter.href, src)] : undefined;
		if (!data) { img.remove(); continue; }
		const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: mimeOf(src ?? "") }));
		urls.push(url);
		img.src = url;
		img.removeAttribute("srcset");
	}
	// Links inside a book point at files inside it; they lead nowhere here.
	for (const link of Array.from(into.querySelectorAll("a"))) link.removeAttribute("href");
	return urls;
}
