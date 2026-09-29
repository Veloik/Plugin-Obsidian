// How long typing takes in a big real document (read only: nothing is written).
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2];
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
const bytes = Array.from(fs.readFileSync(source));
const opened = await page.evaluate(async (name, data) => {
	const file = new window.__TFile(name); file.stat = { mtime: 1 };
	window.__view.app.vault.readBinary = async () => new Uint8Array(data).buffer;
	window.__view.app.vault.modifyBinary = async () => { /* read only */ };
	const view = window.__plugin.views["notelens-office-view"]({ app: window.__app, view: null });
	view.containerEl.style.cssText = "position:fixed;inset:0;z-index:5000"; view.contentEl.style.cssText = "position:absolute;inset:0";
	document.body.appendChild(view.containerEl);
	const t0 = performance.now(); await view.onOpen?.(); await view.onLoadFile(file);
	return { openMs: Math.round(performance.now() - t0), pages: view.contentEl.querySelectorAll(".notelens-office-paper").length };
}, path.basename(source), bytes);
console.log("abrir:", JSON.stringify(opened));
// Type in a paragraph on the middle page.
await page.evaluate(() => { const papers = document.querySelectorAll(".notelens-office-paper"); const mid = papers[Math.floor(papers.length / 2)]; const p = mid.querySelector("p.notelens-office-para[contenteditable='true']"); p.scrollIntoView({ block: "center" }); p.focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); });
const t0 = Date.now();
await page.keyboard.type("z".repeat(200), { delay: 0 });
const typingMs = Date.now() - t0;
await new Promise(r => setTimeout(r, 900));
const stats = await page.evaluate(() => ({ text: document.activeElement?.textContent?.endsWith("z".repeat(200)), pages: document.querySelectorAll(".notelens-office-paper").length }));
console.log("escribir 200 letras:", typingMs, "ms", JSON.stringify(stats));
await browser.close();
