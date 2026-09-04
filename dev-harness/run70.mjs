// The drawing pad of a note: as big as the window allows, and shown that way on the card.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots70"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1600, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const drag = async (pts, steps = 4) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps }); await page.mouse.up(); };

await page.click(".onenote-quick-tags .onenote-tag-chip[data-tag='tag_hover']"); await clean();
await page.mouse.click(420, 560); await sleep(250);
console.log("ancho al escribir:", await page.evaluate(() => Math.round(document.querySelector(".notelens-hover-note-modal").getBoundingClientRect().width)));
await page.click(".notelens-hover-note-tab:nth-child(2)"); await sleep(250);
const size = await page.evaluate(() => {
	const modal = document.querySelector(".notelens-hover-note-modal").getBoundingClientRect();
	const c = document.querySelector(".notelens-hover-note-board canvas");
	const r = c.getBoundingClientRect();
	return { modal: Math.round(modal.width), pad: `${Math.round(r.width)}x${Math.round(r.height)}`, bitmap: `${c.width}x${c.height}` };
});
console.log("al dibujar:", JSON.stringify(size));

const cb = await (await page.$(".notelens-hover-note-board canvas")).boundingBox();
const swatch = async (index) => { const all = await page.$$(".notelens-hover-note-swatch"); await all[index].click(); };
await swatch(1);
await drag([[cb.x + 80, cb.y + cb.height - 80], [cb.x + 260, cb.y + 90], [cb.x + 440, cb.y + cb.height - 70], [cb.x + 660, cb.y + 110], [cb.x + 880, cb.y + cb.height - 90]], 8);
await swatch(3);
await drag([[cb.x + 70, cb.y + cb.height - 40], [cb.x + cb.width - 70, cb.y + cb.height - 40]], 8);
await sleep(150);
await page.screenshot({ path: path.join(shots, "01-pad.png") });
await page.click(".notelens-hover-note-footer .mod-cta"); await sleep(300);
console.log("guardado:", JSON.stringify(await page.evaluate(() => {
	const b = __view.data.badges[0];
	return { bytes: (b.sketch || "").length };
})));
// what the note looks like afterwards
await page.evaluate(() => __view.setTool("select"));
const badge = await page.$(".onenote-placed-badge");
const box = await badge.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await sleep(500);
console.log("tarjeta:", JSON.stringify(await page.evaluate(() => {
	const card = document.querySelector(".onenote-top-tooltip");
	const art = document.querySelector(".onenote-top-tooltip-sketch");
	return card && art
		? { card: Math.round(card.getBoundingClientRect().width), dibujo: `${Math.round(art.getBoundingClientRect().width)}x${Math.round(art.getBoundingClientRect().height)}` }
		: null;
})));
await page.screenshot({ path: path.join(shots, "02-card.png") });
console.log("page errors:", errors.length ? errors.slice(0, 3) : "(none)");
await browser.close();
