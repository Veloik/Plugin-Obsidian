// Boots the board in English, opens every panel and dialog, and reports every
// visible string that is still Spanish, with the selector that shows it.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots57");
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
// English before the plugin loads, the way an English Obsidian would have it
await page.evaluateOnNewDocument(() => { window.__presetSettings = { language: "en" }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"), "| locale:", await page.evaluate(() => window.__view?.plugin?.settings?.language));

const SPANISH = /[áéíóúñ¿¡Á-Úü]|\b(de|la|el|los|las|una|uno|con|para|por|del|que|se|tu|su|sin|más|como|desde|hasta|entre|cada|aquí|texto|página|pizarra|fondo|tamaño|color|añadir|guardar|borrar|nueva|nuevo|abrir|cerrar|escribe|elige|pulsa|arrastra|toca)\b/i;

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
			// own text only, so a container does not report its children's strings
			const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(" ").trim();
			for (const [kind, text] of [["text", own], ["title", el.getAttribute("title")], ["placeholder", el.getAttribute("placeholder")], ["aria", el.getAttribute("aria-label")]]) {
				if (!text || text.length < 3) continue;
				if (!re.test(text)) continue;
				const key = kind + "|" + text;
				if (!seen.has(key)) seen.set(key, `${describe(el)} [${kind}] ${JSON.stringify(text.slice(0, 90))}`);
			}
		}
		// select options are never "visible" as elements
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

const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(80); };
const closeModals = () => page.evaluate(() => document.querySelectorAll(".modal-container").forEach(m => m.remove()));
const esc = async () => { await page.keyboard.press("Escape"); await sleep(80); };

await record("board");
for (const t of ["pen", "highlighter", "eraser", "text", "shape", "select"]) {
	await tool(t); await tool(t); await sleep(150);
	await record(`panel:${t}`);
	if (t === "eraser") await shot(page, "eraser-panel-en");
	await esc();
}
// background / page settings
await page.click(".notelens-settings-fab, button[title*='Background'], button[title*='fondo']").catch(() => {});
await sleep(200);
await record("background");
await shot(page, "background-en");
await esc();

// the docks' tooltips
await record("docks");

// dialogs
for (const [title, name] of [["Insert table", "table"], ["Insert chart", "chart"], ["Insert equation", "equation"], ["Link", "link"]]) {
	const clicked = await page.evaluate((t) => {
		const b = [...document.querySelectorAll(".notelens-insert-dock button")].find(x => (x.title || "").toLowerCase().startsWith(t.toLowerCase()));
		if (b) { b.click(); return true; }
		return false;
	}, title);
	if (!clicked) { console.log("(no button for", title, ")"); continue; }
	await sleep(300);
	await record(`dialog:${name}`);
	if (name === "equation") await shot(page, "equation-en");
	await closeModals();
	await esc();
}

// floating panels
for (const [title, name] of [["Scientific calculator", "calculator"], ["Translate", "translator"], ["Record audio", "recorder"], ["Navigate", "navigator"]]) {
	const clicked = await page.evaluate((t) => {
		const b = [...document.querySelectorAll("button[title]")].find(x => (x.title || "").toLowerCase().startsWith(t.toLowerCase()));
		if (b) { b.click(); return true; }
		return false;
	}, title);
	if (!clicked) { console.log("(no button for", title, ")"); continue; }
	await sleep(350);
	await record(`panel:${name}`);
	await shot(page, `${name}-en`);
	await page.evaluate(() => document.querySelectorAll(".notelens-panel-close, .notelens-calculator-close").forEach(b => b.click()));
	await esc();
}

// the shortcuts sheet, which only the small "?" in the zoom controls opens
await page.evaluate(() => document.querySelector(".notelens-nav-help")?.click());
await sleep(300);
await record("panel:shortcuts");
await shot(page, "shortcuts-en");
await page.evaluate(() => document.querySelector(".notelens-shortcuts .notelens-embed-close")?.click());
await esc();

// the assistant
await page.evaluate(() => document.querySelector(".notelens-pet")?.click());
await sleep(500);
await record("assistant");
await shot(page, "assistant-en");
await esc();

// the settings tab
await page.evaluate(() => {
	const host = document.createElement("div");
	host.id = "settings-host";
	document.body.appendChild(host);
	const tab = window.__settingTab;
	tab.containerEl = host;
	tab.display();
});
await sleep(300);
await record("settings-tab");
await shot(page, "settings-en");

console.log(`\n=== TOTAL: ${all.size} cadenas en español con la interfaz en inglés ===`);
console.log("page errors:", errors.length ? errors.slice(0, 3) : "(none)");
fs.writeFileSync(path.join(shots, "spanish-in-english.txt"), [...all].join("\n"));
await browser.close();
