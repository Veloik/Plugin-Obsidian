import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots3");
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
// The options panel opens when the button of the tool already in use is pressed
// again, so how many presses it takes depends on where the toolbar was.
const panelOpen = () => page.evaluate(() => !!document.querySelector(".notelens-pen-panel:not(.hidden)"));
const tool = async (id, panel = false) => {
	await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`);
	await sleep(60);
	if (panel && !(await panelOpen())) await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`);
	await sleep(80);
};
const counts = async () => page.evaluate(() => ({
	strokes: __view.data.strokes.length, shapes: __view.data.shapes.length, texts: __view.data.texts.length,
	tables: __view.data.tables.length, badges: __view.data.badges.length, tool: __view.currentTool, scale: __view.data.viewTransform.scale
}));

// shapes: rectangle with fill, arrow, ellipse
await tool("shape", true);
await page.click(".notelens-panel-shape .notelens-shape-choice[title='Rectángulo']");
await drag([[200, 300], [420, 440]]);
await tool("shape", true);
await page.click(".notelens-panel-shape .notelens-shape-choice[title='Flecha']");
await drag([[440, 370], [640, 370]]);
await tool("shape", true);
await page.click(".notelens-panel-shape .notelens-shape-choice[title='Elipse']");
await drag([[660, 300], [860, 440]]);
console.log("shapes:", JSON.stringify(await counts()));
await shot(page, "01-shapes");

// eraser on a pen stroke
await tool("pen");
await drag(curve(200, 560, 500, 30));
await drag(curve(200, 640, 500, 30));
await tool("eraser");
await drag([[450, 630], [450, 650]]);
console.log("after erase (expect 1 stroke):", JSON.stringify(await counts()));
await shot(page, "02-eraser");

// sticky note, code block, table via insert dock
await page.click(".notelens-insert-dock button[title='Nueva nota adhesiva']");
await sleep(120);
await page.keyboard.type("Nota adhesiva de prueba");
await page.mouse.click(1200, 800);
await sleep(150);
await page.click(".notelens-insert-dock button[title='Insertar bloque de código']");
await sleep(120);
await page.keyboard.type("const x = 42;");
await page.mouse.click(1200, 800);
await sleep(150);
await page.click(".notelens-insert-dock button[title='Insertar tabla']");
await sleep(150);
console.log("objects:", JSON.stringify(await counts()));
await shot(page, "03-objects");

// badge (quick tag)
await page.click(".onenote-quick-tags .onenote-tag-chip:nth-child(1)");
await sleep(60);
await page.mouse.click(1000, 250);
await sleep(100);
console.log("badge:", JSON.stringify(await counts()));

// settings panel
await page.click(".notelens-settings-btn");
await sleep(100);
await shot(page, "04-settings");
await page.mouse.click(1000, 600);

// zoomed text editing
await page.evaluate(() => { __view.zoomIn(); __view.zoomIn(); __view.zoomIn(); });
await sleep(100);
await tool("text");
await page.mouse.click(1000, 500);
await sleep(120);
await page.keyboard.type("Texto con zoom");
await sleep(80);
await shot(page, "05-zoom-text-editing");
await page.mouse.click(1250, 850);
await sleep(150);
await shot(page, "06-zoom-text-done");
console.log("zoom:", JSON.stringify(await counts()));
await page.evaluate(() => __view.resetView());

// select all-ish with rubber band, delete
await tool("select");
await drag([[150, 250], [900, 700]]);
await sleep(80);
await shot(page, "07-rubber-selected");
await page.keyboard.press("Delete");
await sleep(80);
console.log("after delete:", JSON.stringify(await counts()));

// hover hint must not appear over UI
await tool("text");
await page.mouse.move(700, 40);
await sleep(80);
console.log("hint over toolbar:", await page.evaluate(() => !!document.querySelector(".notelens-text-placement-hint")));
await page.mouse.move(700, 500);
await sleep(80);
console.log("hint over canvas:", await page.evaluate(() => !!document.querySelector(".notelens-text-placement-hint")));

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
