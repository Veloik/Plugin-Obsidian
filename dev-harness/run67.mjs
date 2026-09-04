// Taking a colour back off a word.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots67"); fs.mkdirSync(shots, { recursive: true });
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
await page.keyboard.type("La entropia mide el desorden");
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
const runs = () => page.evaluate(() => JSON.stringify(__view.data.texts[0].runs));

await pick("entropia");
await page.evaluate(() => {
	const dots = [...document.querySelectorAll(".notelens-format-color:not(.notelens-format-mark-color)")];
	dots[3].dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await sleep(150);
console.log("con color: ", await runs());

// the crossed-out dot at the head of the ink row puts it back to normal
await pick("entropia");
await page.click(".notelens-format-bar .notelens-format-none:not(.notelens-format-mark-color)");
await sleep(150);
console.log("sin color:  ", await runs());

// and the same for a highlight
await pick("desorden");
await page.click(".notelens-format-bar button[title^='Resaltar']");
await sleep(150);
console.log("resaltado:  ", await runs());
await pick("desorden");
await page.click(".notelens-format-bar .notelens-format-none.notelens-format-mark-color");
await sleep(150);
console.log("sin tinte:  ", await runs());

// the button with the icon still strips everything at once
await pick("mide");
await page.click(".notelens-format-bar button[title^='Negrita']");
await sleep(120);
await pick("mide");
await page.click(".notelens-format-bar button[title^='Quitar']");
await sleep(150);
console.log("tras quitar:", await runs());
await page.screenshot({ path: path.join(shots, "01-bar.png"), clip: { x: 240, y: 60, width: 900, height: 330 } });
console.log("html:      ", JSON.stringify(await page.evaluate(() => __view.activeTextEditor.innerHTML)));
console.log("page errors:", errors.length ? errors.slice(0, 3) : "(none)");
await browser.close();
