// Drawing only what is on screen must look exactly like drawing everything: the same pixels at any pan and zoom.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 1200, height: 800 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* nothing to forget */ } window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
const result = await page.evaluate(() => {
	const v = window.__view;
	const page = v.data.activePageId;
	let seed = 99;
	const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
	v.data.strokes.length = 0; v.data.shapes.length = 0;
	const styles = [undefined, "pencil", "fountain", "brush", "marker"];
	for (let i = 0; i < 700; i++) {
		let x = rnd() * 4000 - 500, y = rnd() * 2600 - 300, dx = rnd() * 8 - 4, dy = rnd() * 8 - 4;
		const pts = [];
		for (let k = 0; k < 20 + Math.floor(rnd() * 80); k++) { dx += rnd() - 0.5; dy += rnd() - 0.5; x += dx; y += dy; pts.push({ x, y, p: 0.3 + rnd() * 0.6 }); }
		const hl = i % 11 === 0;
		v.data.strokes.push({ id: "s" + i, pageId: page, type: hl ? "highlighter" : "pen", color: hl ? "#fde047" : ["#e5e7eb", "#38bdf8", "#f472b6cc"][i % 3], width: hl ? 18 : 2 + (i % 6), points: pts, style: styles[i % styles.length] });
	}
	for (let i = 0; i < 80; i++) v.data.shapes.push({ id: "h" + i, pageId: page, kind: ["rectangle", "ellipse", "line", "arrow", "callout", "triangle"][i % 6], x: rnd() * 4000 - 400, y: rnd() * 2600 - 300, w: 60 + rnd() * 240, h: 50 + rnd() * 180, color: "#94a3b8", width: 2 + (i % 4), rotation: i % 3 ? 0 : 33 });
	const r = v.renderer;
	const strokes = v.pageStrokes, shapes = v.pageShapes;
	const keepStroke = r.strokeVisible.bind(r), keepShape = r.shapeVisible.bind(r);
	const views = [{ x: 0, y: 0, scale: 1 }, { x: -1300, y: -700, scale: 1 }, { x: -2450, y: -1500, scale: 1.7 }, { x: 200, y: 150, scale: 0.55 }, { x: -3300, y: -2000, scale: 2.6 }, { x: 70, y: 40, scale: 0.42 }];
	const pixels = () => r.canvas.getContext("2d").getImageData(0, 0, r.canvas.width, r.canvas.height).data;
	const worst = { ratio: 0 };
	for (const vt of views) {
		r.strokeVisible = keepStroke; r.shapeVisible = keepShape;
		r.renderAll(strokes, shapes, vt);
		const a = pixels().slice();
		r.strokeVisible = () => true; r.shapeVisible = () => true;
		r.renderAll(strokes, shapes, vt);
		const b = pixels();
		let different = 0;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) different++;
		worst.ratio = Math.max(worst.ratio, different / a.length);
	}
	r.strokeVisible = keepStroke; r.shapeVisible = keepShape;
	// Nothing that was left out may have drawn a single pixel of its own.
	let leaks = 0, skipped = 0;
	for (const vt of views) {
		const view = r.visibleRect(vt);
		for (const st of strokes) {
			if (keepStroke(st, view)) continue;
			skipped++;
			r.strokeVisible = () => true; r.renderAll([st], [], vt); r.strokeVisible = keepStroke;
			const d = pixels(); for (let i = 3; i < d.length; i += 4) if (d[i]) { leaks++; break; }
		}
		for (const sh of shapes) {
			if (keepShape(sh, view)) continue;
			skipped++;
			r.shapeVisible = () => true; r.renderAll([], [sh], vt); r.shapeVisible = keepShape;
			const d = pixels(); for (let i = 3; i < d.length; i += 4) if (d[i]) { leaks++; break; }
		}
	}
	return { ratio: worst.ratio, leaks, skipped };
});
ok("nada de lo que se deja sin dibujar habría dejado ni un píxel en pantalla", result.leaks === 0 && result.skipped > 500, `${result.skipped} piezas fuera, ${result.leaks} con huella`);
ok("y el resultado es el mismo que dibujándolo todo, salvo ruido de rasterizado", result.ratio < 0.0015, `${(result.ratio * 100).toFixed(4)} % de valores distintos`);
if (!process.exitCode) console.log("todo correcto");
await browser.close();
