// Leen: hardware-aware multimodal default, and handwriting that cannot overflow.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots32"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

let catalogue = [{ name: "qwen2.5:7b" }, { name: "llama3.2:3b" }];
await page.setRequestInterception(true);
page.on("request", (req) => {
	const url = req.url();
	if (!url.includes("11434")) return void req.continue();
	if (url.endsWith("/api/tags")) return void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: catalogue }) });
	if (url.endsWith("/api/chat")) return void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ message: { role: "assistant", content: "Hecho." } }) });
	req.respond({ status: 404, contentType: "application/json", body: "{}" });
});

await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const drag = async (pts, steps = 3) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps }); await page.mouse.up(); };

// ---- the pet is called Leen
await clean();
await page.click(".notelens-pet"); await sleep(700);
console.log("name:", await page.evaluate(() => document.querySelector(".notelens-assistant-name").value));
console.log("greeting:", await page.evaluate(() => document.querySelector(".notelens-assistant-empty div").textContent.slice(0, 30)));

// ---- with no vision model it tells you what to download for this machine
console.log("status without vision:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));

// ---- ranking follows the machine's memory
console.log("ranking by RAM:", await page.evaluate(() => {
	const mod = window.__assistantTest;
	const models = ["llava:7b", "qwen2.5:7b", "llama3.2:3b", "llava:34b", "nomic-embed-text"];
	return {
		small: mod.rankModels(models, 8).slice(0, 3).map(r => r.model),
		big: mod.rankModels(models, 32).slice(0, 3).map(r => r.model),
		recommendedSmall: mod.recommendedVisionModel(6).model,
		recommendedMid: mod.recommendedVisionModel(12).model,
		recommendedBig: mod.recommendedVisionModel(32).model
	};
}));

// ---- once a vision model is installed it becomes the automatic pick
catalogue = [{ name: "qwen2.5:7b" }, { name: "llava:7b" }, { name: "llava:34b" }];
await page.click(".notelens-pet"); await sleep(200);
await page.click(".notelens-pet"); await sleep(800);
console.log("options with vision:", await page.evaluate(() => [...document.querySelector(".notelens-assistant-model").options].map(o => o.text)));
console.log("status with vision:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));
await shot(page, "40-leen-model-choice", { x: 940, y: 150, width: 450, height: 740 });
await page.click(".notelens-assistant .notelens-embed-close"); await sleep(200);

// ---- a full-width scribble stays inside the card
await clean();
await page.click(".onenote-quick-tags .onenote-tag-chip[data-tag='tag_todo']"); await clean();
await page.mouse.click(430, 480); await sleep(300);
const modes = await page.$$(".notelens-task-checklist-mode");
await modes[0].click(); await sleep(200);
const pad = await page.evaluate(() => { const c = document.querySelector(".notelens-task-checklist-pad canvas"); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
for (let pass = 0; pass < 3; pass++) {
	const pts = [];
	for (let i = 0; i <= 26; i++) pts.push([pad.x + 6 + (i / 26) * (pad.w - 12), pad.y + 22 + Math.sin(i * 1.2 + pass) * 19]);
	await drag(pts, 2);
}
await sleep(250);
await page.click(".notelens-hover-note-footer .mod-cta"); await sleep(350); await clean();
await page.evaluate(() => __view.setTool("select"));
let rows = 0;
for (let i = 0; i < 3 && rows === 0; i++) {
	await page.mouse.move(900, 830); await sleep(300);
	const b = await page.evaluate(() => { const el = document.querySelector(".onenote-placed-badge"); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
	await page.mouse.move(b.x, b.y); await sleep(700);
	rows = await page.evaluate(() => document.querySelectorAll(".onenote-top-tooltip-checklist-item").length);
}
console.log("overflow check:", await page.evaluate(() => {
	const card = document.querySelector(".onenote-top-tooltip"); const cr = card.getBoundingClientRect();
	const img = card.querySelector(".onenote-top-tooltip-step-sketch"); const ir = img.getBoundingClientRect();
	const row = card.querySelector(".onenote-top-tooltip-checklist-item"); const rr = row.getBoundingClientRect();
	return { natural: [img.naturalWidth, img.naturalHeight], img: [Math.round(ir.width), Math.round(ir.height)],
		beyondRow: Math.round(ir.right - rr.right), beyondCard: Math.round(ir.right - cr.right), inline: img.getAttribute("style") };
}));
const clip = await page.evaluate(() => { const r = document.querySelector(".onenote-top-tooltip").getBoundingClientRect(); return { x: Math.max(0, Math.round(r.left) - 40), y: Math.max(0, Math.round(r.top) - 20), width: Math.round(r.width) + 160, height: Math.round(r.height) + 100 }; });
await shot(page, "41-handwriting-inside-card", clip);
console.log("console issues:\n" + (errors.length ? errors.slice(0, 6).join("\n") : "(none)"));
await browser.close();
