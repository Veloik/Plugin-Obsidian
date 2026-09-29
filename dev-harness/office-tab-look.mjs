// Photographs a document and a deck as they open in a tab of their own.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
const [w, h] = (process.argv[2] ?? "1500x900").split("x").map(Number);
await page.setViewport({ width: w, height: h });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.evaluate(() => {
	const v = window.__view; const store = {};
	v.app.vault.getFileByPath = (p) => store[p]?.file ?? null;
	v.app.vault.getAbstractFileByPath = (p) => store[p]?.file ?? null;
	v.app.vault.readBinary = async (f) => store[f.path].data.buffer.slice(0);
	v.app.vault.modifyBinary = async () => {};
	v.app.vault.getFolderByPath = () => ({});
	v.app.fileManager = { getAvailablePathForAttachment: async (p) => p };
	v.app.vault.createBinary = async (p, data) => { const f = new window.__TFile(p); f.stat = { mtime: 1 }; store[p] = { data: new Uint8Array(data), file: f }; return f; };
	window.__store = store;
});
for (const [kind, variant, name] of [["docx", "notes", "notes"], ["pptx", "dark", "deck"], ["pptx", "nature", "deck-nature"]]) {
	await page.evaluate((k, v) => window.__view.insertNewOffice(k, v), kind, variant);
	await new Promise(r => setTimeout(r, 400));
	await page.evaluate(async (k) => {
		document.querySelectorAll(".view-container.tab").forEach(e => e.remove());
		const file = Object.values(window.__store).map(s => s.file).filter(f => f.extension === k).pop();
		const view = window.__plugin.views["notelens-office-view"]({ app: window.__app, view: null });
		view.containerEl.classList.add("tab");
		view.containerEl.style.cssText = "position:fixed;inset:0;z-index:5000;background:#1e1e1e";
		view.contentEl.style.cssText = "position:absolute;inset:0";
		document.body.appendChild(view.containerEl);
		await view.onOpen?.(); await view.onLoadFile(file);
	}, kind);
	await new Promise(r => setTimeout(r, 700));
	await page.screenshot({ path: path.join(here, `shots-tab-${name}.png`) });
}
await browser.close();
