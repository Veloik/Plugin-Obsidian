import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots18");
fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const drag = async (pts) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 4 }); await page.mouse.up(); };
const curve = (x0, y0, w, h, n = 20) => Array.from({ length: n }, (_, i) => [x0 + (w * i) / (n - 1), y0 + Math.sin((i / (n - 1)) * Math.PI * 2) * h]);

// panel close buttons: visible size and position for recorder and translator
await page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
for (const [title, sel] of [["Grabar audio", ".notelens-recorder"], ["Traducir texto", ".notelens-translator"], ["Calculadora científica", ".notelens-calculator"], ["Navegar entre las pizarras", ".notelens-navigator"]]) {
	await page.click(`button[title^='${title}']`);
	await sleep(120);
	const info = await page.evaluate((s) => { const p = document.querySelector(s); const x = p.querySelector(".notelens-embed-close"); const pr = p.getBoundingClientRect(); const r = x.getBoundingClientRect(); return { visible: r.width > 0 && r.height > 0, size: [Math.round(r.width), Math.round(r.height)], atRightEdge: Math.round(pr.right - r.right), inside: r.right <= pr.right && r.top >= pr.top }; }, sel);
	console.log(sel, JSON.stringify(info));
	await page.evaluate((s) => document.querySelector(s + " .notelens-embed-close").click(), sel);
	await sleep(60);
	console.log("  closed:", await page.evaluate((s) => document.querySelector(s).classList.contains("hidden"), sel));
}
await page.click("button[title^='Traducir texto']"); await sleep(100);
await shot(page, "01-translator-x", { x: 0, y: 50, width: 420, height: 120 });
await page.evaluate(() => document.querySelector(".notelens-translator .notelens-embed-close").click());
await page.click("button[title^='Grabar audio']"); await sleep(100);
await shot(page, "02-recorder-x", { x: 0, y: 50, width: 380, height: 120 });
await page.evaluate(() => document.querySelector(".notelens-recorder .notelens-embed-close").click());

// selection look: while dragging and once selected
await tool("pen"); await page.mouse.click(700, 700);
await drag(curve(300, 400, 300, 30));
await tool("text"); await page.mouse.click(1000, 380); await sleep(100); await page.keyboard.type("Texto seleccionado"); await page.mouse.click(1200, 820); await sleep(120);
await tool("select");
await page.mouse.move(260, 340); await page.mouse.down(); await page.mouse.move(650, 480, { steps: 6 });
await shot(page, "03-marquee");
await page.mouse.move(1250, 480, { steps: 4 }); await page.mouse.up();
await sleep(100);
console.log("selection:", await page.evaluate(() => ({ strokes: __view.selStrokes.size, texts: __view.selTexts.size, bar: !!document.querySelector(".notelens-selection-bar"), actions: document.querySelectorAll(".notelens-selection-action").length, dashed: getComputedStyle(document.querySelector(".onenote-selection-box")).borderStyle })));
await shot(page, "04-selected");
const before = await page.evaluate(() => [__view.data.strokes.length, __view.data.texts.length]);
await page.evaluate(() => document.querySelector(".notelens-selection-action[title^='Duplicar']").click());
await sleep(120);
console.log("after duplicate:", before, "->", await page.evaluate(() => [__view.data.strokes.length, __view.data.texts.length]));
await page.evaluate(() => document.querySelector(".notelens-selection-action[title^='Eliminar']").click());
await sleep(120);
console.log("after delete:", await page.evaluate(() => [__view.data.strokes.length, __view.data.texts.length, !!document.querySelector(".onenote-selection-box")]));

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
