// Slide transitions: read from a deck, chosen from the ribbon, written to the file and played while presenting.
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
const slide = (text, extra = "") => head + `<p:sld ${P} ${A} ${R}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="6400000" cy="900000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="es-ES" sz="2800"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${extra}</p:sld>`;
const pptx = zipSync({
	"[Content_Types].xml": strToU8(head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
	"ppt/presentation.xml": strToU8(head + `<p:presentation ${P} ${R}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
	"ppt/_rels/presentation.xml.rels": strToU8(rels([["rId1", "slide", "slides/slide1.xml"], ["rId2", "slide", "slides/slide2.xml"], ["rId3", "slide", "slides/slide3.xml"]])),
	"ppt/slides/slide1.xml": strToU8(slide("Primera")),
	"ppt/slides/slide2.xml": strToU8(slide("Segunda", `<p:transition spd="slow"><p:push dir="u"/></p:transition><p:timing/>`)),
	"ppt/slides/slide3.xml": strToU8(slide("Tercera", `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition spd="med" p14:dur="1800"><p14:vortex xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" dir="r"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="med"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`))
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
const kindOf = async (i) => { await page.evaluate((n) => document.querySelectorAll(".notelens-thumb")[n].click(), i); await tick(250); return page.evaluate(() => document.querySelector(".notelens-office-page .notelens-slide")?.dataset.transition); };
ok("una diapositiva sin transición no lleva ninguna", (await kindOf(0)) === "none");
ok("un empujón del archivo se lee como empujón", (await kindOf(1)) === "push");
ok("un efecto de PowerPoint 2010 sin equivalente se lee como desvanecimiento", (await kindOf(2)) === "fade");
const badges = await page.evaluate(() => [...document.querySelectorAll(".notelens-thumb")].map(t => t.classList.contains("has-transition")));
ok("la tira marca con una estrella las diapositivas que tienen transición", JSON.stringify(badges) === "[false,true,true]", JSON.stringify(badges));

// Choose one from the ribbon.
await kindOf(0);
const pickMenu = (title) => page.evaluate((t) => { const item = [...document.querySelectorAll(".menu .menu-item")].find(i => i.textContent.trim() === t); if (!item) return false; item.click(); document.querySelectorAll(".menu").forEach(m => m.remove()); return true; }, title);
const openMenu = () => page.evaluate(() => document.querySelector('.notelens-office-ribbon [title="Transición"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
await openMenu();
const items = await page.evaluate(() => [...document.querySelectorAll(".menu .menu-item")].map(i => i.textContent.trim()));
ok("el menú ofrece los efectos", ["Sin transición", "Desvanecer", "Empujar", "Cubrir", "Barrido", "Zoom"].every(x => items.includes(x)), items.join("|"));
await pickMenu("Barrido");
await tick(300);
ok("elegir un efecto lo pone en la diapositiva", (await kindOf(0)) === "wipe");
await openMenu();
await pickMenu("Aplicar a todas las diapositivas");
const all = await page.evaluate(() => [...document.querySelectorAll(".notelens-thumb")].map(t => t.classList.contains("has-transition")));
ok("y se puede copiar a todas", all.every(Boolean), JSON.stringify(all));
await page.waitForFunction(() => window.__written["clase.pptx"], { timeout: 9000 });
await tick(2300);
const files = unzipSync(Uint8Array.from(await page.evaluate(() => window.__written["clase.pptx"])));
const s1 = new TextDecoder().decode(files["ppt/slides/slide1.xml"]), s3 = new TextDecoder().decode(files["ppt/slides/slide3.xml"]);
ok("el archivo lleva la transición, y una sola", /<p:transition[^>]*><p:wipe dir="l"\/><\/p:transition>/.test(s1) && (s1.match(/<p:transition/g) ?? []).length === 1, s1.slice(s1.indexOf("<p:clrMapOvr"), s1.indexOf("<p:clrMapOvr") + 260));
ok("la envoltura de compatibilidad de PowerPoint 2010 se retira al sustituirla", !/AlternateContent/.test(s3) && /<p:wipe/.test(s3) && (s3.match(/<p:transition/g) ?? []).length === 1);

// Play it while presenting.
await kindOf(0);
await page.evaluate(() => document.querySelector('.notelens-office-ribbon [title="Presentar"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
await tick(300);
await page.keyboard.press("ArrowRight");
await tick(120);
const during = await page.evaluate(() => ({ animations: document.getAnimations().length, stages: document.querySelectorAll(".notelens-office-page > .notelens-slide").length }));
ok("al pasar de diapositiva se reproduce la animación con la saliente encima", during.animations > 0 && during.stages === 2, JSON.stringify(during));
await tick(1500);
const after = await page.evaluate(() => ({ animations: document.getAnimations().length, stages: document.querySelectorAll(".notelens-office-page > .notelens-slide").length, current: document.querySelector(".notelens-office-page .notelens-slide-para")?.textContent }));
ok("y al terminar solo queda la diapositiva nueva", after.stages === 1 && after.animations === 0 && after.current === "Segunda", JSON.stringify(after));
await page.keyboard.press("Escape");
if (!process.exitCode) console.log("todo correcto");
await browser.close();
