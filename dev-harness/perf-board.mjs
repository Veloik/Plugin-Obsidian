// How the board behaves with a lot on it: ink, shapes, text boxes, tables. Reports timings; fails if a budget is broken.
// Usage: node dev-harness/perf-board.mjs [strokes] [texts] [tables]
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const N = Number(process.argv[2] ?? 6000), T = Number(process.argv[3] ?? 250), TB = Number(process.argv[4] ?? 40);
const enforce = process.env.PERF_BUDGET !== "off";
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond && enforce) process.exitCode = 1; };

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 1500, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* nothing to forget */ } window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

const build = await page.evaluate((n, t, tb) => {
	const v = window.__view;
	const page = v.data.activePageId;
	let seed = 12345;
	const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
	const W = 24000, H = 14000;
	v.data.strokes.length = 0; v.data.shapes.length = 0; v.data.texts.length = 0; v.data.tables.length = 0; v.data.embeds.length = 0;
	for (let i = 0; i < n; i++) {
		let x = rnd() * W, y = rnd() * H;
		const pts = [];
		const count = 30 + Math.floor(rnd() * 90);
		let dx = rnd() * 6 - 3, dy = rnd() * 6 - 3;
		for (let k = 0; k < count; k++) { dx += rnd() - 0.5; dy += rnd() - 0.5; x += dx; y += dy; pts.push({ x, y, p: 0.4 + rnd() * 0.5 }); }
		const kind = i % 25 === 0 ? "highlighter" : "pen";
		v.data.strokes.push({ id: "s" + i, pageId: page, type: kind, color: kind === "highlighter" ? "#ffe066" : ["#e5e7eb", "#38bdf8", "#f472b6", "#facc15"][i % 4], width: kind === "highlighter" ? 16 : 3, points: pts, style: i % 9 === 0 ? "pencil" : undefined });
	}
	for (let i = 0; i < 300; i++) v.data.shapes.push({ id: "h" + i, pageId: page, kind: ["rect", "ellipse", "line", "arrow"][i % 4], x: rnd() * W, y: rnd() * H, w: 80 + rnd() * 200, h: 60 + rnd() * 160, color: "#94a3b8", width: 2 });
	for (let i = 0; i < t; i++) v.data.texts.push({ id: "t" + i, pageId: page, x: rnd() * W, y: rnd() * H, text: "Apuntes de la clase " + i + "\nSegunda línea con más texto", fontSize: 20, color: "#e5e7eb", w: 260, h: 70 });
	for (let i = 0; i < tb; i++) v.data.tables.push({ id: "b" + i, pageId: page, x: rnd() * W, y: rnd() * H, w: 420, h: 200, rows: 4, cols: 3, header: true, title: "Tabla " + i, cells: Array.from({ length: 4 }, (_, r) => Array.from({ length: 3 }, (_, c) => `c${r}${c}`)) });
	v.data.viewTransform = { x: -6000, y: -3000, scale: 1 };
	const t0 = performance.now();
	v.renderAll();
	return { openMs: Math.round(performance.now() - t0), dom: document.querySelectorAll("*").length };
}, N, T, TB);
console.log(`pizarra: ${N} trazos, 300 formas, ${T} textos, ${TB} tablas`);
console.log(`  reconstruir todo: ${build.openMs} ms · ${build.dom} nodos DOM`);

const canvasStats = await page.evaluate(() => {
	const v = window.__view;
	const time = (fn, reps = 20) => { fn(); const t0 = performance.now(); for (let i = 0; i < reps; i++) fn(); return Math.round((performance.now() - t0) / reps * 10) / 10; };
	const vt = v.data.viewTransform;
	const out = {};
	out.pageStrokesGetter = time(() => v.pageStrokes);
	out.drawZoomed = time(() => v.renderer.renderAll(v.pageStrokes, v.pageShapes, vt), 10);
	const saved = { ...vt };
	vt.scale = 0.06; vt.x = 60; vt.y = 60;
	out.drawFullBoard = time(() => v.renderer.renderAll(v.pageStrokes, v.pageShapes, vt), 5);
	Object.assign(vt, saved);
	return out;
});
console.log("  getter de trazos de la página:", canvasStats.pageStrokesGetter, "ms");
console.log("  dibujar tinta (vista habitual):", canvasStats.drawZoomed, "ms");
console.log("  dibujar tinta (toda la pizarra a la vez):", canvasStats.drawFullBoard, "ms");

// Pan the way a wheel does: many events, each applying the transform and drawing.
const pan = await page.evaluate(async () => {
	const v = window.__view;
	const vt = v.data.viewTransform;
	const frames = [];
	let last = performance.now();
	await new Promise(resolve => {
		let i = 0;
		const step = (now) => {
			vt.x -= 40; vt.y -= 18;
			v.applyStageTransform();
			v.renderer.renderAll(v.pageStrokes, v.pageShapes, vt);
			frames.push(now - last); last = now;
			if (++i < 70) requestAnimationFrame(step); else resolve();
		};
		requestAnimationFrame(step);
	});
	const sorted = [...frames.slice(5)].sort((a, b) => a - b);
	return { avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length * 10) / 10, p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10, worst: Math.round(sorted[sorted.length - 1] * 10) / 10 };
});
console.log(`  desplazar (70 fotogramas): media ${pan.avg} ms · p95 ${pan.p95} ms · peor ${pan.worst} ms`);

// One wheel notch through the real handler.
const wheel = await page.evaluate(() => {
	const v = window.__view;
	const t0 = performance.now();
	for (let i = 0; i < 30; i++) v.workspaceEl.dispatchEvent(new WheelEvent("wheel", { deltaY: 60, bubbles: true, cancelable: true, clientX: 700, clientY: 400 }));
	return Math.round((performance.now() - t0) / 30 * 10) / 10;
});
console.log("  una rueda del ratón (gestor real):", wheel, "ms");

ok("una vista habitual se dibuja en menos de 16 ms", canvasStats.drawZoomed < 16, `${canvasStats.drawZoomed} ms`);
ok("desplazarse mantiene 30 fotogramas por segundo o más", pan.avg < 34 && pan.p95 < 50, `media ${pan.avg} ms, p95 ${pan.p95} ms`);
ok("reconstruir la pizarra entera no pasa de 1,5 s", build.openMs < 1500, `${build.openMs} ms`);
await page.screenshot({ path: path.join(here, "shots-perf-board.png") });
await browser.close();
