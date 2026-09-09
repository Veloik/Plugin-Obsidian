// Floating panels move under a finger, the note's fold is a fold, and a file
// pasted from the file explorer lands on the board.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };

const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 820, height: 1180, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => {
	window.__presetPlatform = { isMobile: true, isPhone: false, isTablet: true, isDesktop: false, isIosApp: true };
	window.__presetSettings = { showAssistantPet: false };
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

// --- the calculator follows a finger ---------------------------------------
const drag = await page.evaluate(() => {
	const v = window.__view;
	v.toggleCalculator();
	const panel = document.querySelector(".notelens-calculator");
	const handle = panel.querySelector(".notelens-draggable") ?? panel.querySelector(".notelens-calculator-header");
	const before = panel.getBoundingClientRect();
	const r = handle.getBoundingClientRect();
	const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	const send = (target, k, x, y, id = 21) => target.dispatchEvent(new PointerEvent(k, {
		bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id,
		pointerType: "touch", isPrimary: true, button: k === "pointerdown" ? 0 : -1, buttons: 1
	}));
	send(handle, "pointerdown", from.x, from.y);
	// a second finger elsewhere must not steer the panel
	send(window, "pointermove", 40, 40, 99);
	send(window, "pointermove", from.x - 90, from.y - 200);
	send(window, "pointerup", from.x - 90, from.y - 200);
	const after = panel.getBoundingClientRect();
	return {
		movedX: Math.round(after.left - before.left),
		movedY: Math.round(after.top - before.top),
		transform: getComputedStyle(panel).transform,
		touchAction: getComputedStyle(handle).touchAction,
		stillDragging: panel.classList.contains("is-dragging")
	};
});
ok("la calculadora sigue al dedo, sin desviarse", drag.movedX === -90 && drag.movedY === -200, `${drag.movedX},${drag.movedY}`);
ok("y no queda centrada a medio camino", drag.transform === "none", drag.transform);
ok("el asa no cede el gesto al navegador", drag.touchAction === "none", drag.touchAction);
ok("soltar termina el arrastre", drag.stillDragging === false);

// The grip these layouts draw is a pseudo-element; the strip under it is what
// actually takes the press.
const grip = await page.evaluate(() => {
	const panel = document.querySelector(".notelens-calculator");
	const box = panel.getBoundingClientRect();
	const at = { x: box.left + box.width / 2, y: box.top + 6 };
	const target = document.elementFromPoint(at.x, at.y);
	const before = box.left;
	const send = (t, k, x, y) => t.dispatchEvent(new PointerEvent(k, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 5, pointerType: "touch", isPrimary: true, button: k === "pointerdown" ? 0 : -1, buttons: 1 }));
	send(target, "pointerdown", at.x, at.y);
	send(window, "pointermove", at.x + 70, at.y + 40);
	send(window, "pointerup", at.x + 70, at.y + 40);
	return { alcanzable: !!target?.closest(".notelens-panel-grip"), movido: Math.round(panel.getBoundingClientRect().left - before) };
});
ok("la barrita de arriba también arrastra", grip.alcanzable && grip.movido === 70, JSON.stringify(grip));

// The calculator is pale, so its tablet grip must not look like the black
// rectangle from the old dark panel skin.
const calculatorGrip = await page.evaluate(() => {
	const panel = document.querySelector(".notelens-calculator");
	return getComputedStyle(panel, "::before").backgroundColor;
});
ok("la calculadora no abre con una barra negra", !/rgba?\(0,\s*0,\s*0/.test(calculatorGrip), calculatorGrip);

// --- the fold on a sticky note is a fold, not a filled square ---------------
const fold = await page.evaluate(async () => {
	const v = window.__view;
	document.querySelector(".notelens-calculator") && v.toggleCalculator();
	v.addStickyNote();
	await new Promise(r => setTimeout(r, 120));
	v.commitTextEditor?.();
	await new Promise(r => setTimeout(r, 120));
	const note = document.querySelector(".notelens-sticky-note");
	if (!note) return { nota: "no encontrada" };
	const cs = getComputedStyle(note, "::after");
	return { w: cs.width, h: cs.height, borde: cs.borderBottomWidth, fondo: cs.backgroundImage };
});
ok("el pliegue del posit es un triángulo", fold.w === "0px" && fold.h === "0px" && fold.borde !== "0px", JSON.stringify(fold));
ok("y no pinta un cuadro de fondo", fold.fondo === "none", fold.fondo);

// --- a file from the file explorer, pasted ---------------------------------
const pasted = await page.evaluate(async () => {
	const v = window.__view;
	const before = v.data.embeds?.length ?? 0;
	const dt = new DataTransfer();
	dt.items.add(new File([new Uint8Array([80, 75, 3, 4])], "Apuntes de clase.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
	window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
	await new Promise(r => setTimeout(r, 400));
	return { antes: before, despues: v.data.embeds?.length ?? 0, avisos: (window.__notices ?? []).slice(-1) };
});
ok("un archivo pegado del explorador se añade a la pizarra", pasted.despues === pasted.antes + 1, JSON.stringify(pasted));


// --- on a desktop the panel is mostly keys, so a key has to drag it too -----
const desk = await browser.newPage();
desk.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await desk.setViewport({ width: 1400, height: 950 });
await desk.evaluateOnNewDocument(() => {
	window.__presetPlatform = { isMobile: false, isPhone: false, isTablet: false, isDesktop: true, isIosApp: false };
	window.__presetSettings = { showAssistantPet: false };
});
await desk.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await desk.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await desk.evaluate(() => window.__view.toggleCalculator());
const readKey = () => desk.evaluate(() => {
	const p = document.querySelector(".notelens-calculator");
	const seven = [...p.querySelectorAll("button")].find(b => b.textContent.trim() === "7");
	const r = seven.getBoundingClientRect(), box = p.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2, panel: [Math.round(box.left), Math.round(box.top)], valor: document.querySelector(".notelens-calculator-input").value };
});
let key = await readKey();
await desk.mouse.click(key.x, key.y);
let after = await readKey();
ok("pulsar una tecla escribe y no mueve el panel",
	after.valor === "7" && after.panel[0] === key.panel[0] && after.panel[1] === key.panel[1],
	`${JSON.stringify(after.valor)} ${after.panel[0] - key.panel[0]},${after.panel[1] - key.panel[1]}`);

await desk.evaluate(() => { document.querySelector(".notelens-calculator-input").value = ""; });
key = await readKey();
await desk.mouse.move(key.x, key.y);
await desk.mouse.down();
for (let i = 1; i <= 6; i++) await desk.mouse.move(key.x - 20 * i, key.y - 12 * i);
await desk.mouse.up();
after = await readKey();
ok("arrastrar desde una tecla mueve el panel y no escribe",
	after.valor === "" && after.panel[0] - key.panel[0] === -120 && after.panel[1] - key.panel[1] === -72,
	`${JSON.stringify(after.valor)} ${after.panel[0] - key.panel[0]},${after.panel[1] - key.panel[1]}`);

await desk.mouse.click(after.x, after.y);
ok("y la tecla vuelve a escribir después", (await readKey()).valor === "7");

// --- a selected object offers one way to delete it, not two ----------------
const chrome = await desk.evaluate(async () => {
	const v = window.__view;
	v.addStickyNote();
	await new Promise(r => setTimeout(r, 150));
	v.commitTextEditor?.();
	await new Promise(r => setTimeout(r, 250));
	const note = document.querySelector(".notelens-sticky-note");
	const own = [...document.querySelectorAll(".notelens-selected .notelens-box-close, .notelens-selected .notelens-object-close")]
		.filter(b => getComputedStyle(b).display !== "none");
	const bar = document.querySelectorAll(".notelens-selection-bar .notelens-selection-action").length;
	const rotate = document.querySelector(".notelens-selection-rotate")?.getBoundingClientRect();
	const barBox = document.querySelector(".notelens-selection-bar")?.getBoundingClientRect();
	return {
		selected: !!note?.classList.contains("notelens-selected"),
		ownCloses: own.length,
		barActions: bar,
		// the handle used to sit at the top centre, under the action bar
		handleClear: rotate && barBox ? rotate.right <= barBox.left + 1 : false
	};
});
ok("un objeto seleccionado se borra de una sola manera", chrome.selected && chrome.ownCloses === 0 && chrome.barActions === 4, JSON.stringify(chrome));
ok("y su asa de girar no queda bajo la barra", chrome.handleClear);

if (!process.exitCode) console.log("todo correcto");
await browser.close();
