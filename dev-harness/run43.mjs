// The ink equation dialog behind the formula button, OneNote style.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots43"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 950 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.setRequestInterception(true);
page.on("request", (r) => { const u = r.url(); if (u.includes("11434")) return void r.abort("connectionrefused"); r.continue(); });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const drag = async (pts, steps = 3) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps }); await page.mouse.up(); };

// ---- one button fewer in the crowded insert row
console.log("insert dock buttons:", await page.evaluate(() => [...document.querySelectorAll(".notelens-insert-dock button")].length));
console.log("no separate OCR button:", await page.evaluate(() => ![...document.querySelectorAll(".notelens-insert-dock button")].some(b => b.title.startsWith("Pizarra →"))));

// ---- the formula button opens the ink dialog
await clean();
await page.click(".notelens-insert-dock button[title^='Insertar ecuación']");
await sleep(500);
const dialog = await page.evaluate(() => {
	const d = document.querySelector(".notelens-ink-equation");
	if (!d) return "MISSING";
	return {
		title: d.querySelector("h3")?.textContent,
		hasPreview: !!d.querySelector(".notelens-ink-preview"),
		hasBoard: !!d.querySelector(".notelens-ink-board canvas"),
		tools: [...d.querySelectorAll(".notelens-ink-tool")].map(t => t.textContent),
		footer: [...d.querySelectorAll(".notelens-ink-footer button")].map(b => b.textContent),
		sourceField: !!d.querySelector(".notelens-ink-source")
	};
});
console.log("dialog:", JSON.stringify(dialog, null, 1));
await page.screenshot({ path: path.join(shots, "150-ink-dialog.png") });

// ---- writing on the pad hides the hint and keeps the strokes
const board = await page.evaluate(() => { const c = document.querySelector(".notelens-ink-board canvas"); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
await drag([[board.x + 60, board.y + 60], [board.x + 60, board.y + 160]], 4);
await drag([[board.x + 40, board.y + 110], [board.x + 90, board.y + 110]], 4);
await drag([[board.x + 150, board.y + 70], [board.x + 200, board.y + 150]], 4);
await sleep(300);
console.log("hint hidden after writing:", await page.evaluate(() => document.querySelector(".notelens-ink-hint").classList.contains("hidden-hint")));
await page.screenshot({ path: path.join(shots, "151-ink-written.png") });

// ---- the notation field drives the preview live
await page.evaluate(() => { const i = document.querySelector(".notelens-ink-source"); i.value = "h = (E)/(2) gamma int"; i.dispatchEvent(new Event("input")); });
await sleep(700);
console.log("preview renders:", await page.evaluate(() => {
	const p = document.querySelector(".notelens-ink-preview");
	return { hasMath: !!p.querySelector("mjx-container, .MathJax, svg"), text: p.textContent.slice(0, 30) };
}));
await page.screenshot({ path: path.join(shots, "152-ink-preview.png") });

// ---- erase and undo work on the ink
const strokesBefore = await page.evaluate(() => document.querySelectorAll(".notelens-ink-board canvas").length);
await page.evaluate(() => [...document.querySelectorAll(".notelens-ink-tool")].find(t => t.textContent.includes("Deshacer")).click());
await sleep(200);
console.log("undo kept the dialog alive:", await page.evaluate(() => !!document.querySelector(".notelens-ink-board canvas")), strokesBefore === 1);
await page.evaluate(() => [...document.querySelectorAll(".notelens-ink-tool")].find(t => t.textContent.includes("Eliminar")).click());
await sleep(200);
console.log("after Eliminar · hint back:", await page.evaluate(() => !document.querySelector(".notelens-ink-hint").classList.contains("hidden-hint")), "· notation cleared:", await page.evaluate(() => document.querySelector(".notelens-ink-source").value === ""));

// ---- inserting places the formula
await page.evaluate(() => { const i = document.querySelector(".notelens-ink-source"); i.value = "(a)/(b) + sqrt(x)"; i.dispatchEvent(new Event("input")); });
await sleep(400);
const before = await page.evaluate(() => __view.data.texts.length);
await page.evaluate(() => [...document.querySelectorAll(".notelens-ink-footer button")].find(b => b.textContent === "Insertar").click());
await sleep(400); await clean();
console.log("formula placed:", before, "->", await page.evaluate(() => __view.data.texts.length), await page.evaluate(() => __view.data.texts.filter(t => t.variant === "math").map(t => t.text)));
console.log("dialog closed:", await page.evaluate(() => !document.querySelector(".notelens-ink-equation")));
console.log("console issues:", errors.length ? errors.join("\n") : "(none)");
await browser.close();
