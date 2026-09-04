// The two ways into a board and the two ways around it:
//   1. the item NoteLens adds to a folder's context menu, in both languages
//   2. the hand tool and a stylus barrel button panning the canvas
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots74");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 950, deviceScaleFactor: 1 }
});

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failures.push(what); };

const open = async (language) => {
	const page = await browser.newPage();
	page.on("pageerror", (e) => failures.push(`error de página: ${e.message}`));
	await page.evaluateOnNewDocument((lang) => { window.__presetSettings = { language: lang, showAssistantPet: false }; }, language);
	await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
	await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
	const boot = await page.evaluate(() => window.__bootError || "ok");
	check(boot === "ok", `arranca en ${language} (${boot})`);
	return page;
};

// --- 1. The folder context menu -------------------------------------------
for (const [language, title, prefix] of [["es", "Nueva pizarra NoteLens", "Pizarra_"], ["en", "New NoteLens board", "Board_"]]) {
	const page = await open(language);
	const result = await page.evaluate(() => {
		const handlers = window.__workspaceHandlers["file-menu"] || [];
		const O = window.__obsidian;
		const folder = new O.TFolder("Apuntes/Física");
		const menu = new O.Menu();
		for (const fn of handlers) fn(menu, folder, "file-explorer-context-menu");
		const titles = menu.items.map(i => i.titleEl.textContent);
		// A file must not get the item: only folders offer "new" anything.
		const fileMenu = new O.Menu();
		for (const fn of handlers) fn(fileMenu, new window.__TFile("Apuntes/nota.md"), "file-explorer-context-menu");
		menu.items[0]?.el.click();
		return { titles, onFile: fileMenu.items.length, handlers: handlers.length };
	});
	check(result.handlers === 1, `${language}: el plugin escucha el menú de archivos`);
	check(result.titles.includes(title), `${language}: el menú de una carpeta ofrece «${title}» (${result.titles.join(" | ")})`);
	check(result.onFile === 0, `${language}: una nota suelta no recibe el elemento`);
	await sleep(300);
	const created = await page.evaluate(() => window.__created);
	check(created.some(p => p.startsWith("Apuntes/Física/")), `${language}: la pizarra se crea dentro de la carpeta (${created.join(", ")})`);
	check(created.some(p => p.includes(prefix)), `${language}: el nombre empieza por «${prefix}» (${created.join(", ")})`);
	await page.close();
}

// --- 2. Panning with a stylus ---------------------------------------------
const page = await open("en");
const pan = async (label, { tool, button }) => {
	if (tool) await page.evaluate((t) => window.__view.setTool(t), tool);
	const before = await page.evaluate(() => ({ ...window.__view.data.viewTransform }));
	await page.evaluate((b) => {
		const el = document.querySelector(".onenote-workspace");
		const make = (type, x, y, extra) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: "pen", isPrimary: true, ...extra });
		el.dispatchEvent(make("pointerdown", 700, 500, { button: b, buttons: b === 2 ? 2 : 1, pressure: 0.5 }));
		for (let i = 1; i <= 6; i++) {
			window.dispatchEvent(make("pointermove", 700 + i * 20, 500 + i * 10, { button: -1, buttons: b === 2 ? 2 : 1, pressure: 0.5 }));
			el.dispatchEvent(make("pointermove", 700 + i * 20, 500 + i * 10, { button: -1, buttons: b === 2 ? 2 : 1, pressure: 0.5 }));
		}
		el.dispatchEvent(make("pointerup", 820, 560, { button: b, buttons: 0, pressure: 0 }));
		window.dispatchEvent(make("pointerup", 820, 560, { button: b, buttons: 0, pressure: 0 }));
	}, button);
	await sleep(200);
	const after = await page.evaluate(() => ({ ...window.__view.data.viewTransform }));
	const moved = Math.round(after.x - before.x);
	const strokes = await page.evaluate(() => window.__view.data.strokes.length);
	check(Math.abs(moved - 120) <= 4, `${label}: la pizarra se mueve 120px (${moved})`);
	check(strokes === 0, `${label}: no deja tinta (${strokes} trazos)`);
};

await pan("herramienta mano", { tool: "hand", button: 0 });
await page.evaluate(() => window.__view.setTool("pen"));
await pan("botón lateral del lápiz", { tool: null, button: 2 });
const menuOpen = await page.evaluate(() => {
	const el = document.querySelector(".onenote-workspace");
	el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 820, clientY: 560 }));
	return !!document.querySelector(".menu");
});
check(!menuOpen, "botón lateral: no abre además el menú del lienzo");

// The pen still draws once the barrel is let go.
await page.evaluate(() => {
	const el = document.querySelector(".onenote-workspace");
	const make = (type, x, y, extra) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, pointerType: "pen", isPrimary: true, ...extra });
	el.dispatchEvent(make("pointerdown", 500, 400, { button: 0, buttons: 1, pressure: 0.6 }));
	for (let i = 1; i <= 5; i++) el.dispatchEvent(make("pointermove", 500 + i * 12, 400 + i * 6, { button: -1, buttons: 1, pressure: 0.6 }));
	el.dispatchEvent(make("pointerup", 560, 430, { button: 0, buttons: 0, pressure: 0 }));
});
await sleep(250);
check(await page.evaluate(() => window.__view.data.strokes.length === 1), "el lápiz sigue dibujando con normalidad");
await page.screenshot({ path: path.join(shots, "hand-and-pen.png") });
await page.close();

console.log(failures.length ? `\n=== ${failures.length} fallo(s) ===` : "\n=== todo correcto ===");
await browser.close();
process.exitCode = failures.length ? 1 : 0;
