// A book read on the board: its chapters in order, its pictures served from
// inside the archive, and nothing of what a book may carry allowed to run.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };

// A minimal but real EPUB 3: container, package document, nav and two chapters.
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
const epub = zipSync({
	"mimetype": strToU8("application/epub+zip"),
	"META-INF/container.xml": strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
	"OEBPS/book.opf": strToU8('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Termodinamica para bachillerato</dc:title></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="cap1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="cap2.xhtml" media-type="application/xhtml+xml"/><item id="fig" href="img/figura.png" media-type="image/png"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>'),
	"OEBPS/nav.xhtml": strToU8('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="cap1.xhtml">El primer principio</a></li><li><a href="cap2.xhtml">Entropia</a></li></ol></nav></body></html>'),
	"OEBPS/cap1.xhtml": strToU8('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>El primer principio</h1><p>La energia de un sistema aislado se conserva.</p><img src="img/figura.png" alt="figura"/><script>window.__pwned = true;</script><p onclick="window.__pwned = true">Segundo parrafo</p></body></html>'),
	"OEBPS/cap2.xhtml": strToU8('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Entropia</h1><p>Una magnitud que nunca decrece en un proceso espontaneo.</p></body></html>'),
	"OEBPS/img/figura.png": png
});

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});
const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 1280, height: 900 });
await page.evaluateOnNewDocument(() => {
	try { localStorage.clear(); } catch { /* a private window simply forgets */ }
	window.__presetSettings = { showAssistantPet: false };
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

// Put the book in the vault the harness pretends to have.
await page.evaluate((bytes) => {
	const data = Uint8Array.from(bytes);
	const v = window.__view;
	const file = new window.__TFile("Libros/termo.epub");
	v.app.vault.getFileByPath = (p) => (p === "Libros/termo.epub" ? file : null);
	v.app.vault.readBinary = async () => data.buffer.slice(0);
}, Array.from(epub));

const mount = async (mode) => page.evaluate((epubMode) => {
	const v = window.__view;
	v.data.embeds.length = 0;
	v.data.embeds.push({ id: "book", pageId: v.data.activePageId, kind: "epub", src: "Libros/termo.epub", x: 200, y: 200, w: 520, h: 620, epubMode });
	v.renderAll();
}, mode);

await mount("reader");
await page.waitForFunction(() => document.querySelector(".notelens-epub-page h1"), { timeout: 10000 });
const first = await page.evaluate(() => {
	const frame = document.querySelector(".notelens-epub-frame");
	const chapters = Array.from(frame.querySelectorAll(".notelens-epub-chapters option")).map(o => o.textContent);
	return {
		title: frame.querySelector(".notelens-embed-title")?.textContent,
		heading: frame.querySelector(".notelens-epub-page h1")?.textContent,
		text: frame.querySelector(".notelens-epub-page p")?.textContent,
		chapters,
		images: Array.from(frame.querySelectorAll(".notelens-epub-page img")).map(i => i.src.slice(0, 5)),
		scripts: frame.querySelectorAll("script").length,
		handlers: frame.querySelectorAll("[onclick]").length,
		pwned: window.__pwned === true,
		overInk: !!frame.closest(".onenote-top-stage")
	};
});
ok("el libro se abre con su título", first.title === "Termodinamica para bachillerato", first.title);
ok("muestra el primer capítulo", first.heading === "El primer principio" && first.text.startsWith("La energia"), `${first.heading} · ${first.text}`);
ok("lista los capítulos por su nombre", first.chapters.join(" | ") === "1. El primer principio | 2. Entropia", first.chapters.join(" | "));
ok("las imágenes salen del propio archivo", first.images.length === 1 && first.images[0] === "blob:", JSON.stringify(first.images));
ok("nada de lo que trae el libro se ejecuta", first.scripts === 0 && first.handlers === 0 && !first.pwned, JSON.stringify({ scripts: first.scripts, handlers: first.handlers, pwned: first.pwned }));
ok("el lector queda por encima de la tinta", first.overInk);

// Turning the page, and the place being remembered.
const second = await page.evaluate(() => {
	const btns = document.querySelectorAll(".notelens-epub-frame .notelens-pdf-nav-btn");
	btns[1].click();
	return { heading: document.querySelector(".notelens-epub-page h1")?.textContent, stored: window.__view.data.embeds[0].epubChapter };
});
ok("pasa al capítulo siguiente y lo recuerda", second.heading === "Entropia" && second.stored === 1, JSON.stringify(second));

const picked = await page.evaluate(() => {
	const select = document.querySelector(".notelens-epub-chapters");
	select.value = "0";
	select.dispatchEvent(new Event("change", { bubbles: true }));
	return { heading: document.querySelector(".notelens-epub-page h1")?.textContent, stored: window.__view.data.embeds[0].epubChapter };
});
ok("el índice lleva al capítulo elegido", picked.heading === "El primer principio" && picked.stored === 0, JSON.stringify(picked));

// The two ways of having the book, and the buttons that swap between them.
const toCard = await page.evaluate(() => {
	document.querySelector(".notelens-epub-frame .notelens-embed-open").click();
	return {
		card: !!document.querySelector(".notelens-attachment-card"),
		reader: !!document.querySelector(".notelens-epub-frame"),
		mode: window.__view.data.embeds[0].epubMode
	};
});
ok("se puede dejar como ficha", toCard.card && !toCard.reader && toCard.mode === "card", JSON.stringify(toCard));

const backMode = await page.evaluate(() => {
	document.querySelector(".notelens-attachment-read").click();
	return window.__view.data.embeds[0].epubMode;
});
await page.waitForFunction(() => document.querySelector(".notelens-epub-page h1"), { timeout: 10000 });
ok("y volver a leerlo en la pizarra", backMode === "reader" && await page.evaluate(() => !!document.querySelector(".notelens-epub-frame")));

// A press on the reader is a press, not a stroke.
await page.evaluate(() => { window.__view.setTool("pen"); window.__view.data.strokes.length = 0; });
const spot = await page.evaluate(() => {
	const r = document.querySelector(".notelens-epub-page").getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(spot.x, spot.y);
await page.mouse.down();
await page.mouse.move(spot.x + 60, spot.y + 20);
await page.mouse.up();
ok("no se puede pintar sobre el libro", (await page.evaluate(() => window.__view.data.strokes.length)) === 0);

if (!process.exitCode) console.log("todo correcto");
await browser.close();
