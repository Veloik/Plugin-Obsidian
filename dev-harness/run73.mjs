// Places every quick tag with the interface in English and reports any string
// that is still Spanish: the chip row, the new-tag dialog, the placed badge,
// its hover card, the context menu and the tag summary pane.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots73");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + ".png") }); };

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 950, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.evaluateOnNewDocument(() => { window.__presetSettings = { language: "en", showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));

const SPANISH = /[áéíóúñ¿¡Á-Úü]|\b(de|la|el|los|las|una|uno|con|para|por|del|que|se|tu|su|más|como|desde|hasta|entre|cada|aquí|texto|página|pizarra|fondo|tamaño|añadir|guardar|borrar|nueva|nuevo|abrir|cerrar|escribe|elige|pulsa|arrastra|toca|paso|pasos|pendiente|hecho|duda|tarea|etiqueta|etiquetas)\b/i;

const scan = async (label) => {
	const found = await page.evaluate((pattern) => {
		const re = new RegExp(pattern, "i");
		const seen = new Map();
		const describe = (el) => {
			const cls = (el.className || "").toString().split(" ").filter(Boolean).slice(0, 2).join(".");
			return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
		};
		const visible = (el) => {
			const r = el.getBoundingClientRect();
			return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
		};
		for (const el of document.querySelectorAll("body *")) {
			if (!visible(el)) continue;
			const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(" ").trim();
			for (const [kind, text] of [["text", own], ["title", el.getAttribute("title")], ["placeholder", el.getAttribute("placeholder")], ["aria", el.getAttribute("aria-label")], ["alt", el.getAttribute("alt")]]) {
				if (!text || text.length < 3) continue;
				if (!re.test(text)) continue;
				const key = kind + "|" + text;
				if (!seen.has(key)) seen.set(key, `${describe(el)} [${kind}] ${JSON.stringify(text.slice(0, 110))}`);
			}
		}
		for (const select of document.querySelectorAll("select")) {
			for (const opt of select.options) {
				if (opt.textContent && re.test(opt.textContent)) {
					const key = "option|" + opt.textContent;
					if (!seen.has(key)) seen.set(key, `select>option ${JSON.stringify(opt.textContent.slice(0, 60))}`);
				}
			}
		}
		return [...seen.values()];
	}, SPANISH.source);
	if (found.length) {
		console.log(`\n--- ${label}: ${found.length} en español ---`);
		for (const line of found) console.log("   ", line);
	}
	return found;
};

const all = new Set();
const record = async (label) => { for (const f of await scan(label)) all.add(`[${label}] ${f}`); };
const esc = async () => { await page.keyboard.press("Escape"); await sleep(100); };

await record("tag-chip-row");
await shot(page, "chips-en");

const TAGS = ["tag_star", "tag_question", "tag_idea", "tag_todo", "tag_hover"];
let slot = 0;
for (const id of TAGS) {
	await page.click(`.onenote-quick-tags .onenote-tag-chip[data-tag="${id}"]`);
	await sleep(120);
	await record(`pick:${id}`);
	// Drop it on an empty patch of canvas; each tag gets its own column.
	const x = 260 + slot * 170;
	const y = 560;
	slot++;
	await page.mouse.click(x, y);
	await sleep(350);
	await record(`dialog:${id}`);
	await shot(page, `dialog-${id}-en`);
	if (id === "tag_todo") {
		// A task with two steps, one of them ticked, so the progress strings show.
		const inputs = await page.$$(".notelens-task-checklist-input");
		if (inputs[0]) { await inputs[0].click(); await page.keyboard.type("Read chapter 4"); }
		await page.evaluate(() => document.querySelector(".notelens-task-checklist-add")?.click());
		await sleep(150);
		const more = await page.$$(".notelens-task-checklist-input");
		if (more[1]) { await more[1].click(); await page.keyboard.type("Summarise it"); }
		await record("dialog:tag_todo:steps");
		await shot(page, "dialog-todo-steps-en");
	}
	await page.evaluate(() => [...document.querySelectorAll(".modal button")].find(b => b.classList.contains("mod-cta"))?.click());
	await sleep(300);
}
await record("board-with-tags");
await shot(page, "board-tags-en");

// Hover card of every placed badge.
const badges = await page.$$(".onenote-placed-badge");
console.log("badges placed:", badges.length);
for (const [index, badge] of badges.entries()) {
	await badge.hover();
	await sleep(320);
	await record(`hover:${index}`);
	await shot(page, `hover-${index}-en`);
	await page.mouse.move(700, 200);
	await sleep(250);
}

// A ticked task: progress, "next step" and the done wording.
await page.evaluate(() => {
	const todo = [...document.querySelectorAll(".onenote-placed-badge")].find(el => el.getAttribute("data-tag") === "tag_todo");
	todo?.click();
});
await sleep(300);
await page.evaluate(() => {
	const todo = [...document.querySelectorAll(".onenote-placed-badge")].find(el => el.getAttribute("data-tag") === "tag_todo");
	todo?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
});
await sleep(350);
await record("hover:todo-half-done");
await shot(page, "hover-todo-half-en");
await page.mouse.move(700, 200);
await sleep(250);

// Context menu of a badge.
await page.evaluate(() => {
	const todo = [...document.querySelectorAll(".onenote-placed-badge")].find(el => el.getAttribute("data-tag") === "tag_todo");
	const r = todo.getBoundingClientRect();
	todo.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
});
await sleep(300);
await record("badge-context-menu");
await shot(page, "menu-en");
await esc();
await page.evaluate(() => document.querySelectorAll(".menu").forEach(m => m.remove()));

// Tag summary pane, with and without matches.
await page.evaluate(() => document.querySelector(".onenote-tag-summary")?.click());
await sleep(400);
await record("tag-summary");
await shot(page, "summary-en");
const search = await page.$(".notelens-tag-summary .notelens-panel-search-input");
if (search) {
	await search.click();
	await page.keyboard.type("zzzz");
	await sleep(300);
	await record("tag-summary:no-match");
	await shot(page, "summary-nomatch-en");
	await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
	await page.keyboard.press("Backspace");
	await sleep(250);
}
// Empty summary: no badges at all.
await page.evaluate(() => {
	const view = window.__view;
	view.data.badges.length = 0;
	document.querySelectorAll(".onenote-placed-badge").forEach(el => el.remove());
	view.refreshTagSummary();
});
await sleep(300);
await record("tag-summary:empty");
await shot(page, "summary-empty-en");

console.log(`\n=== TOTAL: ${all.size} cadenas en español en el flujo de etiquetas ===`);
console.log("page errors:", errors.length ? errors.slice(0, 3) : "(none)");
fs.writeFileSync(path.join(shots, "spanish-in-tags.txt"), [...all].join("\n"));
await browser.close();
