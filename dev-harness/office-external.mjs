// A document open in a tab picks up a change made elsewhere, unless there are unsaved edits here.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };
const tick = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 1400, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* nothing to forget */ } window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.evaluate(async () => {
	const v = window.__view; const store = {}; window.__store = store; window.__written = {};
	v.app.vault.getFileByPath = (p) => store[p]?.file ?? null; v.app.vault.getAbstractFileByPath = (p) => store[p]?.file ?? null;
	v.app.vault.readBinary = async (f) => store[f.path].data.buffer.slice(0);
	v.app.vault.modifyBinary = async (f, buf) => { store[f.path].data = new Uint8Array(buf); f.stat.mtime += 1; (window.__vaultHandlers.modify || []).forEach(fn => fn(f)); };
	v.app.vault.getFolderByPath = () => ({}); v.app.fileManager = { getAvailablePathForAttachment: async (p) => p };
	v.app.vault.createBinary = async (p, data) => { const f = new window.__TFile(p); f.stat = { mtime: 1 }; store[p] = { data: new Uint8Array(data), file: f }; return f; };
	await v.insertNewOffice("docx", "notes");
	const view = window.__plugin.views["notelens-office-view"]({ app: window.__app, view: null });
	view.containerEl.style.cssText = "position:fixed;inset:0;z-index:5000"; view.contentEl.style.cssText = "position:absolute;inset:0";
	document.body.appendChild(view.containerEl);
	await view.onOpen?.(); await view.onLoadFile(store["Apuntes de clase.docx"].file);
	window.__tab = view; window.__name = "Apuntes de clase.docx";
});
await tick(500);
const titleOf = () => page.evaluate(() => window.__tab.contentEl.querySelector("p.notelens-office-para")?.textContent);
ok("se abre con su título de plantilla", (await titleOf()) === "Apuntes de clase");
// Another device rewrites the file.
await page.evaluate(() => {
	const f = window.__store[window.__name];
	// Another device saved a different document under the same name.
	return window.__view.insertNewOffice("docx", "report").then(() => { const other = window.__store["Informe o trabajo.docx"]; f.data = other.data; f.file.stat.mtime += 5; (window.__vaultHandlers.modify || []).forEach(fn => fn(f.file)); });
});
await tick(1200);
ok("un cambio hecho fuera se carga solo cuando no hay nada sin guardar", (await titleOf()) === "Informe o trabajo", await titleOf());
// Now with unsaved typing here, an outside change must not wipe it.
await page.evaluate(() => { const ed = window.__tab.contentEl.querySelectorAll("p.notelens-office-para")[1]; ed.focus(); ed.dispatchEvent(new InputEvent("beforeinput", { bubbles: true })); ed.appendChild(document.createTextNode("A medias")); ed.dispatchEvent(new Event("input", { bubbles: true })); });
await page.evaluate(() => { const f = window.__store[window.__name]; f.file.stat.mtime += 9; (window.__vaultHandlers.modify || []).forEach(fn => fn(f.file)); });
await tick(1000);
const kept = await page.evaluate(() => [...window.__tab.contentEl.querySelectorAll("p.notelens-office-para")].some(p => p.textContent.includes("A medias")));
ok("con texto sin guardar no se pisa lo que escribiste", kept);
if (!process.exitCode) console.log("todo correcto");
await browser.close();
