// Floating notes written or drawn, per-tag hover cards, calculator fraction key.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots25"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const drag = async (pts, steps = 2) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps }); await page.mouse.up(); };

// 1. floating note drawn on the mini whiteboard
await page.click(".onenote-quick-tags .onenote-tag-chip[data-tag='tag_hover']"); await clean();
await page.mouse.click(300, 300); await sleep(200);
console.log("modal tabs:", await page.evaluate(() => [...document.querySelectorAll(".notelens-hover-note-tab")].map(t => t.textContent)));
await page.click(".notelens-hover-note-tab:nth-child(2)"); await sleep(100);
await shot(page, "01-note-modal-sketch-empty");
const cb = await (await page.$(".notelens-hover-note-board canvas")).boundingBox();
const swatch = async (index) => { const all = await page.$$(".notelens-hover-note-swatch"); await all[index].click(); };
await swatch(1);
await drag([[cb.x + 60, cb.y + 200], [cb.x + 160, cb.y + 80], [cb.x + 260, cb.y + 220], [cb.x + 380, cb.y + 90]], 6);
await swatch(3);
await drag([[cb.x + 60, cb.y + 260], [cb.x + 480, cb.y + 260]], 6);
await page.click(".notelens-hover-note-tab:nth-child(1)"); await sleep(50);
await page.keyboard.type("Máximo de la función");
await shot(page, "02-note-modal-text");
await page.click(".notelens-hover-note-footer .mod-cta"); await sleep(200);
console.log("badge saved:", JSON.stringify(await page.evaluate(() => __view.data.badges.map(b => ({ tag: b.tagId, text: b.tooltip, sketch: (b.sketch || "").slice(0, 22), len: (b.sketch || "").length })))));

// 2. other tags placed, then hover each one
const placements = [["tag_star", 300, 420], ["tag_question", 300, 520], ["tag_idea", 300, 620], ["tag_todo", 300, 720]];
for (const [tag, x, y] of placements) {
	await page.click(`.onenote-quick-tags .onenote-tag-chip[data-tag='${tag}']`); await clean();
	await page.mouse.click(x, y); await sleep(120);
	// Every modern tag has its own editor. Accept the defaults before placing
	// the next one so this regression follows the current interaction model.
	if (await page.$(".notelens-hover-note-modal")) {
		await page.click(".notelens-hover-note-footer .mod-cta");
		await sleep(100);
	}
}
await page.evaluate(() => { __view.setTool("text"); __view.createTextBoxAt(430, 705, undefined, "text"); const ed = __view.activeTextEditor; if (ed) { ed.focus(); document.execCommand("insertText", false, "Entregar la práctica 3"); } __view.commitTextEditor(); __view.setTool("select"); });
await page.mouse.click(900, 850); await sleep(80);
const badges = await page.$$(".onenote-placed-badge");
for (const b of badges) {
	const bb = await b.boundingBox();
	const tag = await b.evaluate(el => el.getAttribute("data-tag"));
	await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(650);
	const card = await page.evaluate(() => { const t = document.querySelector(".onenote-top-tooltip"); return t ? { tag: t.getAttribute("data-tag"), head: t.querySelector(".onenote-top-tooltip-head")?.textContent, img: !!t.querySelector("img"), text: t.textContent.slice(0, 90) } : null; });
	console.log("hover", tag, JSON.stringify(card));
	await shot(page, `03-hover-${tag}`, { x: 120, y: Math.max(0, bb.y - 260), width: 640, height: 330 });
}
await page.mouse.move(1100, 850); await sleep(450);

// 3. calculator fraction key
await clean(); await page.click(".notelens-document-dock button[title='Calculadora científica']"); await sleep(120);
console.log("calc state:", await page.evaluate(() => { const p = document.querySelector(".notelens-calculator"); const k = document.querySelector(".notelens-calculator-key.fraction"); if (!p) return "no panel"; const pr = p.getBoundingClientRect(); const kr = k && k.getBoundingClientRect(); const hit = kr && document.elementFromPoint(kr.left + kr.width/2, kr.top + kr.height/2); return { hidden: p.classList.contains("hidden"), panel: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.width), Math.round(pr.height)], key: kr ? [Math.round(kr.left), Math.round(kr.top), Math.round(kr.width), Math.round(kr.height)] : "missing", hit: hit ? hit.className.toString().slice(0,60) : "none" }; }));
await page.focus(".notelens-calculator-input"); await page.keyboard.type("2"); await page.click(".notelens-calculator-key.fraction"); await page.keyboard.type("3"); await page.keyboard.press("Tab");
await page.keyboard.type(" + "); await page.click(".notelens-calculator-key.fraction"); await page.keyboard.type("1"); await page.keyboard.press("Tab"); await page.keyboard.type("6"); await sleep(60);
console.log("fraction expr:", await page.evaluate(() => [document.querySelector(".notelens-calculator-input").value, document.querySelector(".notelens-calculator-output").textContent]));
await shot(page, "04-calculator-fraction", { x: 1010, y: 55, width: 380, height: 620 });
console.log("console issues:\n" + (errors.length ? errors.slice(0, 8).join("\n") : "(none)"));
await browser.close();
