// The stylus shows the nib it would write with, a floating note survives a
// stray touch outside it, and the board menu keeps quiet while a tool paints.
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
	try { localStorage.clear(); } catch { /* a private window simply forgets */ }
	window.__presetPlatform = { isMobile: true, isPhone: false, isTablet: true, isDesktop: false, isIosApp: true };
	window.__presetSettings = { showAssistantPet: false };
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

// --- the nib a hovering stylus shows ---------------------------------------
const hover = await page.evaluate(() => {
	const v = window.__view, el = v.workspaceEl;
	const box = el.getBoundingClientRect();
	const out = {};
	const hoverPen = (x, y) => el.dispatchEvent(new PointerEvent("pointermove", {
		bubbles: true, cancelable: true, clientX: x, clientY: y,
		pointerId: 3, pointerType: "pen", isPrimary: true, pressure: 0, buttons: 0
	}));
	const read = () => {
		const host = document.querySelector(".notelens-ink-pointer");
		if (!host) return null;
		const nib = host.querySelector(".notelens-ink-pointer-nib");
		const badge = host.querySelector(".notelens-ink-pointer-tool");
		const style = getComputedStyle(nib);
		return {
			tool: host.getAttribute("data-tool"),
			color: host.style.getPropertyValue("--ink-color").trim(),
			width: parseFloat(style.width),
			height: parseFloat(style.height),
			rotated: style.transform !== "none",
			icon: !!badge?.querySelector("svg"),
			left: parseFloat(host.style.left)
		};
	};

	v.setTool("pen");
	v.setPenColor("#ef4444");
	hoverPen(box.left + 260, box.top + 420);
	out.pen = read();
	out.penColor = v.derivedColorFor("pen");

	// Moving on carries the nib along instead of leaving a second one behind.
	hoverPen(box.left + 320, box.top + 430);
	out.followed = read()?.left;
	out.onlyOne = document.querySelectorAll(".notelens-ink-pointer").length;

	// The marker is cut flat, so it shows the slanted band it prints.
	v.setTool("highlighter");
	hoverPen(box.left + 300, box.top + 460);
	out.marker = read();

	// Lifted out of range the nib goes with it, and a tool that does not paint
	// never draws one at all.
	el.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerId: 3, pointerType: "pen", relatedTarget: null }));
	out.afterLift = read();
	v.setTool("select");
	hoverPen(box.left + 300, box.top + 460);
	out.withSelect = read();
	return out;
});
ok("el lápiz cercano muestra su punta", !!hover.pen && hover.pen.tool === "pen" && hover.pen.icon && hover.pen.color === hover.penColor, JSON.stringify(hover.pen));
ok("la punta sigue al lápiz sin duplicarse", hover.followed > hover.pen.left && hover.onlyOne === 1, `${hover.pen.left} → ${hover.followed}, ${hover.onlyOne} punta(s)`);
ok("el subrayador muestra su banda inclinada", !!hover.marker && hover.marker.tool === "highlighter" && hover.marker.icon && hover.marker.rotated && hover.marker.height < hover.marker.width, JSON.stringify(hover.marker));
ok("al alejar el lápiz la punta desaparece", hover.afterLift === null);
ok("con una herramienta que no pinta no hay punta", hover.withSelect === null);

// --- a floating note is not dismissed by a stray touch ----------------------
const note = await page.evaluate(async () => {
	const v = window.__view;
	const tag = { id: "tag_hover", label: "Nota flotante", icon: "message-square", color: "#38bdf8" };
	const out = {};
	const modal = () => document.querySelector(".notelens-hover-note-modal");
	const button = (text) => Array.from(document.querySelectorAll(".notelens-hover-note-footer button")).find(b => b.textContent.trim() === text);

	v.data.badges.length = 0;
	v.createBadgeAt(240, 300, tag);
	out.opened = !!modal();

	// Every way a hand lands on the dimmed background, and the background's own
	// click: none of them may take the note away.
	const bg = document.querySelector(".modal-bg");
	out.hasBackground = !!bg;
	for (const type of ["pointerdown", "mousedown", "touchstart", "click"]) {
		bg?.dispatchEvent(type === "touchstart"
			? new Event(type, { bubbles: true, cancelable: true })
			: new MouseEvent(type, { bubbles: true, cancelable: true }));
	}
	out.survivesOutsideTouch = !!modal();

	// Cancelar still closes it, and nothing is written to the board.
	button("Cancelar")?.click();
	out.closedByCancel = !modal();
	out.badgesAfterCancel = v.data.badges.length;

	// Guardar closes it too, and this time the note is kept.
	v.createBadgeAt(240, 300, tag);
	const area = document.querySelector(".notelens-hover-note textarea");
	area.value = "Recordar esto";
	area.dispatchEvent(new Event("input", { bubbles: true }));
	button("Guardar")?.click();
	out.closedBySave = !modal();
	out.savedText = v.data.badges.at(-1)?.tooltip ?? "";
	return out;
});
ok("la nota flotante se abre", note.opened && note.hasBackground);
ok("tocar fuera no cierra la nota", note.survivesOutsideTouch);
ok("Cancelar la cierra sin guardar", note.closedByCancel && note.badgesAfterCancel === 0, `${note.badgesAfterCancel} etiqueta(s)`);
ok("Guardar la cierra y conserva lo escrito", note.closedBySave && note.savedText === "Recordar esto", note.savedText);

// --- the board menu belongs to the hand and the selection tools -------------
const menu = await page.evaluate(() => {
	const v = window.__view, el = v.workspaceEl;
	const box = el.getBoundingClientRect();
	const out = {};
	const down = (type) => el.dispatchEvent(new PointerEvent("pointerdown", {
		bubbles: true, cancelable: true, clientX: box.left + 300, clientY: box.top + 500,
		pointerId: type === "mouse" ? 1 : 21, pointerType: type, isPrimary: true, pressure: 0.5, button: 0, buttons: 1
	}));
	const hold = (type) => {
		document.querySelector(".menu")?.remove();
		down(type);
		el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: box.left + 300, clientY: box.top + 500, pointerId: type === "mouse" ? 1 : 21, pointerType: type }));
		el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 300, clientY: box.top + 500 }));
		return !!document.querySelector(".menu");
	};
	for (const tool of ["pen", "highlighter", "eraser", "shape", "text"]) {
		v.setTool(tool);
		out[tool] = hold("touch");
	}
	// Windows turns a press-and-hold into this same event with "mouse" written
	// on it, so on a touch screen the tool has to decide and not the pointer.
	v.setTool("pen");
	out.penWithMouse = hold("mouse");
	for (const tool of ["hand", "select"]) {
		v.setTool(tool);
		out[tool] = hold("touch");
	}
	document.querySelector(".menu")?.remove();
	v.setTool("pen");
	return out;
});
ok("pintando, mantener pulsado no abre el menú", !menu.pen && !menu.highlighter && !menu.eraser && !menu.shape && !menu.text, JSON.stringify(menu));
ok("en una pantalla táctil el menú tampoco llega como ratón", !menu.penWithMouse);
ok("con la mano y con seleccionar el menú sigue ahí", menu.hand && menu.select);

// --- Shift for a hand with no keyboard -------------------------------------
const straight = await page.evaluate(() => {
	const v = window.__view, el = v.workspaceEl;
	const box = el.getBoundingClientRect();
	const out = {};
	const btn = document.querySelector(".notelens-straight-btn");
	out.shown = !!btn && !btn.classList.contains("hidden");
	out.besideRuler = btn?.previousElementSibling?.classList.contains("onenote-dock-btn") && !!document.querySelector(".notelens-document-dock .notelens-straight-btn");
	// Held with one thumb, the other hand curves across the page anyway.
	const curve = (pointerId) => {
		el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: box.left + 200, clientY: box.top + 600, pointerId, pointerType: "pen", isPrimary: true, pressure: 0.6, button: 0, buttons: 1 }));
		for (const [dx, dy] of [[60, -40], [120, 30], [180, -20], [240, 50]]) {
			window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: box.left + 200 + dx, clientY: box.top + 600 + dy, pointerId, pointerType: "pen", pressure: 0.6, buttons: 1 }));
		}
		const points = v.data.strokes.at(-1)?.points.length ?? 0;
		window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: box.left + 440, clientY: box.top + 650, pointerId, pointerType: "pen" }));
		return points;
	};
	v.setTool("pen");
	v.data.strokes.length = 0;
	out.free = curve(31);

	btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 41, pointerType: "touch", isPrimary: true, button: 0, buttons: 1 }));
	out.held = v.isStraightLineHeld();
	out.litUp = btn.classList.contains("active");
	v.data.strokes.length = 0;
	out.straight = curve(32);

	window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 41, pointerType: "touch" }));
	out.released = v.isStraightLineHeld();
	v.data.strokes.length = 0;
	out.afterRelease = curve(33);
	return out;
});
ok("el botón de líneas rectas está junto a la regla en una tableta", straight.shown && straight.besideRuler, JSON.stringify({ shown: straight.shown, besideRuler: straight.besideRuler }));
ok("sin pulsarlo el trazo conserva su curva", straight.free > 2, `${straight.free} puntos`);
ok("manteniéndolo pulsado el trazo sale recto", straight.held && straight.litUp && straight.straight === 2, `${straight.straight} puntos`);
ok("al soltarlo se vuelve a dibujar libre", !straight.released && straight.afterRelease > 2, `${straight.afterRelease} puntos`);

// --- the note it all belongs to is named on the board ----------------------
const title = await page.evaluate(() => {
	const plaque = document.querySelector(".notelens-board-title");
	return {
		text: plaque?.querySelector(".notelens-board-title-name")?.textContent ?? "",
		expected: window.__view.getBoardTitle(),
		visible: !!plaque?.offsetWidth
	};
});
ok("la pizarra lleva escrito el nombre de la nota", title.visible && !!title.text && title.text === title.expected, title.text);

// --- a machine with no touch screen keeps its right-click ------------------
const desk = await browser.newPage();
desk.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await desk.setViewport({ width: 1366, height: 768, isMobile: false, hasTouch: false });
await desk.evaluateOnNewDocument(() => {
	try { localStorage.clear(); } catch { /* a private window simply forgets */ }
	window.__presetPlatform = { isMobile: false, isPhone: false, isTablet: false, isDesktop: true, isIosApp: false };
	window.__presetSettings = { showAssistantPet: false };
});
await desk.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await desk.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
const desktop = await desk.evaluate(() => {
	const v = window.__view, el = v.workspaceEl;
	const box = el.getBoundingClientRect();
	v.setTool("pen");
	el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: box.left + 300, clientY: box.top + 400, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 2, buttons: 2 }));
	el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: box.left + 300, clientY: box.top + 400, pointerId: 1, pointerType: "mouse" }));
	el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 300, clientY: box.top + 400 }));
	const opened = !!document.querySelector(".menu");
	document.querySelector(".menu")?.remove();
	const btn = document.querySelector(".notelens-straight-btn");
	return { opened, straightHidden: !!btn && btn.classList.contains("hidden") };
});
ok("con ratón y sin pantalla táctil el clic derecho abre el menú", desktop.opened);
ok("el botón de líneas rectas no aparece donde hay teclado", desktop.straightHidden);

if (!process.exitCode) console.log("todo correcto");
await browser.close();
