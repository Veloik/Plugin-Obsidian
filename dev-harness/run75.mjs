// What a finger, a stylus and a resting palm do on a touch screen. This is the
// part no other run covered, and where the mobile build was broken: a finger
// only ever moved the board, so nothing could be drawn or erased on a phone.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots75");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failures.push(what); };

const boot = async ({ clearStorage = true } = {}) => {
	const page = await browser.newPage();
	page.on("pageerror", (e) => failures.push(`error de página: ${e.message}`));
	await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
	await page.evaluateOnNewDocument((clear) => {
		if (clear) { try { localStorage.clear(); } catch {} }
		window.__mobileChrome = { header: 92, navbar: 56, navbarGap: 12 };
		window.__presetPlatform = { isMobile: true, isPhone: true, isDesktop: false, isMacOS: false, isIosApp: false };
		window.__presetSettings = { showAssistantPet: false };
	}, clearStorage);
	await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
	await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
	const failed = await page.evaluate(() => window.__bootError);
	check(!failed, `arranca como teléfono (${failed || "ok"})`);
	return page;
};

/** One contact: down, a few moves, up — with the pointer type given. */
const stroke = (page, { type, id, from, to, steps = 6, hold = false }) => page.evaluate((s) => {
	const el = document.querySelector(".onenote-workspace");
	const make = (kind, x, y, extra) => new PointerEvent(kind, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: s.id, pointerType: s.type, isPrimary: true, pressure: kind === "pointerup" ? 0 : 0.5, ...extra });
	el.dispatchEvent(make("pointerdown", s.from[0], s.from[1], { button: 0, buttons: 1 }));
	for (let i = 1; i <= s.steps; i++) {
		const x = s.from[0] + (s.to[0] - s.from[0]) * i / s.steps;
		const y = s.from[1] + (s.to[1] - s.from[1]) * i / s.steps;
		el.dispatchEvent(make("pointermove", x, y, { button: -1, buttons: 1 }));
		window.dispatchEvent(make("pointermove", x, y, { button: -1, buttons: 1 }));
	}
	if (s.hold) return;
	el.dispatchEvent(make("pointerup", s.to[0], s.to[1], { button: 0, buttons: 0 }));
	window.dispatchEvent(make("pointerup", s.to[0], s.to[1], { button: 0, buttons: 0 }));
}, { type, id, from, to, steps, hold });

const state = (page) => page.evaluate(() => ({
	strokes: window.__view.data.strokes.length,
	points: window.__view.data.strokes.at(-1)?.points.length ?? 0,
	x: Math.round(window.__view.data.viewTransform.x),
	eraser: !!document.querySelector(".notelens-eraser-pointer"),
	eraserActive: !!document.querySelector(".notelens-eraser-pointer.is-active")
}));

// --- A phone with no stylus: the finger has to work -----------------------
let page = await boot();
await stroke(page, { type: "touch", id: 1, from: [180, 500], to: [300, 620] });
await sleep(200);
let s = await state(page);
check(s.strokes === 1, `el dedo dibuja con el lápiz seleccionado (${s.strokes} trazos)`);
// A stroke of one point is a dot: the moves have to reach the ink.
check(s.points > 3, `el trazo del dedo sigue al dedo (${s.points} puntos)`);
check(s.x === 0, `el dedo no mueve la pizarra mientras dibuja (x=${s.x})`);

// The eraser: it has to be visible while the finger is on the glass.
await page.evaluate(() => window.__view.setTool("eraser"));
await stroke(page, { type: "touch", id: 2, from: [200, 520], to: [280, 600], hold: true });
await sleep(150);
s = await state(page);
check(s.eraser && s.eraserActive, `se ve el dibujo de la goma al borrar con el dedo (existe=${s.eraser}, activa=${s.eraserActive})`);
await page.screenshot({ path: path.join(shots, "eraser-touch.png") });
await page.evaluate(() => {
	const el = document.querySelector(".onenote-workspace");
	const up = new PointerEvent("pointerup", { bubbles: true, clientX: 280, clientY: 600, pointerId: 2, pointerType: "touch", button: 0, buttons: 0 });
	el.dispatchEvent(up); window.dispatchEvent(up);
});
await sleep(200);
s = await state(page);
check(s.strokes === 0, `el dedo borra de verdad (${s.strokes} trazos quedan)`);
check(!s.eraser, "la goma desaparece al levantar el dedo");

// Two fingers still move and zoom the board, and leave no dot behind.
await page.evaluate(() => window.__view.setTool("pen"));
const before = await state(page);
await page.evaluate(() => {
	const el = document.querySelector(".onenote-workspace");
	const ev = (kind, id, x, y, buttons) => el.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, pointerType: "touch", isPrimary: id === 11, pressure: 0.5, button: kind === "pointermove" ? -1 : 0, buttons }));
	ev("pointerdown", 11, 150, 500, 1);
	ev("pointermove", 11, 155, 505, 1);
	ev("pointerdown", 12, 250, 500, 1);
	for (let i = 1; i <= 5; i++) { ev("pointermove", 11, 150 + i * 8, 500 + i * 8, 1); ev("pointermove", 12, 250 + i * 8, 500 + i * 8, 1); }
	for (const id of [11, 12]) {
		const up = new PointerEvent("pointerup", { bubbles: true, clientX: 300, clientY: 540, pointerId: id, pointerType: "touch", button: 0, buttons: 0 });
		el.dispatchEvent(up); window.dispatchEvent(up);
	}
});
await sleep(250);
s = await state(page);
check(s.strokes === before.strokes, `dos dedos no dejan un punto suelto (${s.strokes} vs ${before.strokes})`);
check(s.x !== before.x, `dos dedos mueven la pizarra (x=${before.x} → ${s.x})`);
await page.close();

// --- The eraser is a drawing, and it has to survive the app's own styles ---
page = await boot();
const iconSize = async (label) => {
	const box = await page.evaluate(() => {
		const btn = document.querySelector('.onenote-ribbon-dock [data-tool="eraser"]');
		const img = btn?.querySelector("img");
		const svg = btn?.querySelector("svg");
		const r = (img ?? svg)?.getBoundingClientRect();
		return { w: Math.round(r?.width ?? 0), h: Math.round(r?.height ?? 0), kind: img ? "img" : svg ? "svg" : "nada" };
	});
	check(box.w > 8 && box.h > 8, `${label}: el botón de la goma pinta su dibujo (${box.kind} ${box.w}x${box.h})`);
};
await iconSize("normal");
// Obsidian enlarges tap targets on a phone and leaves the button's own size to
// its content; a drawing measured in percentages disappears under that.
await page.addStyleTag({ content: ".onenote-dock-btn { width: auto !important; height: auto !important; min-height: 44px; padding: 10px; }" });
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
await iconSize("con los botones del móvil");
// And if the sprite cannot be painted at all, a line icon takes its place.
await page.evaluate(() => document.querySelector('.onenote-ribbon-dock [data-tool="eraser"] img')?.dispatchEvent(new Event("error")));
await sleep(100);
await iconSize("con el dibujo roto");
await page.screenshot({ path: path.join(shots, "eraser-icon.png") });
await page.close();

// --- A tablet with a stylus: the pen writes, the hand does not ------------
page = await boot();
await stroke(page, { type: "pen", id: 21, from: [160, 480], to: [300, 600] });
await sleep(200);
s = await state(page);
check(s.strokes === 1, `el lápiz dibuja (${s.strokes} trazos)`);

// From now on the finger moves the board instead of writing with it.
const afterPen = await state(page);
await stroke(page, { type: "touch", id: 22, from: [180, 500], to: [280, 560] });
await sleep(200);
s = await state(page);
check(s.strokes === afterPen.strokes, `tras usar el lápiz, el dedo ya no dibuja (${s.strokes} trazos)`);
check(s.x !== afterPen.x, `tras usar el lápiz, el dedo mueve la pizarra (x=${afterPen.x} → ${s.x})`);

// A palm landing mid-stroke must not turn the writing into a gesture.
const beforePalm = await state(page);
await stroke(page, { type: "pen", id: 23, from: [140, 460], to: [200, 520], hold: true });
await page.evaluate(() => {
	const el = document.querySelector(".onenote-workspace");
	el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 320, clientY: 700, pointerId: 24, pointerType: "touch", pressure: 0.5, button: 0, buttons: 1 }));
});
await page.evaluate(() => {
	const el = document.querySelector(".onenote-workspace");
	for (let i = 1; i <= 4; i++) el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 200 + i * 10, clientY: 520 + i * 10, pointerId: 23, pointerType: "pen", pressure: 0.5, button: -1, buttons: 1 }));
	for (const [id, type] of [[23, "pen"], [24, "touch"]]) {
		const up = new PointerEvent("pointerup", { bubbles: true, clientX: 260, clientY: 570, pointerId: id, pointerType: type, button: 0, buttons: 0 });
		el.dispatchEvent(up); window.dispatchEvent(up);
	}
});
await sleep(250);
s = await state(page);
check(s.strokes === beforePalm.strokes + 1, `la palma apoyada no corta el trazo del lápiz (${s.strokes} vs ${beforePalm.strokes + 1})`);
check(s.x === beforePalm.x, `la palma apoyada no mueve la pizarra (x=${s.x})`);
await page.screenshot({ path: path.join(shots, "pen-and-palm.png") });
await page.close();

// --- The stylus is remembered between sessions ---------------------------
page = await boot({ clearStorage: false });
const remembered = await page.evaluate(() => window.__view.data.strokes.length);
await stroke(page, { type: "touch", id: 31, from: [180, 500], to: [280, 560] });
await sleep(200);
s = await state(page);
check(s.strokes === remembered, "al reabrir, el dedo sigue moviendo la pizarra en un equipo con lápiz");
await page.close();

console.log(failures.length ? `\n=== ${failures.length} fallo(s) ===` : "\n=== todo correcto ===");
await browser.close();
process.exitCode = failures.length ? 1 : 0;
