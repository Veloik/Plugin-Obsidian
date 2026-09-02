import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots22"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
const pdfB64 = fs.readFileSync("C:/Users/jtiob/Downloads/23666_Index_resum_documentacio-merits-aportats-v3.pdf").toString("base64");
const workerUrl = pathToFileURL(path.resolve(here, "../node_modules/pdfjs-dist/build/pdf.worker.min.js")).href;
await page.evaluate((b64, workerUrl) => {
	const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
	const vault = __view.app.vault;
	vault.getAbstractFileByPath = (p) => p === "apuntes.pdf" ? new __TFile("apuntes.pdf") : null;
	vault.readBinary = async () => bytes.buffer.slice(0);
	vault.adapter.getResourcePath = (p) => p.endsWith("pdf.worker.min.js") ? workerUrl : p;
	__view.data.embeds.push({ id: "embed_pdf1", kind: "pdf", src: "apuntes.pdf", pdfMode: "viewer", x: 300, y: 250, w: 460, h: 520, page: 1 });
	__view.renderAll();
}, pdfB64, workerUrl);
await sleep(2500);
console.log("pdf header buttons:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.notelens-embed[data-id="embed_pdf1"] .notelens-embed-header button')].map(b => b.className + "|" + b.title))));
console.log("pdf body:", await page.evaluate(() => document.querySelector('.notelens-embed[data-id="embed_pdf1"] .notelens-embed-body')?.textContent?.slice(0, 80) || "(canvas)"));
await shot(page, "01-pdf-viewer");
await shot(page, "01b-pdf-header", { x: 290, y: 240, width: 500, height: 80 });

// tablet / narrow layouts with panels open
const openPanels = async () => {
	await page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
	if (!(await page.evaluate(() => __view.isCalculatorOpen()))) await page.evaluate(() => __view.toggleCalculator());
	if (!(await page.evaluate(() => __view.isTranslatorOpen()))) await page.evaluate(() => __view.translateText());
	await sleep(150);
};
for (const [w, h] of [[1180, 800], [1000, 700], [820, 1100], [640, 900]]) {
	await page.setViewport({ width: w, height: h });
	await sleep(250);
	await openPanels();
	await shot(page, `02-layout-${w}x${h}`);
}
console.log("console issues:\n" + (errors.length ? errors.slice(0, 8).join("\n") : "(none)"));
await browser.close();
