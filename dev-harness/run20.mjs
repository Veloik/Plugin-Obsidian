import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots20");
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
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const esc = async () => { await page.keyboard.press("Escape"); await sleep(80); };
const drag = async (pts) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 4 }); await page.mouse.up(); };

await shot(page, "00-empty");
await tool("pen"); await tool("pen"); await sleep(100); await shot(page, "01-pen-panel"); await esc();
await tool("highlighter"); await tool("highlighter"); await sleep(100); await shot(page, "02-highlighter-panel"); await esc();
await tool("eraser"); await tool("eraser"); await sleep(100); await shot(page, "03-eraser-panel"); await esc();
await tool("text"); await tool("text"); await sleep(100); await shot(page, "04-text-panel"); await esc();
await tool("shape"); await tool("shape"); await sleep(100); await shot(page, "05-shape-panel"); await esc();
await tool("select"); await tool("select"); await sleep(100); await shot(page, "06-select-panel"); await esc();
// background / settings button
await page.click(".notelens-settings-btn"); await sleep(120); await shot(page, "07-settings"); await esc();
// insert dialogs
for (const [title, name] of [["Insertar gráfico", "08-chart-dialog"], ["Enlazar", "09-link-dialog"], ["Insertar ecuación", "10-math-dialog"]]) {
	await clean();
	await page.click(`.notelens-insert-dock button[title^='${title}']`); await sleep(250); await shot(page, name);
	await page.evaluate(() => document.querySelectorAll(".modal-container").forEach(m => m.remove())); await esc();
}
await clean(); await page.click(".notelens-insert-dock button[title='Insertar tabla']"); await sleep(150); await shot(page, "11-table"); 
await clean(); await page.click(".notelens-insert-dock button[title='Insertar bloque de código']"); await sleep(150); await shot(page, "12-code");
await esc(); await clean();
await page.click(".notelens-insert-dock button[title='Nueva nota adhesiva']").catch(() => console.log("no sticky button")); await sleep(150); await shot(page, "13-sticky");
await esc(); await clean();
// utilities
await page.click(".notelens-document-dock button[title='Calculadora científica']"); await sleep(150); await shot(page, "14-calculator");
await page.click(".notelens-calculator-header .notelens-embed-close"); await clean();
await page.click(".notelens-insert-dock button[title='Traducir texto']"); await sleep(150); await shot(page, "15-translator");
await page.click(".notelens-translator-header .notelens-embed-close"); await clean();
await page.click(".notelens-insert-dock button[title^='Grabar audio']"); await sleep(150); await shot(page, "16-recorder");
await page.click(".notelens-insert-dock button[title^='Grabar audio']"); await clean();
await page.click(".notelens-document-dock button[title^='Navegar']"); await sleep(200); await shot(page, "17-navigator");
await page.click(".notelens-navigator .notelens-embed-close"); await clean();
await page.click(".notelens-document-dock button[title='Mostrar regla inteligente']"); await sleep(120); await shot(page, "18-ruler");
await page.click(".notelens-document-dock button[title='Mostrar regla inteligente']");
await page.click(".notelens-document-dock button[title^='Mostrar guías']"); await sleep(120); await shot(page, "19-a4");
await page.click(".notelens-document-dock button[title^='Mostrar guías']");
await page.click(".notelens-document-dock button[title^='Guardar marcador']"); await sleep(120); await clean(); await page.click(".notelens-bookmarks-toggle"); await sleep(120); await shot(page, "20-bookmarks"); await esc();
await page.keyboard.down("Control"); await page.keyboard.press("f"); await page.keyboard.up("Control"); await sleep(150); await shot(page, "21-search"); await esc();
await page.click(".notelens-nav-help"); await sleep(120); await shot(page, "22-shortcuts"); await page.click(".notelens-nav-help");
await page.click(".notelens-nav-map"); await sleep(150); await shot(page, "23-minimap");
await page.evaluate(() => __view.toggleTagSummary()); await sleep(150); await shot(page, "24-tag-summary"); await page.evaluate(() => __view.toggleTagSummary());
// chart objects
await page.evaluate(() => { __view.placeChart({ type: "bar", title: "Horas de estudio", data: "# Teoría; Práctica\nLun; 2; 1\nMar; 3; 2\nMié; 1; 3", showLegend: true }, { x: 100, y: 500 }); });
await sleep(200); await shot(page, "25-chart");
// right-click context menu on canvas
await page.mouse.click(700, 450, { button: "right" }); await sleep(150); await shot(page, "26-context-menu"); await esc();
console.log("dock titles:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".notelens-insert-dock button, .notelens-document-dock button")].map(b => b.title))));
console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
