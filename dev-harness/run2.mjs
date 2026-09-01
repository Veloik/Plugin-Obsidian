import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots2");
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

const drag = async (pts) => {
	await page.mouse.move(pts[0][0], pts[0][1]);
	await page.mouse.down();
	for (const [x, y] of pts.slice(1)) { await page.mouse.move(x, y, { steps: 4 }); }
	await page.mouse.up();
};
const curve = (x0, y0, w, h, n = 24) => Array.from({ length: n }, (_, i) => [x0 + (w * i) / (n - 1), y0 + Math.sin((i / (n - 1)) * Math.PI * 2) * h]);
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const state = async () => page.evaluate(() => ({
	strokes: __view.data.strokes.length, texts: __view.data.texts.map(t => ({ text: t.text, w: t.w, h: t.h, fontSize: t.fontSize, bold: !!t.bold })),
	tool: __view.currentTool, editor: !!document.querySelector(".notelens-text-editor"), active: document.activeElement && document.activeElement.className,
	panelOpen: !document.querySelector(".notelens-pen-panel").classList.contains("hidden"),
	bookmarksOpen: !document.querySelector(".notelens-bookmarks-panel").classList.contains("hidden"),
	rulerShown: getComputedStyle(document.querySelector(".notelens-smart-ruler")).display !== "none",
	minimapShown: getComputedStyle(document.querySelector(".notelens-minimap")).display !== "none",
	bookmarksShown: getComputedStyle(document.querySelector(".notelens-bookmarks-panel")).display !== "none"
}));

console.log("initial:", JSON.stringify(await state()));
await shot(page, "01-initial");

// ink: pen first, highlighter after -> band must still go under the ink
await tool("pen");
await drag(curve(300, 420, 400, 40));
await drag(curve(320, 520, 380, 30));
await tool("highlighter");
await drag([[280, 420], [720, 425]]);
await drag(curve(300, 620, 500, 60));
await tool("pen");
await drag([[300, 640], [800, 600]]);
await sleep(150);
await shot(page, "02-ink");

// panel toggling for text tool
await tool("text");
console.log("text tool 1st click:", JSON.stringify(await state()));
await tool("text");
console.log("text tool 2nd click:", JSON.stringify(await state()));

// text: create, type, format bar, commit
await page.mouse.click(900, 300);
await sleep(150);
console.log("after text click:", JSON.stringify(await state()));
await page.keyboard.type("Hola OneNote");
await page.keyboard.press("Enter");
await page.keyboard.type("Segunda linea del texto");
await sleep(120);
await shot(page, "03-text-editing");
// bold via format bar
const boldBtn = await page.$(".notelens-format-bar button[title='Negrita']");
if (boldBtn) { await boldBtn.click(); await sleep(80); }
console.log("after bold:", JSON.stringify(await state()));
// font select via format bar must keep the editor open
await page.select(".notelens-format-font", "serif");
await sleep(120);
console.log("after font select:", JSON.stringify(await state()));
await page.keyboard.type(" fin");
await sleep(80);
await shot(page, "04-text-formatted");
await page.mouse.click(1000, 700);
await sleep(200);
console.log("after click outside:", JSON.stringify(await state()));
await shot(page, "05-text-committed");
// panel size change applies to the still-selected box
await tool("text"); // opens panel
await page.click(".notelens-panel-text .notelens-text-size-choice[title='36px']");
await sleep(100);
console.log("after size 36 from panel:", JSON.stringify(await state()));
await shot(page, "06-text-resized");

// select tool: drag the text box
await tool("select");
await drag([[930, 330], [1030, 480]]);
await sleep(100);
const moved = await page.evaluate(() => ({ x: __view.data.texts[0].x, y: __view.data.texts[0].y }));
console.log("moved text:", JSON.stringify(moved));
await shot(page, "07-text-moved");

// bookmarks + settings mutual exclusion, ruler toggle
await page.click(".notelens-bookmarks-toggle");
await sleep(80);
console.log("bookmarks open:", JSON.stringify(await state()));
await shot(page, "08-bookmarks");
await page.click(".notelens-settings-btn");
await sleep(80);
console.log("settings open:", JSON.stringify(await state()));
await page.mouse.click(700, 300);
await sleep(80);
await page.click(".notelens-document-dock button[title='Mostrar regla inteligente']");
await sleep(80);
console.log("ruler on:", JSON.stringify(await state()));
await shot(page, "09-ruler");
await page.click(".notelens-document-dock button[title='Mostrar regla inteligente']");
await page.click(".notelens-nav-map");
await sleep(120);
await shot(page, "10-minimap");
await page.click(".notelens-nav-map");

// undo removes the last change
const beforeUndo = await page.evaluate(() => JSON.stringify([__view.data.texts[0].x, __view.data.texts[0].y]));
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
await sleep(80);
console.log("undo text pos:", beforeUndo, "->", await page.evaluate(() => JSON.stringify([__view.data.texts[0].x, __view.data.texts[0].y])));

// light page
await page.evaluate(() => __view.setBackgroundColor("#fff8ed"));
await tool("pen");
await drag(curve(300, 760, 400, 30));
await tool("highlighter");
await drag([[280, 765], [720, 765]]);
await sleep(150);
await shot(page, "11-light");

await page.setViewport({ width: 640, height: 800 });
await sleep(200);
await shot(page, "12-narrow-640");

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
