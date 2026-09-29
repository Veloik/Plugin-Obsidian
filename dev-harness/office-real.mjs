// Opens real Word and PowerPoint files (read only) in the editor, photographs them,
// and reports what the files hold that the editor does not draw.
// Usage: node dev-harness/office-real.mjs <file> [<file> ...]
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { unzipSync } from "fflate";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2);
if (!files.length) { console.log("Pasa uno o más .docx/.pptx"); process.exit(1); }

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.setViewport({ width: 1500, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* nothing to forget */ } window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

const count = (text, re) => (text.match(re) ?? []).length;
for (const [index, source] of files.entries()) {
	const bytes = fs.readFileSync(source);
	const ext = path.extname(source).slice(1).toLowerCase();
	const parts = unzipSync(new Uint8Array(bytes));
	const dec = new TextDecoder();
	const inventory = {};
	if (ext === "docx") {
		const xml = dec.decode(parts["word/document.xml"] ?? new Uint8Array());
		Object.assign(inventory, {
			paragraphs: count(xml, /<w:p[ >]/g), tables: count(xml, /<w:tbl>/g), drawings: count(xml, /<w:drawing>/g), anchored: count(xml, /<wp:anchor /g),
			textboxes: count(xml, /<w:txbxContent>/g), fields: count(xml, /<w:fldChar|<w:fldSimple/g), hyperlinks: count(xml, /<w:hyperlink/g),
			sdt: count(xml, /<w:sdt>/g), footnotes: count(xml, /<w:footnoteReference/g), columns: count(xml, /<w:cols [^>]*w:num="[2-9]"/g),
			sections: count(xml, /<w:sectPr/g), headers: Object.keys(parts).filter(n => /^word\/(header|footer)\d*\.xml$/.test(n)).length,
			tabs: count(xml, /<w:tab\/>/g), lists: count(xml, /<w:numPr>/g), shapes: count(xml, /<wps:wsp|<v:shape|<w:pict/g), images: Object.keys(parts).filter(n => n.startsWith("word/media/")).length
		});
	} else {
		const slides = Object.keys(parts).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
		const all = slides.map(n => dec.decode(parts[n])).join("\n");
		Object.assign(inventory, {
			slides: slides.length, shapes: count(all, /<p:sp>/g), pictures: count(all, /<p:pic>/g), groups: count(all, /<p:grpSp>/g), tables: count(all, /<a:tbl>/g),
			charts: count(all, /<c:chart|drawingml\/2006\/chart/g), smartart: count(all, /diagram/g), connectors: count(all, /<p:cxnSp>/g), gradients: count(all, /<a:gradFill/g),
			bgPictures: count(all, /<p:bg>[\s\S]*?<a:blip/g), custGeom: count(all, /<a:custGeom>/g), rotated: count(all, / rot="-?\d+"/g), media: Object.keys(parts).filter(n => n.startsWith("ppt/media/")).length,
			layouts: Object.keys(parts).filter(n => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).length
		});
	}
	await page.evaluate((name, data) => {
		const v = window.__view;
		const file = new window.__TFile(name);
		file.stat = { mtime: 1, ctime: 1, size: data.length };
		v.app.vault.getFileByPath = (p) => (p === name ? file : null);
		v.app.vault.readBinary = async () => new Uint8Array(data).buffer;
		v.app.vault.modifyBinary = async () => { throw new Error("read only"); };
		window.__realFile = file;
	}, path.basename(source), Array.from(bytes));
	errors.length = 0;
	const result = await page.evaluate(async () => {
		document.querySelectorAll(".view-container.tab").forEach(e => e.remove());
		const view = window.__plugin.views["notelens-office-view"]({ app: window.__app, view: null });
		view.containerEl.classList.add("tab");
		view.containerEl.style.cssText = "position:fixed;inset:0;z-index:5000;background:#1e1e1e";
		view.contentEl.style.cssText = "position:absolute;inset:0";
		document.body.appendChild(view.containerEl);
		await view.onOpen?.();
		await view.onLoadFile(window.__realFile);
		await new Promise(r => setTimeout(r, 1200));
		const root = view.contentEl;
		return {
			mounted: !!root.querySelector(".notelens-office-app .notelens-office-ribbon"),
			error: root.querySelector(".notelens-embed-missing")?.textContent ?? null,
			paras: root.querySelectorAll("p.notelens-office-para").length,
			locked: root.querySelectorAll("p.is-locked").length,
			pages: root.querySelectorAll(".notelens-office-paper").length,
			images: [...root.querySelectorAll("img.notelens-office-image")].filter(i => i.complete && i.naturalWidth > 0).length,
			brokenImages: [...root.querySelectorAll("img.notelens-office-image")].filter(i => i.complete && !i.naturalWidth).length,
			slideShapes: root.querySelectorAll(".notelens-office-page .notelens-slide-shape").length,
			slidePictures: root.querySelectorAll(".notelens-office-page .notelens-slide-picture").length,
			thumbs: root.querySelectorAll(".notelens-thumb").length,
			stats: root.querySelector(".notelens-office-stats")?.textContent
		};
	});
	const pageNo = Number(process.env.PAGE ?? 0);
	if (pageNo > 0) { await page.evaluate((n) => { const p = document.querySelectorAll(".notelens-office-paper")[n - 1]; p?.scrollIntoView({ block: "start" }); }, pageNo); await new Promise(r => setTimeout(r, 500)); }
	const shot = path.join(here, `shots-real-${index + 1}.png`);
	await page.screenshot({ path: shot });
	console.log(`\n#${index + 1} ${path.basename(source)}`);
	console.log("  archivo :", JSON.stringify(inventory));
	console.log("  editor  :", JSON.stringify(result));
	if (errors.length) console.log("  errores :", errors.slice(0, 3).join(" | "));
}
await browser.close();
