// What editing a Word document or a presentation does to the file: text kept when
// you leave a slide and come back, pages instead of one endless sheet, Enter and
// Backspace as a word processor has them, and files made from inside the plugin.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const rels = (items) => head + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join("")}</Relationships>`;

const filler = "Texto de relleno para que cada párrafo ocupe más de una línea y el documento no quepa en una sola hoja. ";
const paragraphs = Array.from({ length: 70 }, (_, i) => `<w:p><w:r><w:t xml:space="preserve">Párrafo ${i + 1}. ${filler.repeat(2)}</w:t></w:r></w:p>`);
paragraphs.splice(10, 0, '<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
const docx = zipSync({
	"[Content_Types].xml": strToU8(head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
	"word/document.xml": strToU8(head + `<w:document ${W}><w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701"/></w:sectPr></w:body></w:document>`)
});

const slide = (n, text) => head + `<p:sld ${P} ${A} ${R}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="6400000" cy="900000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="es-ES" sz="2800"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const pptx = zipSync({
	"[Content_Types].xml": strToU8(head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>'),
	"ppt/presentation.xml": strToU8(head + `<p:presentation ${P} ${R}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
	"ppt/_rels/presentation.xml.rels": strToU8(rels([["rId1", "slide", "slides/slide1.xml"], ["rId2", "slide", "slides/slide2.xml"], ["rId3", "slide", "slides/slide3.xml"]])),
	"ppt/slides/slide1.xml": strToU8(slide(1, "Primera")),
	"ppt/slides/slide2.xml": strToU8(slide(2, "Segunda")),
	"ppt/slides/slide3.xml": strToU8(slide(3, "Tercera"))
});

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});
const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 1400, height: 1000 });
await page.evaluateOnNewDocument(() => {
	try { localStorage.clear(); } catch { /* a private window simply forgets */ }
	window.__presetSettings = { showAssistantPet: false };
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

await page.evaluate((docxBytes, pptxBytes) => {
	const v = window.__view;
	const store = {
		"D/largo.docx": { data: Uint8Array.from(docxBytes), file: new window.__TFile("D/largo.docx") },
		"D/clase.pptx": { data: Uint8Array.from(pptxBytes), file: new window.__TFile("D/clase.pptx") }
	};
	for (const s of Object.values(store)) s.file.stat = { mtime: 1, ctime: 1, size: 1 };
	window.__written = {};
	window.__store = store;
	v.app.vault.getFileByPath = (p) => store[p]?.file ?? null;
	v.app.vault.readBinary = async (f) => store[f.path].data.buffer.slice(0);
	v.app.vault.modifyBinary = async (f, buf) => { window.__written[f.path] = Array.from(new Uint8Array(buf)); f.stat.mtime += 1; };
	v.app.vault.getFolderByPath = () => ({});
	v.app.fileManager = { getAvailablePathForAttachment: async (p) => p };
	v.app.vault.createBinary = async (p, data) => {
		const file = new window.__TFile(p);
		file.stat = { mtime: 1, ctime: 1, size: 1 };
		store[p] = { data: new Uint8Array(data), file };
		return file;
	};
}, Array.from(docx), Array.from(pptx));

const mount = (src, w, h, extra = {}) => page.evaluate((s, ww, hh, x) => {
	const v = window.__view;
	v.data.embeds.length = 0;
	v.data.embeds.push({ id: "doc", pageId: v.data.activePageId, kind: "office", src: s, x: 40, y: 150, w: ww, h: hh, ...x });
	v.renderAll();
}, src, w, h, extra);
const tick = (ms) => new Promise(r => setTimeout(r, ms));

// --- Word in pages -----------------------------------------------------------
await mount("D/largo.docx", 780, 760);
await page.waitForFunction(() => document.querySelectorAll(".notelens-office-paper").length > 1, { timeout: 10000 });
const layout = await page.evaluate(() => {
	const papers = Array.from(document.querySelectorAll(".notelens-office-paper"));
	const bodies = papers.map(p => p.querySelector(".notelens-office-pagebody"));
	return {
		pages: papers.length,
		spill: bodies.filter(b => b.scrollHeight > b.clientHeight + 1).length,
		heights: papers.map(p => Math.round(p.getBoundingClientRect().height / (p.getBoundingClientRect().width / p.offsetWidth))),
		labels: papers.map(p => p.dataset.page),
		firstOfSecond: bodies[1]?.querySelector(".notelens-office-para")?.textContent.slice(0, 12),
		breakLine: !!document.querySelector(".notelens-office-breakline"),
		paras: document.querySelectorAll("p.notelens-office-para").length
	};
});
ok("el documento largo se reparte en varias hojas", layout.pages >= 3, `${layout.pages} hojas`);
ok("ninguna hoja se desborda", layout.spill === 0, JSON.stringify(layout.heights));
ok("todas las hojas miden lo mismo (A4)", new Set(layout.heights).size === 1, layout.heights.join(","));
ok("las hojas llevan su número", layout.labels[0] === `1 / ${layout.pages}`, layout.labels.join(" | "));
ok("el salto de página fuerza hoja nueva", layout.breakLine && layout.firstOfSecond?.startsWith("Párrafo 11"), layout.firstOfSecond);

// Enter splits a paragraph in two, and the page is laid out again.
const enter = await page.evaluate(() => {
	const ed = document.querySelectorAll("p.notelens-office-para")[0];
	ed.focus();
	const text = ed.firstChild.firstChild ?? ed.firstChild;
	const node = text.nodeType === 3 ? text : text.firstChild;
	const range = document.createRange();
	range.setStart(node, 10);
	range.collapse(true);
	getSelection().removeAllRanges();
	getSelection().addRange(range);
	return document.querySelectorAll("p.notelens-office-para").length;
});
await page.keyboard.press("Enter");
await tick(400);
const afterEnter = await page.evaluate(() => ({
	count: document.querySelectorAll("p.notelens-office-para").length,
	first: document.querySelectorAll("p.notelens-office-para")[0]?.textContent,
	second: document.querySelectorAll("p.notelens-office-para")[1]?.textContent.slice(0, 20),
	focused: document.activeElement === document.querySelectorAll("p.notelens-office-para")[1]
}));
ok("Enter parte el párrafo en dos", afterEnter.count === enter + 1 && afterEnter.first === "Párrafo 1.", JSON.stringify(afterEnter));
ok("el cursor pasa al párrafo nuevo", afterEnter.focused, JSON.stringify(afterEnter));

// Backspace at the start of the new paragraph joins them again.
await page.keyboard.press("Backspace");
await tick(400);
const afterBack = await page.evaluate(() => document.querySelectorAll("p.notelens-office-para").length);
ok("Retroceso al principio los vuelve a unir", afterBack === enter, `${afterBack} vs ${enter}`);

// What was typed reaches the file as paragraphs.
await page.keyboard.press("Enter");
await page.keyboard.type("Nuevo párrafo escrito");
await page.waitForFunction(() => window.__written["D/largo.docx"], { timeout: 8000 });
await tick(300);
const docXml = new TextDecoder().decode(unzipSync(Uint8Array.from(await page.evaluate(() => window.__written["D/largo.docx"])))["word/document.xml"]);
ok("los párrafos nuevos se escriben como <w:p>", (docXml.match(/<w:p>/g) ?? []).length >= 72 && docXml.includes("Nuevo párrafo escrito"), `${(docXml.match(/<w:p>/g) ?? []).length} párrafos`);
await page.screenshot({ path: path.join(here, "shots-office-pages.png") });

// --- PowerPoint: what is typed in a slide is still there after leaving and coming back ---
await mount("D/clase.pptx", 900, 560);
await page.waitForFunction(() => document.querySelector(".notelens-office-page .notelens-slide-para"), { timeout: 10000 });
const go = (label) => page.evaluate((t) => document.querySelector(`.notelens-office-ribbon [title="${t}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true })), label);
await go("Diapositiva siguiente");
await go("Diapositiva siguiente");
await tick(200);
const third = await page.evaluate(() => document.querySelector(".notelens-office-page .notelens-slide-para")?.textContent);
ok("la tercera diapositiva se abre", third === "Tercera", third);
await page.evaluate(() => {
	const ed = document.querySelector(".notelens-office-page .notelens-slide-para");
	ed.textContent = "Tercera, editada";
	ed.dispatchEvent(new Event("input", { bubbles: true }));
});
await go("Diapositiva anterior");
await tick(200);
await go("Diapositiva siguiente");
await tick(200);
const back = await page.evaluate(() => document.querySelector(".notelens-office-page .notelens-slide-para")?.textContent);
ok("al volver a la diapositiva 3 sigue lo que escribiste", back === "Tercera, editada", back);
const thumbText = await page.evaluate(() => document.querySelectorAll(".notelens-thumb")[2]?.textContent);
ok("y su miniatura lo refleja", /Tercera, editada/.test(thumbText ?? ""), thumbText);
await page.waitForFunction(() => window.__written["D/clase.pptx"], { timeout: 8000 });
const s3 = new TextDecoder().decode(unzipSync(Uint8Array.from(await page.evaluate(() => window.__written["D/clase.pptx"])))["ppt/slides/slide3.xml"]);
ok("el archivo guardado trae la diapositiva 3 editada", s3.includes("Tercera, editada"));

// Slides can be added and removed; the file follows.
await page.evaluate(() => document.querySelector(".notelens-thumb-add").click());
await tick(300);
const added = await page.evaluate(() => ({ thumbs: document.querySelectorAll(".notelens-thumb").length, options: document.querySelectorAll(".notelens-epub-chapters option").length }));
ok("se añade una diapositiva nueva", added.thumbs === 4 && added.options === 4, JSON.stringify(added));
await go("Eliminar diapositiva");
await go("Pulsa otra vez para eliminar");
await tick(300);
const removed = await page.evaluate(() => document.querySelectorAll(".notelens-thumb").length);
ok("se elimina con dos pulsaciones", removed === 3, String(removed));
await page.waitForFunction(() => window.__written["D/clase.pptx"] && true, { timeout: 8000 });
await tick(2600);
const files = unzipSync(Uint8Array.from(await page.evaluate(() => window.__written["D/clase.pptx"])));
const pres = new TextDecoder().decode(files["ppt/presentation.xml"]);
ok("el paquete conserva las tres diapositivas y ninguna huérfana", (pres.match(/<p:sldId /g) ?? []).length === 3 && Object.keys(files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length === 3, Object.keys(files).join(","));

// --- Folding and expanding ---------------------------------------------------
const fold = await page.evaluate(() => {
	const frame = document.querySelector(".notelens-office-frame");
	const buttons = frame.querySelectorAll(".notelens-embed-header .notelens-embed-open");
	buttons[0].click();
	const folded = frame.classList.contains("is-folded") && frame.getBoundingClientRect().height < 60;
	const stored = window.__view.data.embeds[0].folded;
	buttons[0].click();
	return { folded, stored, back: !frame.classList.contains("is-folded") };
});
ok("se pliega hasta la barra de título y se vuelve a desplegar", fold.folded && fold.stored === true && fold.back, JSON.stringify(fold));
const expand = await page.evaluate(() => {
	const frame = document.querySelector(".notelens-office-frame");
	frame.querySelectorAll(".notelens-embed-header .notelens-embed-open")[2].click();
	const r = frame.getBoundingClientRect();
	const w = document.querySelector(".onenote-workspace").getBoundingClientRect();
	const open = { expanded: frame.classList.contains("is-expanded"), fills: Math.abs(r.width - w.width) < 2 && Math.abs(r.height - w.height) < 2 };
	frame.querySelectorAll(".notelens-embed-header .notelens-embed-open")[2].click();
	return { ...open, back: !frame.classList.contains("is-expanded") && frame.parentElement.classList.contains("notelens-embed-layer") || !frame.classList.contains("is-expanded") };
});
ok("se expande a toda la pizarra y vuelve a su sitio", expand.expanded && expand.fills && expand.back, JSON.stringify(expand));

// --- Files made from inside the plugin ---------------------------------------------
await page.evaluate(() => { window.__view.data.embeds.length = 0; window.__view.renderAll(); });
await page.evaluate(() => window.__view.insertNewOffice("docx", "blank"));
await page.waitForFunction(() => document.querySelector(".notelens-office-paper .notelens-office-para"), { timeout: 8000 });
const fresh = await page.evaluate(() => ({
	title: document.querySelector(".notelens-office-paper .notelens-office-para")?.textContent,
	kind: window.__view.data.embeds[0]?.kind,
	styles: Array.from(document.querySelectorAll(".notelens-office-style option")).map(o => o.textContent).join(","),
	lists: [...document.querySelectorAll(".notelens-office-ribbon [title=\"Lista con viñetas\"]:disabled, .notelens-office-ribbon [title=\"Lista numerada\"]:disabled")].length
}));
ok("un documento de Word nuevo se abre en la pizarra", fresh.kind === "office" && fresh.title === "Documento sin título", JSON.stringify(fresh));
ok("trae su galería de estilos y listas", /heading 1/.test(fresh.styles) && fresh.lists === 0, fresh.styles);
await page.evaluate(() => { window.__view.data.embeds.length = 0; window.__view.renderAll(); });
await page.evaluate(() => window.__view.insertNewOffice("pptx", "classic"));
await page.waitForFunction(() => document.querySelector(".notelens-office-page .notelens-slide-para"), { timeout: 8000 });
const deck = await page.evaluate(() => ({
	text: document.querySelector(".notelens-office-page .notelens-slide-para")?.textContent,
	thumbs: document.querySelectorAll(".notelens-thumb").length
}));
ok("una presentación nueva se abre con su diapositiva de título", deck.text === "Presentación sin título" && deck.thumbs === 1, JSON.stringify(deck));
await page.screenshot({ path: path.join(here, "shots-office-new.png") });

if (!process.exitCode) console.log("todo correcto");
await browser.close();
