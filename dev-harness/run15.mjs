import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots15");
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
await page.setRequestInterception(true);
page.on("request", (req) => {
	if (req.url().startsWith("https://api.mymemory.translated.net/")) {
		const q = decodeURIComponent(new URL(req.url()).searchParams.get("q") || "");
		req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ responseStatus: 200, responseData: { translatedText: "EN: " + q } }) });
		return;
	}
	req.continue();
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };

// --- close buttons everywhere
await tool("text"); await page.mouse.click(300, 300); await sleep(100); await page.keyboard.type("Caja con X"); await page.mouse.click(1200, 820); await sleep(150);
await page.click(".notelens-insert-dock button[title='Insertar bloque de código']"); await sleep(100); await page.keyboard.type("x = 1"); await page.mouse.click(1200, 820); await sleep(150);
await page.click(".onenote-quick-tags .onenote-tag-chip:nth-child(1)"); await page.mouse.click(300, 600); await sleep(80);
console.log("close buttons:", await page.evaluate(() => ({
	textbox: document.querySelectorAll(".onenote-textbox .notelens-box-close").length,
	codeHeader: document.querySelectorAll(".notelens-code-header .notelens-code-copy").length,
	badge: document.querySelectorAll(".onenote-badge-close").length
})));
const before = await page.evaluate(() => __view.data.texts.length);
await page.evaluate(() => { document.querySelector(".onenote-textbox .notelens-box-close").click(); });
await sleep(80);
console.log("textbox removed via X:", before, "->", await page.evaluate(() => __view.data.texts.length));

// --- OCR: draw an image with printed text into a loose-image embed, then capture the region
await page.evaluate(() => {
	const c = document.createElement("canvas"); c.width = 900; c.height = 260;
	const ctx = c.getContext("2d");
	ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 900, 260);
	ctx.fillStyle = "#000000"; ctx.font = "bold 64px Arial";
	ctx.fillText("HOLA MUNDO", 60, 110); ctx.fillText("PRUEBA OCR", 60, 210);
	const url = c.toDataURL("image/png");
	const T = window.__TFile;
	const file = new T("Adjuntos/texto.png");
	__view.app.vault.getAbstractFileByPath = (p) => p === file.path ? file : null;
	__view.app.vault.getResourcePath = () => url;
	__view.data.embeds.push({ id: "embed_ocr", kind: "image", src: file.path, x: 500, y: 200, w: 450, h: 130 });
	__view.renderAll();
});
await sleep(400);
console.log("image mounted:", await page.evaluate(() => !!document.querySelector("img.notelens-embed-img")));
await shot(page, "01-board");
const started = Date.now();
const text = await page.evaluate(() => __view.readRegion({ x: 480, y: 180, w: 500, h: 180 }, "es", (m) => { window.__ocrStatus = m; }));
console.log("ocr text:", JSON.stringify(text), "in", Math.round((Date.now() - started) / 1000), "s; last status:", await page.evaluate(() => window.__ocrStatus));

// --- translator OCR button wiring (uses the capture overlay)
await page.evaluate(() => document.querySelector(".notelens-insert-dock button[title='Traducir texto']").click());
await sleep(150);
await page.click(".notelens-translator-capture");
await sleep(100);
console.log("overlay:", await page.evaluate(() => !!document.querySelector(".notelens-capture-overlay")));
await page.mouse.move(480, 180); await page.mouse.down(); await page.mouse.move(980, 360, { steps: 5 }); await page.mouse.up();
await page.waitForFunction(() => (document.querySelector(".notelens-translator-result")?.value || "").length > 0, { timeout: 60000 });
console.log("translator:", await page.evaluate(() => ({ source: document.querySelector(".notelens-translator-text").value, result: document.querySelector(".notelens-translator-result").value, status: document.querySelector(".notelens-translator-status").textContent })));
await shot(page, "02-translator-ocr");

// --- fullscreen toggle does not throw
console.log("fullscreen button:", await page.evaluate(() => !!document.querySelector(".notelens-nav-fullscreen")));
await page.click(".notelens-nav-fullscreen");
await sleep(300);
console.log("fullscreen element:", await page.evaluate(() => document.fullscreenElement?.className || null));

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
