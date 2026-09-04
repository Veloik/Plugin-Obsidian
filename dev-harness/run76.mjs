// Phone and tablet polish: a touch on the board must not reach the app around
// it (Obsidian reads swipes to open its own panels), and writing has to work
// with an on-screen keyboard covering the bottom half of the screen.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots76");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failures.push(what); };

const DEVICES = [
	{ name: "teléfono", width: 390, height: 844, phone: true, chrome: { header: 92, navbar: 56, navbarGap: 12 } },
	{ name: "tablet", width: 820, height: 1180, phone: false, chrome: { header: 76, navbar: 0, navbarGap: 0 } }
];

for (const device of DEVICES) {
	const page = await browser.newPage();
	page.on("pageerror", (e) => failures.push(`error de página: ${e.message}`));
	await page.setViewport({ width: device.width, height: device.height, deviceScaleFactor: device.phone ? 3 : 2, isMobile: true, hasTouch: true });
	await page.evaluateOnNewDocument((d) => {
		try { localStorage.clear(); } catch {}
		window.__mobileChrome = d.chrome;
		window.__presetPlatform = { isMobile: true, isPhone: d.phone, isTablet: !d.phone, isDesktop: false, isMacOS: false, isIosApp: false };
		window.__presetSettings = { showAssistantPet: false };
		// A keyboard the run can raise and lower, the way the real one reports.
		const fake = new EventTarget();
		fake.height = window.innerHeight;
		fake.offsetTop = 0;
		fake.width = window.innerWidth;
		fake.scale = 1;
		window.__keyboard = (px) => {
			fake.height = window.innerHeight - px;
			fake.dispatchEvent(new Event("resize"));
		};
		Object.defineProperty(window, "visualViewport", { value: fake, configurable: true });
	}, device);
	await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
	await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
	const boot = await page.evaluate(() => window.__bootError || "ok");
	check(boot === "ok", `${device.name}: arranca (${boot})`);

	// --- The app around the board must not see the gesture -------------------
	const escaped = await page.evaluate(() => {
		const seen = [];
		const spy = (e) => seen.push(e.type);
		for (const t of ["touchstart", "touchmove", "touchend"]) document.addEventListener(t, spy);
		const el = document.querySelector(".onenote-workspace");
		const touch = (type, x, y) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: [], changedTouches: [] }));
		touch("touchstart", 200, 500);
		touch("touchmove", 260, 500);
		touch("touchend", 320, 500);
		const onBoard = seen.length;
		// The same gesture inside a text box has to reach the app: that is how a
		// caret is placed and how the keyboard is summoned.
		seen.length = 0;
		window.__view.setTool("text");
		const ev = (kind, x, y, extra) => el.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, pointerType: "touch", isPrimary: true, pressure: 0.5, ...extra }));
		ev("pointerdown", 180, 420, { button: 0, buttons: 1 });
		ev("pointerup", 180, 420, { button: 0, buttons: 0 });
		const editor = document.querySelector(".notelens-rich-editor, .notelens-text-editor");
		if (editor) editor.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [], changedTouches: [] }));
		for (const t of ["touchstart", "touchmove", "touchend"]) document.removeEventListener(t, spy);
		return { onBoard, inEditor: seen.length, editor: !!editor, focused: document.activeElement === editor };
	});
	check(escaped.onBoard === 0, `${device.name}: un toque en la pizarra no llega a Obsidian (${escaped.onBoard} eventos escaparon)`);
	check(escaped.editor, `${device.name}: tocar con la herramienta de texto crea el cuadro`);
	check(escaped.focused, `${device.name}: el cuadro nuevo se queda con el foco para que salga el teclado`);
	check(escaped.inEditor === 1, `${device.name}: escribir dentro del cuadro sí llega a la app (${escaped.inEditor})`);

	// Typing lands in the box and is kept.
	await page.keyboard.type("Apuntes de clase");
	await sleep(200);
	const typed = await page.evaluate(() => ({
		text: window.__view.data.texts.at(-1)?.text ?? "",
		boxes: window.__view.data.texts.length
	}));
	check(typed.text === "Apuntes de clase", `${device.name}: lo escrito queda en el cuadro ("${typed.text}")`);

	// --- The keyboard must not hide what is being written --------------------
	const low = await page.evaluate(() => {
		const v = window.__view;
		v.commitTextEditor();
		v.setTool("text");
		const el = document.querySelector(".onenote-workspace");
		const y = Math.round(window.innerHeight * 0.78);
		const ev = (kind, extra) => el.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, clientX: 160, clientY: y, pointerId: 4, pointerType: "touch", isPrimary: true, pressure: 0.5, ...extra }));
		ev("pointerdown", { button: 0, buttons: 1 });
		ev("pointerup", { button: 0, buttons: 0 });
		const editor = document.querySelector(".notelens-rich-editor, .notelens-text-editor");
		return { y, before: Math.round(v.data.viewTransform.y), bottom: Math.round(editor.getBoundingClientRect().bottom) };
	});
	await page.evaluate(() => window.__keyboard(Math.round(window.innerHeight * 0.45)));
	await sleep(450);
	const lifted = await page.evaluate(() => {
		const editor = document.querySelector(".notelens-rich-editor, .notelens-text-editor");
		return {
			after: Math.round(window.__view.data.viewTransform.y),
            lift: parseFloat(window.__view.stageEl.style.translate.split(" ")[1] || "0"),
			bottom: Math.round(editor.getBoundingClientRect().bottom),
			line: Math.round(window.innerHeight * 0.55)
		};
	});
	check(lifted.after === low.before && lifted.lift < 0, `${device.name}: la pizarra sube al abrirse el teclado (y ${low.before} → ${lifted.after})`);
	check(lifted.bottom <= lifted.line, `${device.name}: el cuadro queda por encima del teclado (${lifted.bottom} ≤ ${lifted.line})`);
	await page.screenshot({ path: path.join(shots, `${device.name}-teclado.png`) });

	// And it goes back where it was once the keyboard closes.
	await page.evaluate(() => window.__keyboard(0));
	await sleep(300);
	const restored = await page.evaluate(() => {
		document.querySelector(".notelens-rich-editor, .notelens-text-editor")?.blur();
		return Math.round(window.__view.data.viewTransform.y);
	});
	check(restored === low.before, `${device.name}: la pizarra vuelve a su sitio al cerrarse el teclado (${restored} vs ${low.before})`);
	await page.close();
}

console.log(failures.length ? `\n=== ${failures.length} fallo(s) ===` : "\n=== todo correcto ===");
await browser.close();
process.exitCode = failures.length ? 1 : 0;
