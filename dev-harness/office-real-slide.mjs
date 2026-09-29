// Photographs chosen slides of a real .pptx: node office-real-slide.mjs <file> <slide numbers…>
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const [source, ...numbers] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
await page.setViewport({ width: 1500, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
const bytes = Array.from(fs.readFileSync(source));
await page.evaluate(async (name, data) => {
	const v = window.__view; const file = new window.__TFile(name); file.stat = { mtime: 1 };
	v.app.vault.readBinary = async () => new Uint8Array(data).buffer;
	v.app.vault.modifyBinary = async () => { throw new Error("read only"); };
	const view = window.__plugin.views["notelens-office-view"]({ app: window.__app, view: null });
	view.containerEl.style.cssText = "position:fixed;inset:0;z-index:5000;background:#1e1e1e"; view.contentEl.style.cssText = "position:absolute;inset:0";
	document.body.appendChild(view.containerEl); await view.onOpen?.(); await view.onLoadFile(file);
	await new Promise(r => setTimeout(r, 800));
}, path.basename(source), bytes);
for (const n of numbers) {
	await page.evaluate((i) => { const t = document.querySelectorAll(".notelens-thumb")[i - 1]; t.click(); }, Number(n));
	await new Promise(r => setTimeout(r, 500));
	await page.screenshot({ path: path.join(here, `shots-slide-${n}.png`) });
}
await browser.close();
