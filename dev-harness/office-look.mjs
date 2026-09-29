// Photographs the two sample files as they open on the board.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
await page.setViewport({ width: 1500, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
const files = { "D/a.docx": fs.readFileSync(path.join(dir, "Ejemplo NoteLens.docx")), "D/a.pptx": fs.readFileSync(path.join(dir, "Ejemplo NoteLens.pptx")) };
await page.evaluate((f) => {
	const v = window.__view; const store = {};
	for (const [k, b] of Object.entries(f)) { store[k] = { data: Uint8Array.from(b), file: new window.__TFile(k) }; store[k].file.stat = { mtime: 1 }; }
	v.app.vault.getFileByPath = (p) => store[p]?.file ?? null;
	v.app.vault.readBinary = async (x) => store[x.path].data.buffer.slice(0);
	v.app.vault.modifyBinary = async () => {};
	v.data.embeds.length = 0;
	v.data.embeds.push({ id: "w", pageId: v.data.activePageId, kind: "office", src: "D/a.docx", x: 60, y: 200, w: 640, h: 640 });
	v.data.embeds.push({ id: "p", pageId: v.data.activePageId, kind: "office", src: "D/a.pptx", x: 740, y: 200, w: 720, h: 460, officeSlide: 1 });
	v.renderAll();
}, Object.fromEntries(Object.entries(files).map(([k, b]) => [k, Array.from(b)])));
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: path.join(here, "shots-office-look.png") });
await browser.close();
