import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots10");
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
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"), "anthropic in bundle:", await page.evaluate(() => /api\.anthropic\.com/.test(document.documentElement.innerHTML)));

const drag = async (pts) => {
	await page.mouse.move(pts[0][0], pts[0][1]);
	await page.mouse.down();
	for (const [x, y] of pts.slice(1)) { await page.mouse.move(x, y, { steps: 3 }); }
	await page.mouse.up();
};
const curve = (x0, y0, w, h, n = 20) => Array.from({ length: n }, (_, i) => [x0 + (w * i) / (n - 1), y0 + Math.sin((i / (n - 1)) * Math.PI * 2) * h]);
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };

// --- math box with easy notation, auto converted
await page.click(".notelens-insert-dock button[title^='Insertar fórmula']");
await sleep(150);
await page.keyboard.type("x = (-b +- sqrt(b^2-4ac))/(2a)");
await sleep(300);
console.log("preview mjx:", await page.evaluate(() => !!document.querySelector(".notelens-math-preview mjx-container")), "palette keys:", await page.evaluate(() => document.querySelectorAll(".notelens-math-key").length));
await shot(page, "01-easy-math-editing");
await page.evaluate(() => [...document.querySelectorAll(".notelens-math-key")].find(b => b.title === "Sumatorio").click());
await sleep(80);
console.log("after palette:", JSON.stringify(await page.evaluate(() => document.querySelector(".notelens-text-editor").value)));
await page.mouse.click(1200, 820);
await sleep(300);
console.log("rendered:", await page.evaluate(() => !!document.querySelector(".notelens-math-block mjx-container")), "error?", await page.evaluate(() => !!document.querySelector(".notelens-math-block mjx-merror")));
await shot(page, "02-easy-math-rendered");

// --- badges: task toggles, floating note excerpt, summary
await page.click(".onenote-quick-tags .onenote-tag-chip:nth-child(4)"); // Tarea
await page.mouse.click(300, 300); await sleep(80);
await page.click(".onenote-quick-tags .onenote-tag-chip:nth-child(2)"); // Duda
await page.mouse.click(300, 380); await sleep(80);
await page.click(".onenote-quick-tags .onenote-tag-chip:nth-child(1)"); // Importante
await page.mouse.click(300, 460); await sleep(80);
// floating note via modal textarea
await page.click(".onenote-quick-tags .onenote-tag-chip:nth-child(5)");
await page.mouse.click(300, 540); await sleep(150);
console.log("prompt textarea:", await page.evaluate(() => { const t = document.querySelector(".notelens-prompt-textarea"); return t ? [t.tagName, t.rows] : null; }));
await page.type(".notelens-prompt-textarea", "Primera línea de la nota flotante que es bastante larga para comprobar el recorte\nSegunda línea");
await page.evaluate(() => [...document.querySelectorAll(".modal button")].find(b => b.textContent === "Aceptar").click());
await sleep(150);
console.log("badges:", JSON.stringify(await page.evaluate(() => __view.data.badges.map(b => [b.tagId, b.done || false, (b.tooltip || "").slice(0, 20)]))));
console.log("note badge label:", await page.evaluate(() => [...document.querySelectorAll(".onenote-placed-badge")].pop().textContent));
// click on the task badge toggles done
{ const r = await page.evaluate(() => { const b = document.querySelector(".onenote-placed-badge").getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }); await page.mouse.click(r[0], r[1]); }
await sleep(80);
console.log("task done after click:", await page.evaluate(() => __view.data.badges[0].done));
await page.click(".onenote-tag-summary");
await sleep(120);
console.log("summary items:", await page.evaluate(() => document.querySelectorAll(".notelens-tag-summary-item").length), "pending text:", await page.evaluate(() => document.querySelector(".notelens-tag-summary .notelens-calculator-help").textContent));
await shot(page, "03-tags-summary");
await page.evaluate(() => __view.toggleTagSummary());

// --- calculator drag
await page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
console.log("calc button:", await page.evaluate(() => { const b = document.querySelector(".notelens-document-dock button[title='Calculadora científica']"); const r = b.getBoundingClientRect(); return [!!b, r.left, r.top, document.elementFromPoint(r.left + 5, r.top + 5)?.className]; }));
await page.click(".notelens-document-dock button[title='Calculadora científica']");
await sleep(100);
console.log("calc class:", await page.evaluate(() => document.querySelector(".notelens-calculator").className));
const before = await page.evaluate(() => { const r = document.querySelector(".notelens-calculator").getBoundingClientRect(); return [r.left, r.top]; });
await drag([[before[0] + 60, before[1] + 12], [before[0] - 400, before[1] + 300]]);
await sleep(80);
const after = await page.evaluate(() => { const r = document.querySelector(".notelens-calculator").getBoundingClientRect(); return [r.left, r.top]; });
console.log("calculator moved:", before, "->", after, "saved:", await page.evaluate(() => localStorage.getItem("notelens-calculator-pos")));
await page.click(".notelens-calculator-header .notelens-embed-close");

// --- minimap look + drag to pan
await tool("pen");
await drag(curve(600, 300, 400, 40));
await tool("highlighter");
await drag([[580, 420], [1000, 420]]);
await page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
await page.click(".notelens-nav-map");
await sleep(150);
await shot(page, "04-minimap");
const vtBefore = await page.evaluate(() => ({ ...__view.data.viewTransform }));
const mm = await page.evaluate(() => { const r = document.querySelector(".notelens-minimap canvas").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
await drag([[mm[0], mm[1]], [mm[0] + 40, mm[1] + 20]]);
await sleep(80);
console.log("minimap drag pan:", vtBefore, "->", await page.evaluate(() => ({ ...__view.data.viewTransform })));

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
