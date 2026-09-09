// A finger draws when asked to, and moves the ruler while the pen keeps drawing.
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

const result = await page.evaluate(() => {
	const v = window.__view, el = document.querySelector(".onenote-workspace");
	const out = {};
	let id = 100;
	const stroke = (kind, x, y, target) => {
		const mine = ++id;
		const ev = (k, cx, cy) => (target ?? el).dispatchEvent(new PointerEvent(k, {
			bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: mine,
			pointerType: kind, isPrimary: true, pressure: 0.5, button: k === "pointerdown" ? 0 : -1, buttons: 1
		}));
		ev("pointerdown", x, y);
		for (let i = 1; i <= 5; i++) ev("pointermove", x + 24 * i, y + 9 * i);
		ev("pointerup", x + 120, y + 45);
		return mine;
	};
	const box = v.workspaceEl.getBoundingClientRect();
	v.setTool("pen");

	// A stylus has touched this vault, so from here a finger moves the board.
	stroke("pen", box.left + 120, box.top + 700);
	out.fingerDrawsAfterPen = v.fingerDrawsOn();
	v.data.strokes.length = 0;
	stroke("touch", box.left + 140, box.top + 760);
	out.strokesFromFingerWhilePanning = v.data.strokes.length;

	// The visible button, beside the hand and pen, is the way a tablet reader
	// asks for this. Test the control itself rather than calling its method.
	const fingerButton = document.querySelector(".onenote-ribbon-dock .notelens-finger-tool");
	const penButton = document.querySelector(".onenote-ribbon-dock [data-tool='pen']");
	const fingerBox = fingerButton?.getBoundingClientRect();
	const penBox = penButton?.getBoundingClientRect();
	fingerButton?.click();
	out.fingerDrawsAfterToggle = v.fingerDrawsOn();
	out.fingerButton = {
		visible: !!fingerBox && fingerBox.width > 0 && fingerBox.height > 0,
		besidePen: !!fingerBox && !!penBox && fingerBox.right <= penBox.left + 6 && penBox.left - fingerBox.right <= 8
	};
	v.data.strokes.length = 0;
	stroke("touch", box.left + 140, box.top + 820);
	out.strokesFromFingerWhenAsked = v.data.strokes.length;

	// And the marker too, which is what the reader asked for by name.
	v.setTool("highlighter");
	v.data.strokes.length = 0;
	stroke("touch", box.left + 140, box.top + 880);
	out.markerFromFinger = v.data.strokes.at(-1)?.type ?? "ninguno";

	// Back to a finger that moves the board, using the same visible control.
	fingerButton?.click();
	out.fingerDrawsAgain = v.fingerDrawsOn();
	return out;
});
ok("tras usar el lápiz, el dedo mueve", result.fingerDrawsAfterPen === false && result.strokesFromFingerWhilePanning === 0, JSON.stringify(result.strokesFromFingerWhilePanning));
ok("el botón visible hace que el dedo dibuje", result.fingerDrawsAfterToggle === true && result.strokesFromFingerWhenAsked === 1 && result.fingerButton.visible && result.fingerButton.besidePen, JSON.stringify(result.fingerButton));
ok("y el marcador también va con el dedo", result.markerFromFinger === "highlighter", result.markerFromFinger);
ok("volver a pulsarlo devuelve el dedo a mover", result.fingerDrawsAgain === false);

// --- the ruler, moved by a finger while the pen is still drawing ------------
const ruler = await page.evaluate(() => {
	const v = window.__view, el = document.querySelector(".onenote-workspace");
	v.setTool("pen");
	v.data.strokes.length = 0; v.currentStroke = null;
	v.rulerState = { visible: true, x: 150, y: 500, length: 420, angle: 0, mode: "ruler" };
	v.renderRuler();
	const box = v.workspaceEl.getBoundingClientRect();
	const pen = (k, x, y) => el.dispatchEvent(new PointerEvent(k, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: "pen", isPrimary: true, pressure: 0.5, button: k === "pointerdown" ? 0 : -1, buttons: 1 }));
	const finger = (k, x, y, target, id = 8) => (target ?? v.rulerEl).dispatchEvent(new PointerEvent(k, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, pointerType: "touch", isPrimary: false, pressure: 0.4, button: k === "pointerdown" ? 0 : -1, buttons: 1 }));

	// The pen starts a stroke against the ruler's edge and stays down.
	const edge = v.rulerEl.offsetHeight / 2;
	pen("pointerdown", box.left + 200, box.top + 500 - edge);
	pen("pointermove", box.left + 260, box.top + 500 - edge);
	const penPoints = v.currentStroke?.points.length ?? 0;

	// A finger takes hold of the ruler and slides it, with the pen still down.
	const before = v.rulerState.y;
	finger("pointerdown", box.left + 300, box.top + 480);
	window.dispatchEvent(new PointerEvent("pointermove", { clientX: box.left + 300, clientY: box.top + 560, pointerId: 8, pointerType: "touch" }));
	const moved = v.rulerState.y - before;

	// The pen carries on, and its stroke is not disturbed by the finger.
	pen("pointermove", box.left + 320, box.top + 500 - edge);
	const penPointsAfter = v.currentStroke?.points.length ?? 0;
	window.dispatchEvent(new PointerEvent("pointerup", { clientX: box.left + 300, clientY: box.top + 560, pointerId: 8, pointerType: "touch" }));
	pen("pointerup", box.left + 380, box.top + 500 - edge);

	// A pen move must not drag the ruler once the finger has let go.
	const settled = v.rulerState.y;
	window.dispatchEvent(new PointerEvent("pointermove", { clientX: box.left + 300, clientY: box.top + 900, pointerId: 7, pointerType: "pen" }));

	// Two fingers over the ruler turn it around their common centre. Moving both
	// ends keeps that centre fixed, so this checks rotation rather than a slide.
	const cx = box.left + v.rulerState.x + v.rulerState.length / 2;
	const cy = box.top + v.rulerState.y;
	const beforeTurn = { x: v.rulerState.x, y: v.rulerState.y, angle: v.rulerState.angle };
	finger("pointerdown", cx - 100, cy, v.rulerEl, 31);
	finger("pointerdown", cx + 100, cy, v.rulerEl, 32);
	window.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: cy - 100, pointerId: 31, pointerType: "touch" }));
	window.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: cy + 100, pointerId: 32, pointerType: "touch" }));
	const turn = { angle: v.rulerState.angle - beforeTurn.angle, x: v.rulerState.x - beforeTurn.x, y: v.rulerState.y - beforeTurn.y };
	window.dispatchEvent(new PointerEvent("pointerup", { clientX: cx, clientY: cy - 100, pointerId: 31, pointerType: "touch" }));
	window.dispatchEvent(new PointerEvent("pointerup", { clientX: cx, clientY: cy + 100, pointerId: 32, pointerType: "touch" }));
	return { moved, penPoints, penPointsAfter, driftAfterRelease: v.rulerState.y - settled, turn };
});
ok("el dedo mueve la regla mientras el lápiz dibuja", ruler.moved === 80, `movida ${ruler.moved}px`);
ok("el trazo del lápiz sigue creciendo", ruler.penPointsAfter > ruler.penPoints, `${ruler.penPoints} → ${ruler.penPointsAfter}`);
ok("soltado el dedo, el lápiz ya no arrastra la regla", ruler.driftAfterRelease === 0, `${ruler.driftAfterRelease}px`);
ok("dos dedos sobre la regla la giran sin desplazarla", Math.abs(ruler.turn.angle - 90) < 1 && Math.abs(ruler.turn.x) < 1 && Math.abs(ruler.turn.y) < 1, JSON.stringify(ruler.turn));

if (!process.exitCode) console.log("todo correcto");
await browser.close();
