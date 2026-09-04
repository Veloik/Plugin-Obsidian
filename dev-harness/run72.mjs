// The eraser the user drew, and a note card that shows prose instead of code.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots72"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

// 1. a note whose first lines are code: the card must show the words, not the code
await page.evaluate(() => {
	const NOTE = "Programacion/Apuntes.md";
	const vault = __view.app.vault;
	vault.adapter.getBasePath = () => "C:\\Users\\jtiob\\Desktop\\Obsidian_Apuntes_Vault";
	vault.getAbstractFileByPath = (p) => (p === NOTE ? new __TFile(NOTE) : null);
	vault.cachedRead = async () => [
		"---", "tags: [clase]", "---",
		"```js",
		"const suma = (a, b) => a + b;",
		"document.querySelector('#total').textContent = suma(2, 3);",
		"```",
		"<div class=\"callout\">",
		"La suma de dos números pares siempre es par.",
		"</div>",
		"- Repasar [[Induccion|la induccion]] antes del examen.",
		"![[diagrama.png]]"
	].join("\n");
	__view.app.metadataCache = { getFirstLinkpathDest: () => new __TFile(NOTE) };
});
await page.evaluate(() => {
	const data = new DataTransfer();
	data.setData("text/plain", "C:\\Users\\jtiob\\Desktop\\Obsidian_Apuntes_Vault\\Programacion\\Apuntes.md");
	window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
});
await sleep(400);
console.log("vista previa:", JSON.stringify(await page.evaluate(() => document.querySelector(".notelens-link-preview")?.textContent)));
await page.screenshot({ path: path.join(shots, "01-card.png"), clip: { x: 560, y: 260, width: 460, height: 260 } });

// 2. the eraser: ribbon button, panel header and the cursor on the board
await page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
await page.click('.onenote-ribbon-dock [data-tool="eraser"]');
await sleep(120);
console.log("botón:", JSON.stringify(await page.evaluate(() => {
	const img = document.querySelector('.onenote-ribbon-dock [data-tool="eraser"] img');
	return img ? { ancho: img.width, fuente: img.src.slice(0, 22), cargada: img.complete && img.naturalWidth > 0 } : null;
})));
await page.mouse.move(700, 620);
await sleep(200);
console.log("cursor:", JSON.stringify(await page.evaluate(() => {
	const img = document.querySelector(".notelens-eraser-pointer-tool img");
	return img ? { cargada: img.complete && img.naturalWidth > 0, alto: Math.round(img.getBoundingClientRect().height) } : null;
})));
const pointer = await page.evaluate(() => {
	const r = document.querySelector(".notelens-eraser-pointer").getBoundingClientRect();
	return { x: r.left, y: r.top };
});
console.log("puntero en:", JSON.stringify(pointer));
await page.screenshot({ path: path.join(shots, "02-cursor.png"), clip: { x: Math.max(0, pointer.x - 90), y: Math.max(0, pointer.y - 90), width: 260, height: 200 } });
await page.click('.onenote-ribbon-dock [data-tool="eraser"]');
await sleep(200);
await page.screenshot({ path: path.join(shots, "03-panel.png"), clip: { x: 520, y: 80, width: 380, height: 460 } });
console.log("page errors:", errors.length ? errors.slice(0, 3) : "(none)");
await browser.close();
