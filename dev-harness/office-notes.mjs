// Speaker notes: read from a deck, written under a slide, kept out of the way of copies, and saved as PowerPoint expects.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };
const tick = (ms) => new Promise(r => setTimeout(r, ms));
const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"', A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"', R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const rels = (items) => head + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join("")}</Relationships>`;
const slide = (text) => head + `<p:sld ${P} ${A} ${R}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="6400000" cy="900000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="es-ES" sz="2800"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
const notes = `${head}<p:notes ${P} ${A} ${R}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Img"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notas"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Hola</a:t></a:r></a:p><a:p><a:r><a:t>Mundo</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
const theme = `${head}<a:theme ${A} name="T"><a:themeElements/></a:theme>`;
const pptx = zipSync({
	"[Content_Types].xml": strToU8(head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
	"ppt/presentation.xml": strToU8(head + `<p:presentation ${P} ${R}><p:sldMasterIdLst/><p:notesMasterIdLst><p:notesMasterId r:id="rId9"/></p:notesMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
	"ppt/_rels/presentation.xml.rels": strToU8(rels([["rId1", "slide", "slides/slide1.xml"], ["rId2", "slide", "slides/slide2.xml"], ["rId9", "notesMaster", "notesMasters/notesMaster1.xml"]])),
	"ppt/notesMasters/notesMaster1.xml": strToU8(`${head}<p:notesMaster ${P} ${A}><p:cSld><p:spTree/></p:cSld></p:notesMaster>`),
	"ppt/theme/theme1.xml": strToU8(theme),
	"ppt/slides/slide1.xml": strToU8(slide("Primera")),
	"ppt/slides/slide2.xml": strToU8(slide("Segunda")),
	"ppt/slides/_rels/slide1.xml.rels": strToU8(rels([["rId1", "notesSlide", "../notesSlides/notesSlide1.xml"]])),
	"ppt/notesSlides/notesSlide1.xml": strToU8(notes),
	"ppt/notesSlides/_rels/notesSlide1.xml.rels": strToU8(rels([["rId1", "notesMaster", "../notesMasters/notesMaster1.xml"], ["rId2", "slide", "../slides/slide1.xml"]]))
});
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 1400, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* nothing to forget */ } window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.evaluate(async (bytes) => {
	const file = new window.__TFile("clase.pptx"); file.stat = { mtime: 1 }; window.__written = {};
	const v = window.__view;
	v.app.vault.readBinary = async () => new Uint8Array(bytes).buffer;
	v.app.vault.modifyBinary = async (f, buf) => { window.__written[f.path] = Array.from(new Uint8Array(buf)); f.stat.mtime += 1; };
	const view = window.__plugin.views["notelens-office-view"]({ app: window.__app, view: null });
	view.containerEl.style.cssText = "position:fixed;inset:0;z-index:5000"; view.contentEl.style.cssText = "position:absolute;inset:0";
	document.body.appendChild(view.containerEl); await view.onOpen?.(); await view.onLoadFile(file);
	await new Promise(r => setTimeout(r, 500));
}, Array.from(pptx));
const go = async (i) => { await page.evaluate((n) => document.querySelectorAll(".notelens-thumb")[n].click(), i); await tick(250); };
const notesValue = () => page.evaluate(() => document.querySelector(".notelens-office-notes-text")?.value);
const open = async () => { if (!(await page.evaluate(() => document.querySelector(".notelens-office-notes")?.classList.contains("is-open")))) await page.evaluate(() => document.querySelector(".notelens-office-notes-toggle").click()); await tick(100); };

ok("el panel de notas está plegado al abrir", !(await page.evaluate(() => document.querySelector(".notelens-office-notes").classList.contains("is-open"))));
await go(0);
ok("las notas del archivo se leen, párrafo a párrafo", (await notesValue()) === "Hola\nMundo", JSON.stringify(await notesValue()));
await go(1);
ok("una diapositiva sin notas las muestra vacías", (await notesValue()) === "");
await open();
await page.click(".notelens-office-notes-text");
await page.keyboard.type("Dato clave");
await page.keyboard.press("Enter");
await page.keyboard.type("Pedir preguntas");
await go(0);
await go(1);
ok("lo escrito vuelve al regresar a la diapositiva", (await notesValue()) === "Dato clave\nPedir preguntas", JSON.stringify(await notesValue()));

// Undo takes the notes away with everything else.
await page.evaluate(() => document.querySelector('.notelens-office-ribbon [title^="Deshacer"]')?.click());
await tick(200);
ok("deshacer quita las notas escritas", (await notesValue()) === "", JSON.stringify(await notesValue()));
await page.evaluate(() => document.querySelector('.notelens-office-ribbon [title^="Rehacer"]')?.click());
await tick(200);
ok("y rehacer las devuelve", (await notesValue()) === "Dato clave\nPedir preguntas", JSON.stringify(await notesValue()));

// A copy of a slide has notes of its own.
await go(0);
await page.evaluate(() => document.querySelector('.notelens-office-ribbon [title="Duplicar diapositiva"]').click());
await tick(300);
ok("una diapositiva duplicada conserva las notas", (await notesValue()) === "Hola\nMundo", JSON.stringify(await notesValue()));
await page.click(".notelens-office-notes-text");
await page.keyboard.down("Control"); await page.keyboard.press("End"); await page.keyboard.up("Control");
await page.keyboard.type(" (copia)");
await go(0);
ok("y cambiar las de la copia no toca las de la original", (await notesValue()) === "Hola\nMundo", JSON.stringify(await notesValue()));

await page.waitForFunction(() => window.__written["clase.pptx"], { timeout: 9000 });
await tick(2300);
const files = unzipSync(Uint8Array.from(await page.evaluate(() => window.__written["clase.pptx"])));
const text = (name) => new TextDecoder().decode(files[name] ?? new Uint8Array());
const slideRels = Object.keys(files).filter(f => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(f));
const targets = slideRels.map(f => /notesSlide\d+\.xml/.exec(text(f))?.[0]).filter(Boolean);
ok("cada diapositiva con notas apunta a su propia página de notas", targets.length === 3 && new Set(targets).size === 3, targets.join(","));
const notePages = Object.keys(files).filter(f => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
ok("y no queda ninguna página de notas huérfana", notePages.length === 3, notePages.join(","));
ok("el texto está en el archivo", notePages.some(f => text(f).includes("Dato clave") && text(f).includes("Pedir preguntas")) && notePages.some(f => text(f).includes("(copia)")));
ok("las páginas nuevas se declaran en [Content_Types].xml", notePages.every(f => text("[Content_Types].xml").includes(`/${f}`) || f === "ppt/notesSlides/notesSlide1.xml"));
ok("las páginas nuevas se relacionan con el patrón de notas y con su diapositiva", notePages.filter(f => f !== "ppt/notesSlides/notesSlide1.xml").every(f => { const r = text(`ppt/notesSlides/_rels/${f.split("/").pop()}.rels`); return r.includes("notesMaster") && /slides\/slide\d+\.xml/.test(r); }));
if (!process.exitCode) console.log("todo correcto");
await browser.close();
