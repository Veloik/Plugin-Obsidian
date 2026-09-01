import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots8");
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
	for (const [x, y] of pts.slice(1)) { await page.mouse.move(x, y, { steps: 3 }); }
	await page.mouse.up();
};
const curve = (x0, y0, w, h, n = 20) => Array.from({ length: n }, (_, i) => [x0 + (w * i) / (n - 1), y0 + Math.sin((i / (n - 1)) * Math.PI * 2) * h]);
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const sel = () => page.evaluate(() => ({ strokes: __view.selStrokes.size, texts: __view.selTexts.size, mode: __view.selectionMode, tool: __view.currentTool }));

// three strokes; lasso around the middle one only
await tool("pen");
await drag(curve(200, 300, 300, 20));
await drag(curve(200, 420, 300, 20));
await drag(curve(200, 540, 300, 20));
await page.keyboard.press("l");
console.log("after L:", JSON.stringify(await sel()));
const ring = Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return [350 + Math.cos(a) * 200, 420 + Math.sin(a) * 60]; });
await drag([...ring, ring[0]]);
await sleep(80);
console.log("lasso middle stroke:", JSON.stringify(await sel()));
await shot(page, "01-lasso");

// links in text
await tool("text");
await page.mouse.click(1000, 300);
await sleep(120);
await page.evaluate(() => { const ed = document.querySelector(".notelens-text-editor"); ed.value = "Ver [[Apuntes de física|los apuntes]] y https://es.wikipedia.org/wiki/Fuerza para repasar"; ed.dispatchEvent(new Event("input")); });
await page.mouse.click(1200, 820);
await sleep(150);
console.log("links:", await page.evaluate(() => [...document.querySelectorAll(".notelens-link")].map(a => [a.className, a.textContent, a.title])));
await shot(page, "02-links");

// search
await page.keyboard.down("Control"); await page.keyboard.press("f"); await page.keyboard.up("Control");
await sleep(80);
await page.keyboard.type("apuntes");
await sleep(400);
console.log("search:", await page.evaluate(() => [document.querySelector(".notelens-search-count").textContent, document.querySelectorAll(".notelens-search-hit").length, !!document.querySelector(".notelens-search-current")]));
await shot(page, "03-search");
await page.keyboard.press("Escape");
await sleep(80);
console.log("search closed:", await page.evaluate(() => !document.querySelector(".notelens-search") && !document.querySelector(".notelens-search-hit")));

// fit to content + shortcuts panel
await page.evaluate(() => { __view.data.viewTransform.x = 900; __view.data.viewTransform.scale = 2.5; __view.applyStageTransform(); });
await page.click(".notelens-nav-fit");
await sleep(500);
console.log("fit:", await page.evaluate(() => ({ ...__view.data.viewTransform })));
await page.click(".notelens-nav-help");
await sleep(80);
console.log("shortcuts open:", await page.evaluate(() => !document.querySelector(".notelens-shortcuts").classList.contains("hidden")));
await shot(page, "04-fit-shortcuts");

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
