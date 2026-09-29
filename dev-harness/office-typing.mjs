// Fast, long typing in the editor: nothing lost, nothing doubled, and it all reaches the file.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { unzipSync } from "fflate";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 1500, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* nothing to forget */ } window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.evaluate(() => {
	const v = window.__view; const store = {}; window.__store = store; window.__written = {};
	v.app.vault.getFileByPath = (p) => store[p]?.file ?? null; v.app.vault.getAbstractFileByPath = (p) => store[p]?.file ?? null;
	v.app.vault.readBinary = async (f) => store[f.path].data.buffer.slice(0);
	v.app.vault.modifyBinary = async (f, buf) => { window.__written[f.path] = Array.from(new Uint8Array(buf)); f.stat.mtime += 1; };
	v.app.vault.getFolderByPath = () => ({}); v.app.fileManager = { getAvailablePathForAttachment: async (p) => p };
	v.app.vault.createBinary = async (p, data) => { const f = new window.__TFile(p); f.stat = { mtime: 1 }; store[p] = { data: new Uint8Array(data), file: f }; return f; };
});
const open = async (kind, variant) => {
	await page.evaluate(() => { window.__view.data.embeds.length = 0; window.__view.renderAll(); });
	await page.evaluate((k, v) => window.__view.insertNewOffice(k, v), kind, variant);
	await page.waitForSelector(kind === "docx" ? ".notelens-office-para" : ".notelens-office-page .notelens-slide", { timeout: 8000 });
	await new Promise(r => setTimeout(r, 400));
};

// Word: 400 letters in a row, then a second paragraph.
await open("docx", "blank");
await page.evaluate(() => { const ps = document.querySelectorAll("p.notelens-office-para"); const ed = ps[ps.length - 1]; ed.focus(); });
await page.keyboard.type("w".repeat(400), { delay: 0 });
await page.keyboard.press("Enter");
await page.keyboard.type("segunda línea escrita deprisa y sin pausas", { delay: 0 });
await new Promise(r => setTimeout(r, 500));
const typed = await page.evaluate(() => [...document.querySelectorAll("p.notelens-office-para")].map(p => p.textContent));
ok("400 letras seguidas se quedan todas, ni una más ni una menos", typed.some(t => t === "w".repeat(400)), typed.map(t => t.length).join(","));
ok("y lo escrito tras Enter va a su propio párrafo", typed.includes("segunda línea escrita deprisa y sin pausas"));
await page.waitForFunction(() => window.__written["Documento sin título.docx"], { timeout: 9000 });
await new Promise(r => setTimeout(r, 2300));
const xml = new TextDecoder().decode(unzipSync(Uint8Array.from(await page.evaluate(() => window.__written["Documento sin título.docx"])))["word/document.xml"]);
ok("las 400 letras llegan enteras al archivo", xml.includes("w".repeat(400)) && !xml.includes("w".repeat(401)));

// Word: one long paragraph that has to move across pages while typing.
await page.evaluate(() => { const ps = document.querySelectorAll("p.notelens-office-para"); ps[ps.length - 1].focus(); });
await page.keyboard.press("Enter");
for (let i = 0; i < 60; i++) { await page.keyboard.type(`Línea ${i + 1} de una lista larga que obliga a pasar de página`, { delay: 0 }); await page.keyboard.press("Enter"); }
await new Promise(r => setTimeout(r, 700));
const long = await page.evaluate(() => ({ pages: document.querySelectorAll(".notelens-office-paper").length, paras: [...document.querySelectorAll("p.notelens-office-para")].filter(p => /^Línea \d+ de una lista/.test(p.textContent)).length, focusedInside: !!document.activeElement.closest?.(".notelens-office-paper") }));
ok("60 líneas escritas deprisa pasan a una segunda hoja sin perder ninguna", long.pages >= 2 && long.paras === 60, JSON.stringify(long));
ok("y el cursor sigue dentro del documento", long.focusedInside);

// A slide: long text in a text box.
await open("pptx", "classic");
await page.evaluate(() => { const p = document.querySelector(".notelens-office-page .notelens-slide-para"); p.focus(); });
await page.keyboard.type("x".repeat(300), { delay: 0 });
await new Promise(r => setTimeout(r, 500));
const slide = await page.evaluate(() => document.querySelector(".notelens-office-page .notelens-slide-para").textContent);
ok("300 letras en una diapositiva se conservan", slide.includes("x".repeat(300)) && !slide.includes("x".repeat(301)), String(slide.length));
if (!process.exitCode) console.log("todo correcto");
await browser.close();
