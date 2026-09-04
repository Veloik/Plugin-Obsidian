// Around the rich box: old boxes with marks, sticky notes, line breaks, undo.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots66"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.evaluate(() => { __view.setBackgroundColor("#fff8ed"); __view.setTextColor("#111827"); __view.setTextSize(22); });

// 1. a box that came from somewhere else, with marks in its text and no runs
await page.evaluate(() => {
	__view.data.texts.push({ id: "legacy", pageId: __view.data.activePageId, x: 300, y: 200,
		text: "Nota vieja con **negrita** y ==resaltado==", fontSize: 22, color: "#111827", variant: "text", autoWidth: true, w: 460, h: 48 });
	__view.renderDomLayer();
});
await sleep(200);
console.log("vieja pintada:", JSON.stringify(await page.evaluate(() =>
	[...document.querySelectorAll('[data-id="legacy"] .notelens-run')].map(s => `${s.className}:${s.textContent}`))));
await page.evaluate(() => __view.beginTextEdit(__view.data.texts.find(t => t.id === "legacy"), document.querySelector('[data-id="legacy"]')));
await sleep(200);
console.log("vieja al abrir:", JSON.stringify(await page.evaluate(() => __view.activeTextEditor.innerHTML)));
await page.keyboard.press("Escape");
await sleep(150);
console.log("vieja al cerrar:", JSON.stringify(await page.evaluate(() => {
	const tb = __view.data.texts.find(t => t.id === "legacy");
	return { text: tb.text, runs: tb.runs?.length };
})));

// 2. a sticky note, with line breaks and undo
await page.evaluate(() => { __view.createStickyNoteAt(760, 200); });
await sleep(200);
await page.keyboard.type("Comprar");
await page.keyboard.press("Enter");
await page.keyboard.type("pan");
await sleep(150);
await page.click(".notelens-format-bar button[title^='Negrita']");
await sleep(120);
await page.keyboard.type(" y leche");
await sleep(150);
console.log("nota:", JSON.stringify(await page.evaluate(() => {
	const tb = __view.data.texts[__view.data.texts.length - 1];
	return { text: tb.text, sticky: tb.stickyColor, runs: tb.runs };
})));
await page.keyboard.press("Escape");
await sleep(200);
await page.screenshot({ path: path.join(shots, "01-boxes.png"), clip: { x: 260, y: 150, width: 1000, height: 280 } });

// 3. undo puts the words back the way they were
await page.evaluate(() => __view.undo());
await sleep(200);
console.log("tras deshacer:", JSON.stringify(await page.evaluate(() => __view.data.texts.map(t => t.text))));

// 4. an empty box that was opened and abandoned leaves nothing behind
const before = await page.evaluate(() => __view.data.texts.length);
await page.click('.onenote-ribbon-dock [data-tool="text"]');
await sleep(80);
await page.mouse.click(420, 620);
await sleep(200);
await page.keyboard.press("Escape");
await sleep(200);
console.log("cuadro vacío descartado:", await page.evaluate((n) => __view.data.texts.length === n, before));
console.log("page errors:", errors.length ? errors.slice(0, 3) : "(none)");
await browser.close();
