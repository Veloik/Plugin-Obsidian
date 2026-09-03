import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots21");
fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + ".png") }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
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
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(80); };
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const esc = async () => { await page.keyboard.press("Escape"); await sleep(80); };
const panelOpen = () => page.evaluate(() => !document.querySelector(".notelens-pen-panel").classList.contains("hidden"));

// 1. tool panel: first click selects only, second opens
await tool("pen"); console.log("pen 1st click -> panel open:", await panelOpen());
await tool("pen"); console.log("pen 2nd click -> panel open:", await panelOpen()); await shot(page, "01-pen-panel");
await tool("text"); console.log("switch to text -> panel open:", await panelOpen()); await esc();

// 2. bookmarks: instant, inline rename
await tool("select");
await page.click(".notelens-document-dock button[title^='Guardar marcador']"); await sleep(150);
console.log("bookmark created:", await page.evaluate(() => __view.data.bookmarks.map(b => b.label)));
console.log("rename input focused:", await page.evaluate(() => document.activeElement?.classList.contains("notelens-bookmark-rename")));
await shot(page, "02-bookmark-inline-rename");
await page.keyboard.type("Tema 1: Derivadas"); await page.keyboard.press("Enter"); await sleep(100);
console.log("renamed:", await page.evaluate(() => __view.data.bookmarks.map(b => b.label)));
await page.click(".notelens-document-dock button[title^='Guardar marcador']"); await sleep(100); await esc();
console.log("second bookmark (esc keeps default):", await page.evaluate(() => __view.data.bookmarks.map(b => b.label)));
await page.click(".notelens-bookmarks-toggle"); await sleep(100); await shot(page, "03-bookmarks-list"); await esc();
await page.mouse.click(700, 600); await sleep(50);

// 3. empty code block disappears
await clean(); await page.click(".notelens-insert-dock button[title='Insertar bloque de código']"); await sleep(120);
await esc(); await sleep(100);
console.log("texts after empty code block:", await page.evaluate(() => __view.data.texts.length));
await page.click(".notelens-insert-dock button[title='Insertar bloque de código']"); await sleep(120);
await page.keyboard.type("def f(x):\n    return x * 2"); await esc(); await sleep(100);
console.log("texts after code with content:", await page.evaluate(() => __view.data.texts.length));

// 4. search below tags
await page.keyboard.down("Control"); await page.keyboard.press("f"); await page.keyboard.up("Control"); await sleep(150); await shot(page, "04-search"); await esc();

// 5. math bar layout
await clean(); await page.click(".notelens-insert-dock button[title^='Insertar ecuación']"); await sleep(250);
await page.keyboard.type("x^2/2 + sqrt(x)"); await sleep(200); await shot(page, "05-math-bar"); await esc();

// 6. recorder labels
await clean(); await page.click(".notelens-insert-dock button[title^='Grabar audio']"); await sleep(150); await shot(page, "06-recorder");
await page.click(".notelens-insert-dock button[title^='Grabar audio']");

// 7. shortcuts
await page.click(".notelens-nav-help"); await sleep(120); await shot(page, "07-shortcuts"); await page.click(".notelens-nav-help");

// 8. insertion cascade with sticky + table + code
await clean(); await page.click(".notelens-insert-dock button[title='Nueva nota adhesiva']"); await sleep(100); await page.keyboard.type("Repasar el tema 3"); await esc();
await page.click(".notelens-insert-dock button[title='Insertar tabla']"); await sleep(100);
await page.click(".notelens-insert-dock button[title='Nueva nota adhesiva']"); await sleep(100); await page.keyboard.type("Segunda nota"); await esc();
await sleep(100); await shot(page, "08-cascade");
console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
