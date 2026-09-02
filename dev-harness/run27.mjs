// Page-style grid + margin switch, one cursor per tag, handwritten task steps.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots27"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const drag = async (pts, steps = 3) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps }); await page.mouse.up(); };

// ---- 1. settings panel: even grid + the margin switch
await clean();
await page.click(".notelens-settings-btn"); await sleep(250);
console.log("page-style rows:", await page.evaluate(() => {
	const tops = [...document.querySelectorAll(".notelens-settings-row-grid .notelens-settings-choice")].map(b => Math.round(b.getBoundingClientRect().top));
	return { buttons: tops.length, distinctRows: [...new Set(tops)].length };
}));
console.log("margin switch:", await page.evaluate(() => {
	const t = document.querySelector(".notelens-settings-margin-toggle");
	return { tag: t.tagName, role: t.getAttribute("role"), on: t.classList.contains("is-on"), checked: t.getAttribute("aria-checked") };
}));
const panelBox = await page.evaluate(() => { const r = document.querySelector(".notelens-settings-panel").getBoundingClientRect(); return { x: Math.round(r.left) - 8, y: Math.round(r.top) - 8, width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 }; });
await shot(page, "01-settings-grid", panelBox);
await page.click(".notelens-settings-margin-toggle"); await sleep(200);
console.log("after toggling margin:", await page.evaluate(() => {
	const t = document.querySelector(".notelens-settings-margin-toggle");
	return { on: t.classList.contains("is-on"), checked: t.getAttribute("aria-checked"), viewMargin: __view.marginEnabled };
}));
await shot(page, "02-margin-on", panelBox);
await page.keyboard.press("Escape"); await sleep(150);

// ---- 2. a cursor per tag
const cursors = {};
for (const tag of ["tag_star", "tag_question", "tag_idea", "tag_todo", "tag_hover"]) {
	await page.click(`.onenote-quick-tags .onenote-tag-chip[data-tag='${tag}']`); await clean(); await sleep(80);
	cursors[tag] = await page.evaluate(() => {
		const ws = document.querySelector(".onenote-workspace");
		return { attr: ws.getAttribute("data-badge-tag"), cursor: getComputedStyle(ws).cursor };
	});
}
const distinct = new Set(Object.values(cursors).map(c => c.cursor));
console.log("tag attr set correctly:", Object.entries(cursors).every(([tag, c]) => c.attr === tag));
console.log("distinct cursors:", distinct.size, "of", Object.keys(cursors).length);
await page.keyboard.press("Escape"); await sleep(100);
console.log("attr cleared after Esc:", await page.evaluate(() => document.querySelector(".onenote-workspace").getAttribute("data-badge-tag")));

// ---- 3. handwritten task steps
await clean();
await page.click(".onenote-quick-tags .onenote-tag-chip[data-tag='tag_todo']"); await clean();
await page.mouse.click(420, 520); await sleep(300);
console.log("task modal open:", await page.evaluate(() => !!document.querySelector(".notelens-task-checklist")));
// step 1 typed
const inputs = await page.$$(".notelens-task-checklist-input");
await inputs[0].click(); await page.keyboard.type("Leer el enunciado");
// add a second step and switch it to handwriting
await page.click(".notelens-task-checklist-add"); await sleep(150);
const modes = await page.$$(".notelens-task-checklist-mode");
console.log("mode buttons:", modes.length);
await modes[1].click(); await sleep(200);
console.log("row 2 drawn mode:", await page.evaluate(() => [...document.querySelectorAll(".notelens-task-checklist-row")].map(r => r.classList.contains("is-drawn"))));
await shot(page, "03-step-pad-empty");
// write on the pad
const pad = await page.evaluate(() => { const c = document.querySelectorAll(".notelens-task-checklist-pad canvas")[1]; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
await drag([[pad.x + 30, pad.y + 45], [pad.x + 55, pad.y + 18], [pad.x + 80, pad.y + 48], [pad.x + 110, pad.y + 20], [pad.x + 150, pad.y + 46]], 5);
await drag([[pad.x + 180, pad.y + 22], [pad.x + 230, pad.y + 44], [pad.x + 275, pad.y + 20]], 5);
await sleep(200);
console.log("hint hidden after writing:", await page.evaluate(() => document.querySelectorAll(".notelens-task-checklist-pad-hint")[1].classList.contains("hidden-hint")));
await shot(page, "04-step-handwritten");
await page.click(".notelens-hover-note-footer .mod-cta"); await sleep(300); await clean();
const saved = await page.evaluate(() => {
	const b = __view.data.badges.find(x => x.tagId === "tag_todo");
	return b.checklist.map(i => ({ text: i.text, hasSketch: !!i.sketch, len: (i.sketch || "").length, done: i.done }));
});
console.log("saved steps:", JSON.stringify(saved));

// the hover card shows the handwritten step as an image
const badgeBox = await page.evaluate(() => {
	const b = __view.data.badges.find(x => x.tagId === "tag_todo");
	const r = document.querySelector(`[data-id="${b.id}"]`).getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top };
});
await page.evaluate(() => __view.setTool("select"));
await page.mouse.move(900, 820); await sleep(600);
let cardRows = 0;
for (let attempt = 0; attempt < 3 && cardRows === 0; attempt++) {
	await page.mouse.move(900, 820); await sleep(300);
	const fresh = await page.evaluate(() => { const el = document.querySelector(".onenote-placed-badge"); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
	await page.mouse.move(fresh.x, fresh.y); await sleep(700);
	cardRows = await page.evaluate(() => document.querySelectorAll(".onenote-top-tooltip-checklist-item").length);
}
console.log("card rows:", cardRows);
console.log("what is under the badge:", await page.evaluate((x, y) => {
	const el = document.elementFromPoint(x, y);
	return { cls: el ? el.className.toString().slice(0, 60) : "none", modals: document.querySelectorAll(".modal-container").length, badgeExists: !!document.querySelector('.onenote-placed-badge') };
}, badgeBox.x, badgeBox.y));
console.log("card step images:", await page.evaluate(() => document.querySelectorAll(".onenote-top-tooltip-step-sketch").length));
await shot(page, "05-card-with-handwriting", { x: 120, y: Math.max(0, badgeBox.top - 300), width: 760, height: 380 });
// clicking the handwritten row ticks only that step
const row2 = await page.evaluate(() => { const r = document.querySelectorAll(".onenote-top-tooltip-checklist-item")[1].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.click(row2.x, row2.y); await sleep(250); await clean();
console.log("after ticking the drawn step:", await page.evaluate(() => __view.data.badges.find(x => x.tagId === "tag_todo").checklist.map(i => i.done)));
console.log("console issues:\n" + (errors.length ? errors.slice(0, 8).join("\n") : "(none)"));
await browser.close();
