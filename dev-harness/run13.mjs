import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots13");
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

// A fake vault with notes and boards
await page.evaluate(() => {
	const T = window.__TFile;
	const files = [
		Object.assign(new T("Apuntes/Física/Cinemática.md"), { stat: { mtime: 3000, ctime: 1, size: 10 } }),
		Object.assign(new T("Apuntes/Química.md"), { stat: { mtime: 2000, ctime: 1, size: 10 } }),
		Object.assign(new T("Pizarras/Tema 2.notelens"), { stat: { mtime: 4000, ctime: 1, size: 10 } }),
		Object.assign(new T("Pizarra_prueba.notelens"), { stat: { mtime: 1000, ctime: 1, size: 10 } }),
		Object.assign(new T("Adjuntos/foto.png"), { stat: { mtime: 500, ctime: 1, size: 10 } })
	];
	const app = __view.app;
	app.vault.getFiles = () => files;
	app.vault.getAbstractFileByPath = (p) => files.find(f => f.path === p) ?? null;
	app.vault.cachedRead = async (f) => f.path.endsWith("Cinemática.md") ? "# Cinemática\n\nLa velocidad es la derivada de la posición.\nLa aceleración es la derivada de la velocidad.\n\n- MRU\n- MRUA" : "Contenido";
	window.__opened = [];
	app.workspace.getLeaf = (newLeaf) => ({ openFile: async (f) => { window.__opened.push([f.path, !!newLeaf]); } });
});

// navigator panel
await page.click(".notelens-document-dock button[title^='Navegar']");
await sleep(200);
console.log("navigator:", await page.evaluate(() => ({
	open: !document.querySelector(".notelens-navigator").classList.contains("hidden"),
	boards: [...document.querySelectorAll(".notelens-navigator-board")].map(b => b.textContent.trim()),
	notes: [...document.querySelectorAll(".notelens-navigator-note")].map(b => b.textContent.trim())
})));
await page.type(".notelens-navigator-search", "quím");
await sleep(150);
console.log("filtered notes:", await page.evaluate(() => [...document.querySelectorAll(".notelens-navigator-note")].map(b => b.textContent.trim())));
await shot(page, "01-navigator");
// link a note from the navigator
await page.evaluate(() => document.querySelector(".notelens-navigator-note .notelens-navigator-link").click());
await sleep(250);
console.log("embeds after link:", JSON.stringify(await page.evaluate(() => __view.data.embeds.map(e => [e.kind, e.src]))));
// open a board from the navigator (same tab)
await page.evaluate(() => [...document.querySelectorAll(".notelens-navigator-board")].find(b => b.textContent.includes("Tema 2")).querySelector(".notelens-navigator-open").click());
await sleep(100);
console.log("opened:", JSON.stringify(await page.evaluate(() => window.__opened)));
await page.click(".notelens-navigator .notelens-embed-close");

// link card via the insert dock (fuzzy modal picks the first item in the shim)
await page.click(".notelens-insert-dock button[title^='Enlazar']");
await sleep(300);
console.log("embeds after insert:", JSON.stringify(await page.evaluate(() => __view.data.embeds.map(e => [e.kind, e.src]))));
console.log("cards:", await page.evaluate(() => [...document.querySelectorAll(".notelens-link-card")].map(c => [c.querySelector(".notelens-attachment-title")?.textContent, c.querySelector(".notelens-link-preview")?.textContent?.slice(0, 40)])));
await shot(page, "02-link-cards");
// double-click a card opens it
const card = await page.evaluate(() => { const r = document.querySelector(".notelens-link-card").getBoundingClientRect(); return [r.left + 40, r.top + 40]; });
await page.click('.onenote-ribbon-dock [data-tool="select"]');
await page.mouse.click(card[0], card[1], { clickCount: 2 });
await sleep(100);
console.log("opened after dblclick:", JSON.stringify(await page.evaluate(() => window.__opened)));

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
