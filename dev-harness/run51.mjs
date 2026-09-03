// The eraser: panel, pointer over ink, whole-stroke mode, the partial mode
// splitting a two-point straight line instead of deleting it, and the back
// of a stylus erasing while the pen tool stays selected.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots51");
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
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const drawPath = async (pts) => {
	await page.mouse.move(pts[0][0], pts[0][1]);
	await page.mouse.down();
	for (const [x, y] of pts.slice(1)) { await page.mouse.move(x, y, { steps: 3 }); }
	await page.mouse.up();
};
const strokes = () => page.evaluate(() => __view.data.strokes.map(s => s.points.length));

// some ink to erase
await tool("pen");
await drawPath([[300, 400], [420, 380], [540, 420], [660, 390], [780, 430]]);
await drawPath([[300, 500], [500, 500], [700, 500]]);
await drawPath([[400, 300], [400, 620]]);
console.log("strokes:", JSON.stringify(await strokes()));

// eraser panel: first click selects, second opens
await tool("eraser");
await tool("eraser");
await sleep(150);
await shot(page, "01-eraser-panel");
console.log("panel visible:", await page.evaluate(() => { const p = document.querySelector(".notelens-panel-eraser"); return p && !p.classList.contains("hidden") && getComputedStyle(p).display !== "none"; }));
await page.keyboard.press("Escape");
await sleep(80);

// pointer over ink, stroke mode
await page.mouse.move(500, 500);
await sleep(80);
await shot(page, "02-eraser-pointer-stroke");
await page.mouse.down();
await page.mouse.move(520, 500, { steps: 4 });
await sleep(60);
await shot(page, "03-eraser-active");
await page.mouse.up();
console.log("after stroke erase:", JSON.stringify(await strokes()));

// partial mode: cut the vertical two-point line in the middle
await page.evaluate(() => __view.setEraserMode("partial"));
await page.mouse.move(400, 450);
await sleep(80);
await shot(page, "04-eraser-pointer-partial");
await page.mouse.down();
await page.mouse.move(400, 470, { steps: 4 });
await page.mouse.up();
const afterPartial = await strokes();
console.log("after partial erase:", JSON.stringify(afterPartial), "split in two:", afterPartial.length === 3);
await shot(page, "05-after-partial");
const gap = await page.evaluate(() => {
	const pieces = __view.data.strokes.filter(s => s.points.every(p => Math.abs(p.x - 400) < 1)).map(s => s.points.map(p => Math.round(p.y)));
	return pieces;
});
console.log("vertical pieces (y ranges):", JSON.stringify(gap));

// the back of the stylus: button 5 erases while the pen tool stays selected
await tool("pen");
const tip = await page.evaluate(async () => {
	const ws = __view.workspaceEl;
	const fire = (type, x, y, extra) => ws.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: "pen", pointerId: 9, isPrimary: true, pressure: 0.5, ...extra }));
	const before = __view.data.strokes.length;
	fire("pointerdown", 540, 420, { button: 5, buttons: 32 });
	const cursorShown = !!document.querySelector(".notelens-eraser-pointer.is-active");
	fire("pointermove", 560, 415, { button: -1, buttons: 32 });
	fire("pointerup", 560, 415, { button: 5, buttons: 0 });
	await new Promise(r => setTimeout(r, 50));
	return { before, after: __view.data.strokes.length, cursorShown, cursorGone: !document.querySelector(".notelens-eraser-pointer"), tool: __view.currentTool };
});
console.log("stylus tip:", JSON.stringify(tip));
await shot(page, "06-after-stylus-tip");

console.log("console issues:", errors.length ? "\n" + errors.join("\n") : "(none)");
await browser.close();
