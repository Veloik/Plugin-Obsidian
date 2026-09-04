// The rich text box: what you type is what the board shows, word by word.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots65"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

await page.evaluate(() => { __view.setBackgroundColor("#fff8ed"); __view.setTextColor("#111827"); __view.setTextSize(24); });
await page.click('.onenote-ribbon-dock [data-tool="text"]');
await sleep(80);
await page.mouse.click(300, 240);
await sleep(200);
await page.keyboard.type("La entropia mide el desorden de un sistema");
await sleep(200);

const pick = (word) => page.evaluate((word) => {
	const ed = __view.activeTextEditor;
	const walk = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
	for (let n = walk.nextNode(); n; n = walk.nextNode()) {
		const at = n.nodeValue.indexOf(word);
		if (at === -1) continue;
		const range = document.createRange();
		range.setStart(n, at);
		range.setEnd(n, at + word.length);
		const sel = getSelection();
		sel.removeAllRanges();
		sel.addRange(range);
		return true;
	}
	return false;
}, word);

const press = async (btn) => { await page.click(`.notelens-format-bar button[title^='${btn}']`); await sleep(120); };
await pick("entropia"); await press("Subrayado");
await pick("desorden"); await press("Negrita");
await pick("sistema"); await press("Resaltar");
// a second fragment with its own tint
await page.keyboard.press("End");
await page.keyboard.type(" y su medida");
await pick("medida");
await page.evaluate(() => {
	const dots = [...document.querySelectorAll(".notelens-format-mark-color")];
	dots[3].dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await sleep(150);
// colour of one word
await pick("entropia");
await page.evaluate(() => {
	const dots = [...document.querySelectorAll(".notelens-format-color:not(.notelens-format-mark-color)")];
	dots[3].dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await sleep(150);
console.log("mientras se edita:", JSON.stringify(await page.evaluate(() => __view.activeTextEditor.innerHTML)));
await page.screenshot({ path: path.join(shots, "01-editing.png"), clip: { x: 240, y: 60, width: 900, height: 330 } });

await page.keyboard.press("Escape");
await sleep(250);
console.log("runs:", JSON.stringify(await page.evaluate(() => __view.data.texts[0].runs)));
console.log("texto:", JSON.stringify(await page.evaluate(() => __view.data.texts[0].text)));
await page.screenshot({ path: path.join(shots, "02-painted.png"), clip: { x: 260, y: 200, width: 760, height: 110 } });

// reopening keeps every fragment as it was
await page.evaluate(() => {
	const tb = __view.data.texts[0];
	__view.beginTextEdit(tb, document.querySelector(`.onenote-textbox[data-id="${tb.id}"]`));
});
await sleep(250);
console.log("al reabrir:", JSON.stringify(await page.evaluate(() => __view.activeTextEditor.innerHTML)));
// lists still work
await page.evaluate(() => { const ed = __view.activeTextEditor; const sel = getSelection(); sel.selectAllChildren(ed); sel.collapseToEnd(); });
await page.click(".notelens-format-bar button[title^='Lista con viñetas']");
await sleep(150);
console.log("con viñeta:", JSON.stringify(await page.evaluate(() => __view.data.texts[0].text)));
await page.keyboard.press("Escape");
await sleep(200);
await page.screenshot({ path: path.join(shots, "03-list.png"), clip: { x: 260, y: 200, width: 760, height: 120 } });
console.log("page errors:", errors.length ? errors.slice(0, 3) : "(none)");
await browser.close();
