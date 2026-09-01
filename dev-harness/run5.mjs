import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots5");
fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + ".png") }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));

const drag = async (pts, mods = {}) => {
	if (mods.shift) await page.keyboard.down("Shift");
	await page.mouse.move(pts[0][0], pts[0][1]);
	await page.mouse.down();
	for (const [x, y] of pts.slice(1)) { await page.mouse.move(x, y, { steps: 4 }); }
	await page.mouse.up();
	if (mods.shift) await page.keyboard.up("Shift");
};
const curve = (x0, y0, w, h, n = 24) => Array.from({ length: n }, (_, i) => [x0 + (w * i) / (n - 1), y0 + Math.sin((i / (n - 1)) * Math.PI * 2) * h]);
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const counts = async () => page.evaluate(() => ({
	strokes: __view.data.strokes.length, pts: __view.data.strokes.map(s => s.points.length), shapes: __view.data.shapes.length,
	texts: __view.data.texts.map(t => ({ text: t.text, w: t.w, auto: !!t.autoWidth })), tool: __view.currentTool,
	sel: { strokes: __view.selStrokes.size, texts: __view.selTexts.size }
}));

// Shift = straight line
await tool("pen");
await drag(curve(200, 300, 400, 40), { shift: true });
console.log("shift line (expect 2 points):", JSON.stringify((await counts()).pts));
await drag(curve(200, 420, 400, 40));

// partial eraser cuts the wavy stroke in two
await tool("eraser");
await page.click(".notelens-panel-eraser .notelens-eraser-mode:nth-child(2)");
await drag([[400, 360], [400, 480]]);
console.log("after partial erase (expect 3 strokes):", JSON.stringify(await counts()));
await shot(page, "01-partial-eraser");

// text auto width grows with the longest line
await tool("text");
await page.mouse.click(700, 600);
await sleep(120);
await page.keyboard.type("Una linea bastante larga que deberia ensanchar la caja");
await sleep(120);
const editorW = await page.evaluate(() => document.querySelector(".notelens-text-editor").offsetWidth);
await page.mouse.click(1200, 820);
await sleep(150);
console.log("auto width editor:", editorW, JSON.stringify((await counts()).texts));
await shot(page, "02-auto-width");

// double-click on empty page with select tool starts a text box
await tool("select");
await page.mouse.click(300, 700, { clickCount: 2 });
await sleep(150);
await page.keyboard.type("Doble clic");
await page.mouse.click(1200, 820);
await sleep(150);
console.log("dblclick text:", JSON.stringify((await counts()).texts.map(t => t.text)));

// Ctrl+A, arrow nudge, Ctrl+D
await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
await sleep(80);
console.log("select all:", JSON.stringify((await counts()).sel));
const before = await page.evaluate(() => __view.data.strokes[0].points[0].x);
await page.keyboard.down("Shift"); await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift");
await sleep(80);
console.log("nudge x:", before, "->", await page.evaluate(() => __view.data.strokes[0].points[0].x));
await page.keyboard.down("Control"); await page.keyboard.press("d"); await page.keyboard.up("Control");
await sleep(150);
console.log("after duplicate:", JSON.stringify(await counts()));
await shot(page, "03-duplicate");

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
