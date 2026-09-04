// Pen nibs, Casio-style calculator, PDF window close, tablet/phone layouts.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots23"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const drag = async (pts) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 2 }); await page.mouse.up(); };
const wave = (x0, y0, w, n = 40) => { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; pts.push([x0 + e * w, y0 + Math.sin(t * Math.PI * 2) * 26]); } return pts; };

// 1. every nib drawn with the same width and colour
await page.evaluate(() => { __view.setTool("select"); __view.setPenColor("#e2e8f0"); __view.setStrokeWidth(5); });
const nibs = ["ballpoint", "pencil", "fountain", "marker", "brush"];
let y = 230;
for (const nib of nibs) {
	await page.evaluate((n) => __view.setPenStyle(n), nib);
	await tool("pen");
	await drag(wave(220, y, 520));
	await page.evaluate((n, y) => { __view.setTool("text"); __view.setTextSize(18); __view.createTextBoxAt(780, y - 14, undefined, "text"); const ed = __view.activeTextEditor; if (ed) { ed.focus(); document.execCommand("insertText", false, n); } __view.commitTextEditor(); __view.setTool("select"); }, nib, y);
	y += 96;
}
console.log("styles saved:", JSON.stringify(await page.evaluate(() => __view.data.strokes.map(s => s.style))));
console.log("ribbon nib icon:", await page.evaluate(() => document.querySelector('.onenote-ribbon-dock [data-tool="pen"]').getAttribute("data-nib")));
await shot(page, "01-nibs", { x: 180, y: 170, width: 760, height: 520 });
// pen panel with preview
await tool("pen"); await tool("pen"); await sleep(120);
await shot(page, "02-pen-panel");
await page.click(".notelens-nib:nth-child(3)"); await sleep(80);
console.log("panel heading:", await page.evaluate(() => document.querySelector(".notelens-panel-pen .notelens-tool-heading").textContent));
await shot(page, "03-pen-panel-fountain", { x: 540, y: 100, width: 330, height: 420 });
await page.keyboard.press("Escape");

// 2. calculator skin
await clean(); await page.click(".notelens-document-dock button[title='Calculadora científica']"); await sleep(120);
await page.focus(".notelens-calculator-input"); await page.keyboard.type("2sin(30)^2 + 5 km to mi"); await sleep(60);
await shot(page, "04-calculator", { x: 1010, y: 55, width: 380, height: 720 });
await page.keyboard.press("Enter"); await sleep(60);
await shot(page, "05-calculator-history", { x: 1010, y: 55, width: 380, height: 720 });

// 3. PDF window with a real file
const pdfB64 = fs.readFileSync("C:/Users/jtiob/Downloads/23666_Index_resum_documentacio-merits-aportats-v3.pdf").toString("base64");
const workerUrl = pathToFileURL(path.resolve(here, "../node_modules/pdfjs-dist/build/pdf.worker.min.js")).href;
await page.evaluate((b64, workerUrl) => {
	const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
	const vault = __view.app.vault;
	vault.getAbstractFileByPath = (p) => p === "apuntes.pdf" ? new __TFile("apuntes.pdf") : null;
	vault.readBinary = async () => bytes.buffer.slice(0);
	vault.adapter.getResourcePath = (p) => p.endsWith("pdf.worker.min.js") ? workerUrl : p;
	__view.data.embeds.push({ id: "embed_pdf1", kind: "pdf", src: "apuntes.pdf", pdfMode: "viewer", x: 300, y: 250, w: 420, h: 480, page: 1 });
	__view.renderAll();
}, pdfB64, workerUrl);
await sleep(2000);
await shot(page, "06-pdf-header", { x: 290, y: 240, width: 460, height: 90 });

// 4. layouts with calculator open + pdf
for (const [w, h] of [[1180, 800], [1000, 700], [820, 1100], [640, 900]]) {
	await page.setViewport({ width: w, height: h }); await sleep(250); await clean();
	await shot(page, `07-layout-${w}x${h}`);
}
console.log("console issues:\n" + (errors.length ? errors.slice(0, 8).join("\n") : "(none)"));
await browser.close();
