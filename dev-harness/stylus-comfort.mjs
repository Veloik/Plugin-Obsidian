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
	// The dock scrolls sideways on a small screen; a hold must not be read as
	// the start of that scroll, or the browser takes the touch away.
	out.keepsItsTouch = getComputedStyle(btn).touchAction === "none";
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

	// One tap switches it on and it stays on: a tablet has no third hand to
	// keep a button down with while the other two draw.
	btn.click();
	out.on = v.isStraightLineOn();
	out.litUp = btn.classList.contains("active");
	out.announced = btn.getAttribute("aria-pressed");
	v.data.strokes.length = 0;
	out.straight = curve(32);
	// Still on for the next stroke, with nothing held down in between.
	v.data.strokes.length = 0;
	out.straightAgain = curve(33);

	btn.click();
	out.off = v.isStraightLineOn();
	v.data.strokes.length = 0;
	out.afterRelease = curve(34);
	return out;
});
ok("el botón de líneas rectas está junto a la regla en una tableta", straight.shown && straight.besideRuler, JSON.stringify({ shown: straight.shown, besideRuler: straight.besideRuler }));
ok("el botón no cede su toque al desplazamiento de la barra", straight.keepsItsTouch === true);
ok("sin pulsarlo el trazo conserva su curva", straight.free > 2, `${straight.free} puntos`);
ok("activado, el trazo sale recto y sigue activado", straight.on && straight.litUp && straight.announced === "true" && straight.straight === 2 && straight.straightAgain === 2, JSON.stringify({ on: straight.on, uno: straight.straight, dos: straight.straightAgain }));
ok("al volver a pulsarlo se dibuja libre otra vez", !straight.off && straight.afterRelease > 2, `${straight.afterRelease} puntos`);

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

// --- a tag stays live under a tool that paints -----------------------------
const tagGeo = await page.evaluate(() => {
	const v = window.__view;
	v.setTool("pen");
	if (!v.fingerDrawsOn()) v.toggleFingerDraws();
	v.data.badges.length = 0;
	v.data.bookmarks.length = 0;
	v.createBadgeAt(300, 500, { id: "tag_key", label: "Idea clave", icon: "lightbulb", color: "#facc15" });
	Array.from(document.querySelectorAll(".notelens-hover-note-footer button")).find(b => b.textContent.trim() === "Guardar")?.click();
	v.addViewportBookmark();
	const el = document.querySelector(".onenote-placed-badge");
	const r = el.getBoundingClientRect();
	const mark = document.querySelector(".notelens-bookmark-marker");
	const mr = mark?.getBoundingClientRect();
	const style = getComputedStyle(el);
	// The layer that holds them has to sit above the one the ink is painted on.
	const inkZ = Number(getComputedStyle(v.renderer.canvas).zIndex);
	const topZ = Number(getComputedStyle(document.querySelector(".onenote-top-stage")).zIndex);
	return {
		live: style.pointerEvents !== "none",
		above: Number(style.zIndex) > 50,
		overInk: topZ > inkZ,
		inLayer: el.closest(".onenote-top-stage") !== null && mark?.closest(".onenote-top-stage") !== null,
		badge: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
		marker: mr ? { x: mr.left + mr.width / 2, y: mr.top + mr.height / 2, label: mark.textContent } : null,
		markerLive: mark ? getComputedStyle(mark).pointerEvents !== "none" : null
	};
});
ok("la etiqueta sigue viva con el lápiz en la mano", tagGeo.live && tagGeo.above, JSON.stringify({ live: tagGeo.live, above: tagGeo.above }));
ok("etiquetas y marcadores viven por encima de la tinta", tagGeo.overInk && tagGeo.inLayer, JSON.stringify({ overInk: tagGeo.overInk, inLayer: tagGeo.inLayer }));

// Rebuilding the DOM layer replaces the tag's element, and a touch sent in the
// same breath can be hit-tested against what was there before it.
const reset = async () => {
	await page.evaluate(() => {
		document.querySelector(".notelens-tag-summary")?.remove();
		window.__view.data.strokes.length = 0;
		window.__view.renderAll();
	});
	await new Promise(r => setTimeout(r, 80));
};
const board = () => page.evaluate(() => ({
	summary: !!document.querySelector(".notelens-tag-summary"),
	strokes: window.__view.data.strokes.length,
	scale: window.__view.data.viewTransform.scale
}));

// Drawing across a tag is drawing, not pressing it.
await reset();
await page.touchscreen.touchStart(tagGeo.badge.x - 40, tagGeo.badge.y);
for (let i = 1; i <= 8; i++) await page.touchscreen.touchMove(tagGeo.badge.x - 40 + i * 14, tagGeo.badge.y + (i % 2 ? 4 : -4));
await page.touchscreen.touchEnd();
await new Promise(r => setTimeout(r, 300));
const across = await board();
ok("un trazo que cruza la etiqueta sigue siendo un trazo", !across.summary && across.strokes === 1, JSON.stringify(across));

// A tap on it opens the summary and leaves no dot of ink behind.
await reset();
const spot = await page.evaluate(() => {
	const r = document.querySelector(".onenote-placed-badge").getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.touchscreen.tap(spot.x, spot.y);
await new Promise(r => setTimeout(r, 300));
const tap = await board();
ok("tocarla con el lápiz la abre y no deja tinta", tap.summary && tap.strokes === 0, JSON.stringify(tap));

// And holding on it does not open its menu while a tool paints.
await reset();
const tagMenu = await page.evaluate((p) => {
	document.querySelector(".onenote-placed-badge").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
	const opened = !!document.querySelector(".menu");
	document.querySelector(".menu")?.remove();
	window.__view.setTool("select");
	document.querySelector(".onenote-placed-badge").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
	const withSelect = !!document.querySelector(".menu");
	document.querySelector(".menu")?.remove();
	window.__view.setTool("pen");
	return { opened, withSelect };
}, tagGeo.badge);
ok("mantener sobre la etiqueta no abre su menú mientras se pinta", !tagMenu.opened && tagMenu.withSelect, JSON.stringify(tagMenu));

// --- the sections are drawn on the board, and stay out of the ink ----------
ok("el marcador se dibuja en la pizarra con su nombre", !!tagGeo.marker && tagGeo.marker.label.includes("Secci"), tagGeo.marker?.label ?? "ninguno");
ok("el marcador también responde al lápiz", tagGeo.markerLive === true);

// A press that lands on a marker presses it; it does not paint there.
await reset();
const markSpot = await page.evaluate(() => {
	const r = document.querySelector(".notelens-bookmark-marker").getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.touchscreen.touchStart(markSpot.x, markSpot.y);
for (let i = 1; i <= 8; i++) await page.touchscreen.touchMove(markSpot.x + i * 16, markSpot.y + i * 3);
await page.touchscreen.touchEnd();
await new Promise(r => setTimeout(r, 300));
const overMark = await board();
ok("no se puede pintar empezando sobre un marcador", overMark.strokes === 0, JSON.stringify(overMark));

// The same on a tag: the press presses it, and no stroke is born there.
await reset();
const tagSpot = await page.evaluate(() => {
	const r = document.querySelector(".onenote-placed-badge").getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.touchscreen.touchStart(tagSpot.x, tagSpot.y);
for (let i = 1; i <= 8; i++) await page.touchscreen.touchMove(tagSpot.x + i * 16, tagSpot.y + i * 3);
await page.touchscreen.touchEnd();
await new Promise(r => setTimeout(r, 300));
const overTag = await board();
ok("no se puede pintar empezando sobre una etiqueta", overTag.strokes === 0, JSON.stringify(overTag));

// --- what you operate rides above the ink ---------------------------------
const embeds = await page.evaluate(() => {
	const v = window.__view;
	v.data.embeds.length = 0;
	const base = { pageId: v.data.activePageId, x: 700, y: 300, w: 320, h: 180 };
	const kinds = [
		["youtube", "https://youtu.be/abc"], ["video", "clase.mp4"], ["audio", "apuntes.mp3"],
		["note", "Tema 4.md"], ["board", "Pizarra 2.notelens"], ["file", "guion.docx"],
		["chart", "grafico"], ["pdf", "libro.pdf"], ["image", "foto.png"]
	];
	kinds.forEach(([kind, src], i) => v.data.embeds.push({ ...base, id: "emb" + i, kind, src, y: 300 + i * 40 }));
	v.setTool("pen");
	v.renderAll();
	const where = {};
	for (const [kind] of kinds) {
		const embed = v.data.embeds.find(e => e.kind === kind);
		const el = v.pageElement(embed.id);
		where[kind] = el ? (el.closest(".onenote-top-stage") ? "sobre" : "bajo") : "ninguno";
	}
	return where;
});
ok("vídeos, audio, gráficos y enlaces quedan por encima de la tinta",
	["youtube", "video", "audio", "note", "board", "file", "chart"].every(k => embeds[k] === "sobre"), JSON.stringify(embeds));

// Note cards and code blocks carry their own buttons: they ride up there too.
const boxes = await page.evaluate(() => {
	const v = window.__view;
	v.commitTextEditor();
	v.data.texts.length = 0;
	v.data.texts.push(
		{ id: "t_sticky", pageId: v.data.activePageId, x: 300, y: 900, text: "Repasar el tema 4", fontSize: 16, color: "#302b19", stickyColor: "#fde68a", w: 220, h: 150 },
		{ id: "t_code", pageId: v.data.activePageId, x: 620, y: 900, text: "print('hola')", fontSize: 14, color: "#e2e8f0", variant: "code", language: "python", w: 440, h: 120 },
		{ id: "t_prose", pageId: v.data.activePageId, x: 300, y: 1120, text: "Apuntes de clase", fontSize: 18, color: "#f8fafc", w: 220, h: 48 }
	);
	v.renderAll();
	const where = (id) => {
		const el = v.pageElement(id);
		return el ? (el.closest(".onenote-top-stage") ? "sobre" : "bajo") : "ninguno";
	};
	v.data.tables.length = 0;
	v.data.tables.push({ id: "tb1", pageId: v.data.activePageId, x: 900, y: 900, rows: 2, cols: 2, cells: [["a", "b"], ["c", "d"]], w: 260, h: 140 });
	v.renderAll();
	const table = v.pageElement("tb1");
	return {
		sticky: where("t_sticky"), code: where("t_code"), prose: where("t_prose"),
		table: table ? (table.closest(".onenote-top-stage") ? "sobre" : "bajo") : "ninguna"
	};
});
ok("los pósits, las tablas y los bloques de código también",
	boxes.sticky === "sobre" && boxes.code === "sobre" && boxes.table === "sobre", JSON.stringify(boxes));
ok("el texto normal se queda bajo la tinta, para poder anotarlo", boxes.prose === "bajo", boxes.prose);
ok("los PDF y las imágenes siguen debajo, para poder anotarlos",
	embeds.pdf === "bajo" && embeds.image === "bajo", JSON.stringify({ pdf: embeds.pdf, image: embeds.image }));

const overVideo = await page.evaluate(async () => {
	const v = window.__view;
	v.data.strokes.length = 0;
	const el = v.pageElement("emb0");
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.touchscreen.touchStart(overVideo.x, overVideo.y);
for (let i = 1; i <= 6; i++) await page.touchscreen.touchMove(overVideo.x + i * 12, overVideo.y + i * 4);
await page.touchscreen.touchEnd();
await new Promise(r => setTimeout(r, 250));
ok("no se puede pintar empezando sobre un vídeo", (await page.evaluate(() => window.__view.data.strokes.length)) === 0);

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
