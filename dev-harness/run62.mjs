// Highlighter with a chisel nib over text, and inline formatting inside a text box.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots62"); fs.mkdirSync(shots, { recursive: true });
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
const drag = async (pts) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 2 }); await page.mouse.up(); };

// A light page, so the marker is judged the way it is used: over written text.
await page.evaluate(() => { __view.setBackgroundColor("#fff8ed"); __view.setTextColor("#111827"); __view.setTextSize(22); });
const line = async (x, y, text, font) => page.evaluate((x, y, text, font) => {
	__view.setTextFont(font);
	__view.setTool("text");
	__view.createTextBoxAt(x, y, undefined, "text");
	const ed = __view.activeTextEditor;
	if (ed) { ed.focus(); document.execCommand("insertText", false, text); }
	__view.commitTextEditor();
	__view.setTool("select");
	__view.clearSelection(false);
}, x, y, text, font);

await line(220, 200, "Un resaltador de verdad deja el borde húmedo", "sans");
await line(220, 270, "y se afina cuando lo giras sobre el papel.", "sans");
await sleep(150);
await page.evaluate(() => { __view.setHighlighterColor("#facc15"); __view.setStrokeWidth(24); });
await tool("highlighter");
await drag([[225, 215], [420, 213], [640, 217], [760, 214]]);
await page.evaluate(() => __view.setHighlighterColor("#5eead4"));
await drag([[225, 285], [430, 288], [660, 283]]);
// crossing strokes: they should deepen, not wash out
await page.evaluate(() => __view.setHighlighterColor("#f0abfc"));
await drag([[300, 180], [340, 320]]);
// drawn along the nib: a real chisel thins out here
await drag([[520, 170], [610, 330]]);
await sleep(200);
await shot(page, "01-marker", { x: 180, y: 140, width: 700, height: 240 });
await shot(page, "01b-zoom", { x: 210, y: 190, width: 300, height: 60 });

// 2. inline marks and the wider set of typefaces
await page.evaluate(() => __view.setTool("select"));
await line(220, 430, "Texto **en negrita**, __subrayado__, ~~tachado~~, ==resaltado== y `código`.", "sans");
await line(220, 500, "Manuscrita: la letra de siempre", "handwriting");
await line(220, 560, "Elegante para los títulos", "elegant");
await line(220, 620, "Estrecha cuando falta sitio", "condensed");
await line(220, 680, "Máquina de escribir 1927", "typewriter");
await sleep(250);
await shot(page, "02-text", { x: 180, y: 400, width: 800, height: 340 });

// 3. the format bar while editing
await page.evaluate(() => {
	const tb = __view.data.texts.find(t => t.text.includes("negrita"));
	const el = document.querySelector(`.onenote-textbox[data-id="${tb.id}"]`);
	__view.beginTextEdit(tb, el);
});
await sleep(300);
await shot(page, "03-format-bar");
console.log("marks stored:", JSON.stringify(await page.evaluate(() => __view.data.texts[0].text)));
console.log("runs painted:", await page.evaluate(() => document.querySelectorAll(".notelens-run").length));
// A close look at the rim and the felt streaks.
await page.evaluate(() => __view.commitTextEditor());
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 3 });

await sleep(400);
await shot(page, "04-rim", { x: 220, y: 195, width: 240, height: 50 });
console.log("page errors:", errors.length ? errors.slice(0, 3) : "(none)");
await browser.close();
