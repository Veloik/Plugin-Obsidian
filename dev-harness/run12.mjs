import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots12");
fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
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

const drag = async (pts) => {
	await page.mouse.move(pts[0][0], pts[0][1]);
	await page.mouse.down();
	for (const [x, y] of pts.slice(1)) { await page.mouse.move(x, y, { steps: 3 }); }
	await page.mouse.up();
};
const curve = (x0, y0, w, h, n = 20) => Array.from({ length: n }, (_, i) => [x0 + (w * i) / (n - 1), y0 + Math.sin((i / (n - 1)) * Math.PI * 2) * h]);
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const clearNotices = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));

// --- content for the map: strokes, text, sticky, table, badge
await tool("pen"); await page.mouse.click(700, 500); // close the pen panel by clicking the page
await drag(curve(200, 300, 400, 40));
await drag(curve(250, 400, 300, 30));
await tool("highlighter"); await page.mouse.click(700, 500);
await drag([[180, 320], [620, 322]]);
await tool("text"); await page.mouse.click(700, 500); await sleep(100);
await page.keyboard.type("Apuntes de física: la energía se conserva");
await page.mouse.click(1200, 820); await sleep(150);
await page.click(".notelens-insert-dock button[title='Nueva nota adhesiva']"); await sleep(80);
await page.keyboard.type("Repasar el tema 3"); await page.mouse.click(1200, 820); await sleep(120);
await page.click(".notelens-insert-dock button[title='Insertar tabla']"); await sleep(120);
await page.click(".onenote-quick-tags .onenote-tag-chip:nth-child(1)"); await page.mouse.click(1000, 700); await sleep(80);
await clearNotices();
// The minimap may already be up from an earlier step: aim at the state, not the click.
const mapHidden = () => page.evaluate(() => document.querySelector(".notelens-minimap").classList.contains("hidden"));
// Clicked from inside the page: other panels can sit over the button.
const showMap = async (want) => { if (await mapHidden() === want) await page.evaluate(() => document.querySelector(".notelens-nav-map").click()); await sleep(220); };
await showMap(true);
const mapRect = await page.evaluate(() => { const r = document.querySelector(".notelens-minimap").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
await shot(page, "01-board");
await page.evaluate(() => { const c = document.querySelector(".notelens-minimap canvas"); c.style.width = "624px"; c.style.height = "375px"; document.querySelector(".notelens-minimap").style.width = "640px"; });
await sleep(50);
const bigRect = await page.evaluate(() => { const r = document.querySelector(".notelens-minimap").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
await shot(page, "02-map-zoomed", bigRect);
await page.evaluate(() => { const c = document.querySelector(".notelens-minimap canvas"); c.style.width = ""; c.style.height = ""; document.querySelector(".notelens-minimap").style.width = ""; });
await showMap(false);

// --- translator panel on the board
await tool("select"); await sleep(50);
await page.evaluate(() => { const t = __view.data.texts.find(x => x.text.startsWith("Apuntes")); __view.clearSelection(false); __view.selTexts.add(t.id); __view.renderSelectionBox(); });
await clearNotices();
await page.click(".notelens-insert-dock button[title='Traducir texto']");
await sleep(400);
console.log("translator:", await page.evaluate(() => ({
	open: !document.querySelector(".notelens-translator").classList.contains("hidden"),
	source: document.querySelector(".notelens-translator-text").value,
	result: document.querySelector(".notelens-translator-result").value,
	label: document.querySelector(".notelens-translator .notelens-panel-label").textContent
})));
await shot(page, "03-translator");
await page.evaluate(() => [...document.querySelectorAll(".notelens-translator-actions button")].find(b => b.textContent === "Añadir a la pizarra").click());
await sleep(150);
console.log("after add:", JSON.stringify(await page.evaluate(() => __view.data.texts.map(t => t.text))));
await page.evaluate(() => { const t = __view.data.texts.find(x => x.text.startsWith("Apuntes")); __view.clearSelection(false); __view.selTexts.add(t.id); __view.renderSelectionBox(); });
await page.evaluate(() => __view.translator.open());
await sleep(300);
await page.evaluate(() => [...document.querySelectorAll(".notelens-translator-actions button")].find(b => b.textContent === "Sustituir").click());
await sleep(150);
console.log("after replace:", JSON.stringify(await page.evaluate(() => __view.data.texts.map(t => t.text))));
// drag the translator by its header
const tb = await page.evaluate(() => { const r = document.querySelector(".notelens-translator-header").getBoundingClientRect(); return [r.left + 80, r.top + 10]; });
await drag([[tb[0], tb[1]], [tb[0] + 500, tb[1] + 300]]);
console.log("translator moved:", await page.evaluate(() => { const r = document.querySelector(".notelens-translator").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
await page.click(".notelens-translator-header .notelens-embed-close");

// --- dictation: text box + hint
await clearNotices();
await page.evaluate(() => __view.startDictation());
await sleep(120);
console.log("dictation:", await page.evaluate(() => ({ editor: document.activeElement?.className, hint: document.querySelector(".notelens-dictation-hint")?.textContent })));
await page.keyboard.type("texto dictado por el sistema");
await shot(page, "04-dictation");
await page.mouse.click(1200, 820); await sleep(150);
console.log("dictation result:", JSON.stringify(await page.evaluate(() => [__view.data.texts.at(-1).text, !!document.querySelector(".notelens-dictation-hint")])));

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
