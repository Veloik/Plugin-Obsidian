// Drawing fidelity, a draggable pet, and the plugin starting the local server.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots33"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 2 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.setRequestInterception(true);
page.on("request", (req) => {
	const url = req.url();
	if (!url.includes("11434")) return void req.continue();
	if (url.endsWith("/api/tags")) return void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llava:7b" }] }) });
	req.respond({ status: 404, contentType: "application/json", body: "{}" });
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const drag = async (pts, steps = 3) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps }); await page.mouse.up(); };

// ---- 1. what you draw is what you see, on a 2x screen
await clean();
await page.click(".onenote-quick-tags .onenote-tag-chip[data-tag='tag_todo']"); await clean();
await page.mouse.click(430, 470); await sleep(300);
const modes = await page.$$(".notelens-task-checklist-mode");
await modes[0].click(); await sleep(200);
const pad = await page.evaluate(() => { const c = document.querySelector(".notelens-task-checklist-pad canvas"); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, dpr: devicePixelRatio }; });
const inkFrom = 80, inkTo = 250;
await drag([[pad.x + inkFrom, pad.y + 44], [pad.x + 120, pad.y + 18], [pad.x + 160, pad.y + 46], [pad.x + 205, pad.y + 20], [pad.x + inkTo, pad.y + 44]], 5);
await sleep(200);
await page.click(".notelens-hover-note-footer .mod-cta"); await sleep(350); await clean();
await page.evaluate(() => __view.setTool("select"));
let rows = 0;
for (let i = 0; i < 3 && rows === 0; i++) {
	await page.mouse.move(900, 830); await sleep(300);
	const b = await page.evaluate(() => { const el = document.querySelector(".onenote-placed-badge"); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
	await page.mouse.move(b.x, b.y); await sleep(700);
	rows = await page.evaluate(() => document.querySelectorAll(".onenote-top-tooltip-checklist-item").length);
}
const shown = await page.evaluate(() => { const i = document.querySelector(".onenote-top-tooltip-step-sketch"); const r = i.getBoundingClientRect(); return { natural: [i.naturalWidth, i.naturalHeight], shown: [Math.round(r.width), Math.round(r.height)] }; });
console.log("drawn across", inkTo - inkFrom, "css px · saved", shown.natural, "· shown", shown.shown, "· dpr", pad.dpr);
console.log("faithful:", Math.abs(shown.shown[0] - (inkTo - inkFrom)) < 24);
await shot(page, "50-drawing-matches", { x: 200, y: 150, width: 900, height: 500 });
await page.mouse.move(200, 200); await sleep(300);

// ---- 2. the cat can be moved and stays there
const petBefore = await page.evaluate(() => { const r = document.querySelector(".notelens-pet").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
await drag([[petBefore[0] + 39, petBefore[1] + 39], [900, 500], [420, 260]], 6);
await sleep(300);
const petAfter = await page.evaluate(() => {
	const r = document.querySelector(".notelens-pet").getBoundingClientRect();
	return { rect: [Math.round(r.left), Math.round(r.top)], saved: __view.getPetPosition(), chatOpen: !document.querySelector(".notelens-assistant").classList.contains("hidden") };
});
console.log("pet before:", petBefore, "after:", petAfter.rect);
console.log("position saved:", JSON.stringify(petAfter.saved), "· dragging did not open the chat:", !petAfter.chatOpen);
await shot(page, "51-pet-moved", { x: 250, y: 150, width: 700, height: 400 });
// a plain click still opens the chat
await page.mouse.click(petAfter.rect[0] + 39, petAfter.rect[1] + 39); await sleep(700);
console.log("click opens the chat:", await page.evaluate(() => !document.querySelector(".notelens-assistant").classList.contains("hidden")));

// ---- 3. the plugin offers to run the server when it cannot reach one
console.log("server button visible with a model present:", await page.evaluate(() => !document.querySelector(".notelens-assistant-server").classList.contains("hidden")));
console.log("status:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));
console.log("console issues:\n" + (errors.length ? errors.slice(0, 6).join("\n") : "(none)"));
await browser.close();
