// Word and PowerPoint files opened on the board, edited there and written back
// into the same file with everything the editor never touched left alone.
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

const docx = zipSync({
	"[Content_Types].xml": strToU8(head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
	"word/document.xml": strToU8(head + `<w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Informe de laboratorio</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Objetivo: </w:t></w:r><w:r><w:rPr><w:color w:val="C00000"/><w:sz w:val="32"/></w:rPr><w:t>medir la gravedad.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Péndulo simple</w:t></w:r></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Masa</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Periodo</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr/></w:body></w:document>`)
});

const pptx = zipSync({
	"[Content_Types].xml": strToU8(head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
	"ppt/presentation.xml": strToU8(head + `<p:presentation ${P} ${R}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
	"ppt/_rels/presentation.xml.rels": strToU8(rels([["rId1", "slide", "slides/slide1.xml"], ["rId2", "slide", "slides/slide2.xml"]])),
	"ppt/slides/slide1.xml": strToU8(head + `<p:sld ${P} ${A} ${R}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="es-ES" sz="4000" b="1"/><a:t>La entropía</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="1828800"/><a:ext cx="6400000" cy="1200000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="es-ES" sz="2400"/><a:t>Nunca decrece</a:t></a:r></a:p><a:p><a:r><a:rPr sz="2000" i="1"/><a:t>en un sistema aislado</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`),
	"ppt/slides/slide2.xml": strToU8(head + `<p:sld ${P} ${A} ${R}><p:cSld><p:spTree/></p:cSld></p:sld>`),
	"ppt/slides/_rels/slide1.xml.rels": strToU8(rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]])),
	"ppt/slideLayouts/slideLayout1.xml": strToU8(head + `<p:sldLayout ${P} ${A}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="228600"/><a:ext cx="8229600" cy="900000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`),
	"ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]])),
	"ppt/slideMasters/slideMaster1.xml": strToU8(head + `<p:sldMaster ${P} ${A}><p:cSld><p:spTree/></p:cSld></p:sldMaster>`)
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
		"Docs/informe.docx": { data: Uint8Array.from(docxBytes), file: new window.__TFile("Docs/informe.docx") },
		"Docs/clase.pptx": { data: Uint8Array.from(pptxBytes), file: new window.__TFile("Docs/clase.pptx") }
	};
	for (const s of Object.values(store)) s.file.stat = { mtime: 1, ctime: 1, size: 1 };
	window.__written = {};
	v.app.vault.getFileByPath = (p) => store[p]?.file ?? null;
	v.app.vault.readBinary = async (f) => store[f.path].data.buffer.slice(0);
	v.app.vault.modifyBinary = async (f, buf) => { window.__written[f.path] = Array.from(new Uint8Array(buf)); f.stat.mtime += 1; };
}, Array.from(docx), Array.from(pptx));

const mount = (kind, src, w, h) => page.evaluate((k, s, ww, hh) => {
	const v = window.__view;
	v.data.embeds.length = 0;
	v.data.embeds.push({ id: "doc", pageId: v.data.activePageId, kind: k, src: s, x: 120, y: 120, w: ww, h: hh });
	v.renderAll();
}, kind, src, w, h);

// --- Word -----------------------------------------------------------------
await mount("office", "Docs/informe.docx", 640, 720);
await page.waitForFunction(() => document.querySelector(".notelens-office-para"), { timeout: 10000 });
const word = await page.evaluate(() => {
	const f = document.querySelector(".notelens-office-frame");
	const paras = Array.from(f.querySelectorAll(".notelens-office-para"));
	return {
		title: f.querySelector(".notelens-embed-title")?.textContent,
		heading: f.querySelector(".is-h1")?.textContent,
		colored: f.querySelector("p.notelens-office-para span[style*=\"color\"]")?.textContent,
		bold: f.querySelector("p.notelens-office-para b")?.textContent,
		list: !!f.querySelector(".is-list"),
		locked: f.querySelectorAll(".is-locked").length,
		editable: f.querySelectorAll("[contenteditable='true']").length,
		cells: f.querySelectorAll("td").length,
		total: paras.length
	};
});
ok("el Word se abre con su nombre", word.title === "informe", word.title);
ok("el título va como encabezado", word.heading === "Informe de laboratorio", word.heading);
ok("conserva el color y el tamaño de cada trozo", word.colored === "medir la gravedad.", word.colored);
ok("conserva la negrita", word.bold === "Objetivo: ", word.bold);
ok("reconoce listas y tablas", word.list && word.cells === 2, JSON.stringify(word));
ok("los campos automáticos se muestran pero no se reescriben", word.locked === 1 && word.editable === word.total - 1, JSON.stringify(word));

// Type into the paragraph and let the autosave write the file.
await page.evaluate(() => {
	const ed = document.querySelectorAll("p.notelens-office-para")[1];
	ed.appendChild(document.createTextNode(" Con hilo de 1 m."));
	ed.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForFunction(() => window.__written["Docs/informe.docx"], { timeout: 6000 });
const savedDocx = unzipSync(Uint8Array.from(await page.evaluate(() => window.__written["Docs/informe.docx"])));
const xml = new TextDecoder().decode(savedDocx["word/document.xml"]);
ok("lo escrito vuelve al mismo .docx", xml.includes("Con hilo de 1 m."), xml.slice(xml.indexOf("Objetivo") - 60, xml.indexOf("Objetivo") + 260));
ok("la negrita del párrafo sigue siendo negrita", /<w:b\/>[\s\S]{0,60}Objetivo/.test(xml));
ok("el color y el tamaño del trozo editado se conservan", xml.includes('<w:color w:val="C00000"/>') && xml.includes('<w:sz w:val="32"/>'));
ok("el campo de página no se toca", xml.includes("<w:instrText>PAGE</w:instrText>") && xml.includes('w:fldCharType="separate"'));
ok("el resto del archivo se conserva", !!savedDocx["[Content_Types].xml"]);
await page.screenshot({ path: path.join(here, "shots-office-docx.png") });

// --- the ribbon: format the paragraph you are in ---
await page.evaluate(() => {
	const ed = document.querySelectorAll("p.notelens-office-para")[2];
	ed.focus();
	const r = document.createRange();
	r.selectNodeContents(ed);
	const sel = getSelection();
	sel.removeAllRanges();
	sel.addRange(r);
});
const clickRibbon = (title) => page.evaluate((t) => { document.querySelector(`.notelens-office-ribbon [title="${t}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true })); }, title);
await clickRibbon("Negrita");
await clickRibbon("Aumentar tamaño de letra");
await clickRibbon("Centrar");
await page.evaluate(() => { document.querySelector(".notelens-office-dot").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const state = await page.evaluate(() => { const ed = document.querySelectorAll("p.notelens-office-para")[2]; return { html: ed.innerHTML, center: ed.classList.contains("is-center") }; });
ok("la barra aplica negrita, tamaño y color y centra", state.html.includes("<b>") && state.html.includes("data-pt") && state.html.includes("data-color") && state.center, state.html);
await page.waitForFunction(() => window.__written["Docs/informe.docx"].length && true, { timeout: 6000 });
await new Promise(r => setTimeout(r, 2600));
const ribbonXml = new TextDecoder().decode(unzipSync(Uint8Array.from(await page.evaluate(() => window.__written["Docs/informe.docx"])))["word/document.xml"]);
const listPara = ribbonXml.slice(ribbonXml.indexOf("Péndulo simple") - 500, ribbonXml.indexOf("Péndulo simple") + 40);
ok("la alineación y el formato se escriben en el .docx", listPara.includes('<w:jc w:val="center"/>') && listPara.includes("<w:b/>") && listPara.includes('<w:sz w:val="24"/>') && listPara.includes('<w:color w:val="000000"/>'), listPara);
await page.screenshot({ path: path.join(here, "shots-office-docx-ribbon.png") });

// --- PowerPoint -------------------------------------------------------------
await mount("office", "Docs/clase.pptx", 720, 520);
await page.waitForFunction(() => document.querySelector(".notelens-office-page .notelens-slide-para"), { timeout: 10000 });
const slide = await page.evaluate(() => {
	const f = document.querySelector(".notelens-office-frame");
	const shapes = Array.from(f.querySelectorAll(".notelens-slide-shape"));
	return {
		options: Array.from(f.querySelectorAll(".notelens-epub-chapters option")).map(o => o.textContent),
		paras: Array.from(f.querySelectorAll(".notelens-office-page .notelens-slide-para")).map(p => p.textContent),
		titleLeft: shapes[0]?.style.left,
		titleSize: f.querySelector(".notelens-office-page .notelens-slide-para")?.style.fontSize
	};
});
ok("lista las diapositivas por su título", slide.options[0] === "1. La entropía" && slide.options.length === 2, slide.options.join(" | "));
ok("muestra el texto de las formas", slide.paras.join("|") === "La entropía|Nunca decrece|en un sistema aislado", slide.paras.join("|"));
ok("el título toma su sitio de la plantilla", slide.titleLeft === "5%", slide.titleLeft);
ok("el tamaño de letra sale del archivo", /cqw$/.test(slide.titleSize), slide.titleSize);
await page.screenshot({ path: path.join(here, "shots-office-pptx.png") });

await page.evaluate(() => {
	const ed = document.querySelectorAll(".notelens-office-page .notelens-slide-para")[1];
	ed.textContent = "Nunca decrece jamás";
	ed.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForFunction(() => window.__written["Docs/clase.pptx"], { timeout: 6000 });
const savedPptx = unzipSync(Uint8Array.from(await page.evaluate(() => window.__written["Docs/clase.pptx"])));
const s1 = new TextDecoder().decode(savedPptx["ppt/slides/slide1.xml"]);
ok("el cambio de la diapositiva vuelve al .pptx", s1.includes("Nunca decrece jamás"));
ok("conserva el tamaño y el resto de párrafos", s1.includes('sz="2400"') && s1.includes("en un sistema aislado") && s1.includes('sz="4000"'));

const next = await page.evaluate(() => {
	document.querySelector(".notelens-office-frame [title=\"Diapositiva siguiente\"]").click();
	return { stored: window.__view.data.embeds[0].officeSlide, paras: document.querySelectorAll(".notelens-office-page .notelens-slide-para").length };
});
ok("pasa de diapositiva y lo recuerda", next.stored === 1 && next.paras === 0, JSON.stringify(next));

if (!process.exitCode) console.log("todo correcto");
await browser.close();
