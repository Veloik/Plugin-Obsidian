// The promotional video, recorded from the real plugin in the harness: a
// scripted study session (handwriting to text and to LaTeX, shapes, tables,
// revision cards, handwriting search, ink replay) between a title card and an
// end card, captioned, at 1920x1080. Chrome's screencast gives the frames with
// their timestamps; ffmpeg turns them into a constant 30 fps MP4 with a soft
// synthesised pad underneath.
//
//   node dev-harness/promo-video.mjs [out.mp4]      (default: NoteLens-promo.mp4)
//
// Needs ffmpeg on the PATH. Frames are kept in dev-harness/promo-frames/.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const out = path.resolve(process.argv[2] ?? path.join(root, "NoteLens-promo.mp4"));
const framesDir = path.join(here, "promo-frames");
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// The page is laid out at 1280x720 and drawn at 1.5x, so the video is 1920x1080
// with everything half as big again as on a desktop: legible on a phone.
const W = 1280, H = 720, DPR = 1.5;

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: W, height: H, deviceScaleFactor: DPR }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
	window.__markdownFiles = ["Física/Dinámica.md", "Astronomía/Sistema solar.md"];
	window.__fileHeadings = { "Astronomía/Sistema solar.md": ["El sol y sus planetas"] };
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready);
await sleep(1200);
await page.evaluate(() => { window.__view.strokeWidth = 3.2; });

// ---------------------------------------------------------------------------
// Stage furniture: a visible pen tip, captions, full-screen cards.
// ---------------------------------------------------------------------------
await page.evaluate(() => {
	const style = document.createElement("style");
	// The board is cleared between scenes; its welcome for blank pages would flash each time.
	style.textContent = `
	.notelens-empty-hint { display: none !important; }
	#promo-pen { position: fixed; z-index: 99999; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
		background: rgba(250, 250, 250, 0.9); box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.55), 0 4px 14px rgba(0,0,0,.4); pointer-events: none;
		transition: transform 90ms ease, opacity 200ms ease; opacity: 0; }
	#promo-pen.down { transform: scale(0.7); }
	#promo-caption { position: fixed; left: 50%; bottom: 78px; z-index: 99998; transform: translate(-50%, 20px); opacity: 0;
		transition: opacity 420ms ease, transform 420ms ease; pointer-events: none; text-align: center;
		padding: 12px 26px; border-radius: 18px; background: rgba(12, 10, 24, 0.86); border: 1px solid rgba(167, 139, 250, 0.45);
		box-shadow: 0 18px 50px rgba(0,0,0,.45); font-family: "Segoe UI", Inter, system-ui, sans-serif; color: #f5f3ff; }
	#promo-caption.show { opacity: 1; transform: translate(-50%, 0); }
	#promo-caption b { display: block; font-size: 28px; font-weight: 750; letter-spacing: -0.01em; }
	#promo-caption span { display: block; margin-top: 4px; font-size: 16px; color: #c4b5fd; font-weight: 500; }
	#promo-card { position: fixed; inset: 0; z-index: 100000; display: grid; place-items: center; opacity: 0; pointer-events: none;
		transition: opacity 600ms ease; font-family: "Segoe UI", Inter, system-ui, sans-serif; color: #fff; text-align: center;
		background: radial-gradient(1200px 700px at 30% 20%, #4c1d95 0%, transparent 60%), radial-gradient(900px 600px at 80% 90%, #0e7490 0%, transparent 55%), #0b0a14; }
	#promo-card.show { opacity: 1; }
	#promo-card .logo { font-size: 96px; font-weight: 800; letter-spacing: -0.04em; line-height: 1;
		background: linear-gradient(90deg, #e9d5ff, #a78bfa 45%, #67e8f9); -webkit-background-clip: text; background-clip: text; color: transparent; }
	#promo-card .tag { margin-top: 18px; font-size: 32px; font-weight: 600; color: #ede9fe; }
	#promo-card .sub { margin-top: 14px; font-size: 20px; color: #a5b4fc; }
	#promo-card .pills { display: flex; gap: 12px; justify-content: center; margin-top: 32px; }
	#promo-card .pills span { padding: 9px 18px; border-radius: 999px; border: 1px solid rgba(196,181,253,.45); background: rgba(255,255,255,.06); font-size: 18px; color: #ede9fe; }
	`;
	document.head.appendChild(style);
	const pen = document.createElement("div"); pen.id = "promo-pen"; document.body.appendChild(pen);
	const cap = document.createElement("div"); cap.id = "promo-caption"; document.body.appendChild(cap);
	const card = document.createElement("div"); card.id = "promo-card"; document.body.appendChild(card);
	document.addEventListener("pointermove", e => { pen.style.left = e.clientX + "px"; pen.style.top = e.clientY + "px"; }, true);
	document.addEventListener("pointerdown", () => pen.classList.add("down"), true);
	document.addEventListener("pointerup", () => pen.classList.remove("down"), true);
	window.__promo = {
		pen: (on) => { pen.style.opacity = on ? "1" : "0"; },
		caption: (title, sub) => { if (!title) { cap.classList.remove("show"); return; } cap.innerHTML = `<b>${title}</b><span>${sub ?? ""}</span>`; cap.classList.add("show"); },
		card: (html) => { if (!html) { card.classList.remove("show"); return; } card.innerHTML = html; card.classList.add("show"); }
	};
});
const caption = (title, sub) => page.evaluate((t, s) => window.__promo.caption(t, s), title, sub);
const card = (html) => page.evaluate((h) => window.__promo.card(h), html);
const pen = (on) => page.evaluate((o) => window.__promo.pen(o), on);
const v = (fn, ...args) => page.evaluate(fn, ...args);

/** A smooth pen path through control points (Catmull-Rom). */
function penPath(controls, perSegment = 7) {
	if (controls.length < 3) {
		const [[x1, y1], [x2, y2]] = controls;
		return Array.from({ length: 12 }, (_, i) => [x1 + (x2 - x1) * i / 11, y1 + (y2 - y1) * i / 11]);
	}
	const pts = [controls[0], ...controls, controls[controls.length - 1]];
	const outPts = [];
	for (let i = 1; i < pts.length - 2; i++) {
		const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
		for (let s = 0; s < perSegment; s++) {
			const t = s / perSegment, t2 = t * t, t3 = t2 * t;
			outPts.push([0, 1].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
		}
	}
	outPts.push(controls[controls.length - 1]);
	return outPts;
}
/** Writes strokes with the mouse at a hand's pace, scaled and moved into place. */
async function write(strokes, [ox, oy], k = 1, hold = 0, pace = 9) {
	for (const stroke of strokes) {
		const pts = stroke.length > 12 ? stroke : penPath(stroke);
		await page.mouse.move(ox + pts[0][0] * k, oy + pts[0][1] * k);
		await page.mouse.down();
		for (const [x, y] of pts.slice(1)) { await page.mouse.move(ox + x * k, oy + y * k); await sleep(pace); }
		if (hold) await sleep(hold);
		await page.mouse.up();
		await sleep(60);
	}
}
async function glide(x, y, steps = 18) { await page.mouse.move(x, y, { steps }); }
async function clearBoard() {
	await v(() => {
		const b = window.__view;
		b.clearSelection?.();
		for (const key of ["strokes", "shapes", "texts", "tables", "badges", "embeds"]) b.data[key].length = 0;
		b.data.viewTransform = { x: 0, y: 0, scale: 1 };
		b.renderAll();
	});
}
const circle = (cx, cy, rx, ry, n = 56) => Array.from({ length: n }, (_, i) => {
	const t = -Math.PI / 2 + i / (n - 1) * Math.PI * 2.04;
	return [cx + Math.cos(t) * rx + Math.sin(i * 1.7) * 1.6, cy + Math.sin(t) * ry + Math.cos(i * 1.3) * 1.6];
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
const cdp = await page.createCDPSession();
const frames = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
	const file = path.join(framesDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
	fs.writeFileSync(file, Buffer.from(data, "base64"));
	frames.push({ file, t: metadata.timestamp });
	try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch { /* closing */ }
});
// Chrome only sends a frame when something changes; a still picture needs a
// heartbeat, so a 1px element ticks while the recording runs.
await v(() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;z-index:100001;opacity:.01;background:#000"; document.body.appendChild(d); let k = 0; window.__tick = setInterval(() => { d.style.opacity = (k++ % 2) ? ".01" : ".02"; }, 33); });
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });
const started = Date.now();

// 1 · Title card
await card(`<div><div class="logo">NoteLens</div><div class="tag">Tu pizarra infinita para estudiar en Obsidian</div><div class="sub">Escribe a mano. NoteLens entiende lo que escribes.</div></div>`);
await sleep(2800);
await v(() => window.__view.setTool("pen"));
await card(null);
await sleep(700);

// 2 · Ink to text
await pen(true);
await caption("Tinta a texto", "Tu letra se convierte en texto editable");
const SOL = [
	[[46, 74], [34, 70], [24, 76], [28, 86], [42, 90], [46, 98], [36, 104], [22, 100]],
	circle(74, 88, 15, 15, 20),
	[[104, 50], [104, 102]],
	[[150, 62], [160, 52], [160, 102]],
	[[178, 62], [188, 52], [202, 55], [201, 68], [180, 100], [206, 100]]
];
await write(SOL, [430, 200], 1.7, 0, 8);
await sleep(400);
await v(() => window.__view.setTool("select"));
await glide(390, 260); await page.mouse.down(); await glide(820, 420, 20); await page.mouse.up();
await sleep(700);
const typeBtn = await page.$(".notelens-selection-action[title='Convertir la tinta en texto']");
if (typeBtn) { const b = await typeBtn.boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2); await sleep(300); await typeBtn.click(); }
await sleep(1800);
await caption(null);
await sleep(300);

// 3 · Handwriting to LaTeX
await clearBoard();
await v(() => window.__view.setTool("pen"));
await caption("Tu letra, en LaTeX", "Fracciones, potencias y raíces, leídas sin conexión");
const FORMULA = [
	[[60, 140], [78, 162], [96, 186]], [[96, 140], [78, 162], [60, 186]],
	[[104, 112], [113, 103], [125, 106], [124, 118], [106, 134], [130, 134]],
	[[146, 163], [182, 162]], [[164, 146], [164, 180]],
	[[203, 150], [214, 140], [214, 186]],
	[[238, 156], [272, 156]], [[238, 172], [272, 172]],
	[[302, 104], [320, 96], [336, 106], [322, 119], [338, 131], [322, 145], [300, 140]],
	[[290, 160], [352, 160]],
	[[318, 172], [304, 199], [336, 199]], [[328, 176], [328, 216]]
];
await write(FORMULA, [330, 80], 1.75, 0, 6);
await sleep(300);
await v(() => window.__view.setTool("select"));
await glide(390, 230); await page.mouse.down(); await glide(1000, 490, 20); await page.mouse.up();
await sleep(700);
const sigma = await page.$(".notelens-selection-action[title='Convertir la tinta en fórmula (LaTeX)']");
if (sigma) { const b = await sigma.boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2); await sleep(300); await sigma.click(); }
await sleep(2300);
const insert = await page.evaluateHandle(() => [...document.querySelectorAll(".notelens-ink-footer button, .modal button")].find(b => b.textContent.trim() === "Insertar"));
const ib = await insert.asElement()?.boundingBox();
if (ib) { await glide(ib.x + ib.width / 2, ib.y + ib.height / 2); await sleep(300); await insert.asElement().click(); }
await sleep(2200);
await caption(null);
await sleep(400);

// 4 · Draw and hold for a shape
await clearBoard();
await v(() => window.__view.setTool("pen"));
await caption("Mantén el lápiz: forma perfecta", "Círculos, rectángulos, triángulos, flechas…");
await write([circle(330, 320, 115, 85)], [0, 0], 1, 850, 10);
await sleep(300);
const rect = [[560, 240], [790, 243], [787, 405], [557, 402], [562, 242]];
const rectPts = rect.flatMap((p, i) => i ? Array.from({ length: 16 }, (_, j) => [rect[i - 1][0] + (p[0] - rect[i - 1][0]) * (j + 1) / 16 + Math.sin(j) * 1.5, rect[i - 1][1] + (p[1] - rect[i - 1][1]) * (j + 1) / 16 + Math.cos(j) * 1.5]) : [p]);
await write([rectPts], [0, 0], 1, 850, 10);
await sleep(300);
const tri = [[970, 235], [1070, 405], [870, 405], [971, 237]];
const triPts = tri.flatMap((p, i) => i ? Array.from({ length: 18 }, (_, j) => [tri[i - 1][0] + (p[0] - tri[i - 1][0]) * (j + 1) / 18, tri[i - 1][1] + (p[1] - tri[i - 1][1]) * (j + 1) / 18]) : [p]);
await write([triPts], [0, 0], 1, 850, 10);
await sleep(1300);
await caption(null);
await sleep(400);

// 5 · Tables
await pen(false);
await clearBoard();
await v(() => {
	const b = window.__view;
	b.data.tables.push({ id: "tp", pageId: b.data.activePageId, x: 290, y: 150, w: 700, h: 230, rows: 4, cols: 3, header: true, title: "Leyes de Newton",
		cells: [["Ley", "Enunciado", "Fórmula"], ["1ª", "Inercia", "ΣF = 0"], ["2ª", "Dinámica", ""], ["", "", ""]] });
	b.setTool("select");
	b.renderAll();
});
await caption("Tablas que dan gusto", "Colores, filas alternas y Tab para ir de celda en celda");
await pen(true);
await sleep(600);
const tcells = await page.$$('[data-id="tp"] .notelens-table-cell');
const c8 = await tcells[8].boundingBox();
await glide(c8.x + 40, c8.y + 20); await sleep(200);
await tcells[8].click();
await page.keyboard.type("F = m·a", { delay: 55 });
await page.keyboard.press("Tab");
await page.keyboard.type("3ª", { delay: 70 });
await page.keyboard.press("Tab");
await page.keyboard.type("Acción y reacción", { delay: 40 });
await page.keyboard.press("Tab");
await page.keyboard.type("F₁₂ = −F₂₁", { delay: 55 });
await sleep(500);
await page.hover('[data-id="tp"] .notelens-table-header');
const pal = await page.$('[data-id="tp"] .notelens-table-control[title="Color de la tabla"]');
const pb = await pal.boundingBox();
await glide(pb.x + 12, pb.y + 12); await sleep(250); await pal.click();
await sleep(600);
for (const colour of ["Verde", "Violeta"]) {
	const sw = await page.$(`[data-id="tp"] .notelens-table-swatch[title="${colour}"]`);
	if (!sw) break;
	const sb = await sw.boundingBox();
	await glide(sb.x + 10, sb.y + 10, 8); await sleep(150); await sw.click(); await sleep(650);
	await page.hover('[data-id="tp"] .notelens-table-header');
	const again = await page.$('[data-id="tp"] .notelens-table-control[title="Color de la tabla"]');
	await again?.click(); await sleep(250);
}
await page.mouse.click(200, 600);
await sleep(1000);
await caption(null);
await sleep(400);

// 6 · Revision cards
await clearBoard();
await v(() => {
	const b = window.__view, pageId = b.data.activePageId;
	b.data.texts.push(
		{ id: "q1", pageId, x: 320, y: 150, text: "**¿Qué dice la 2ª ley de Newton?**", fontSize: 28, color: "#f8fafc", variant: "text", autoWidth: true, w: 620, h: 46 },
		{ id: "a1", pageId, x: 320, y: 210, text: "La fuerza neta es igual a la masa por la ==aceleración==.", fontSize: 24, color: "#e5e7eb", variant: "text", w: 640, h: 80, cover: true },
		{ id: "q2", pageId, x: 320, y: 330, text: "**Fórmula**", fontSize: 28, color: "#f8fafc", variant: "text", autoWidth: true, w: 300, h: 46 },
		{ id: "a2", pageId, x: 320, y: 385, text: "F = m a", fontSize: 34, color: "#f8fafc", variant: "math", autoWidth: true, w: 240, h: 80, cover: true }
	);
	b.renderAll();
});
await caption("Tapa la respuesta y repasa", "Como tarjetas de memoria, dentro de tus apuntes");
await sleep(1300);
for (const id of ["a1", "a2"]) {
	const face = await page.$(`[data-id="${id}"] .notelens-study-face`);
	const fb = await face.boundingBox();
	await glide(fb.x + fb.width / 2, fb.y + fb.height / 2); await sleep(350); await face.click(); await sleep(1100);
}
await sleep(900);
await caption(null);
await sleep(400);

// 7 · Search in handwriting
await clearBoard();
await v(() => window.__view.setTool("pen"));
await write(SOL, [330, 150], 1.4, 0, 3);
await v(() => {
	const b = window.__view, pageId = b.data.activePageId;
	b.data.texts.push({ id: "t7", pageId, x: 380, y: 340, text: "El sol es una estrella de tipo G", fontSize: 24, color: "#e5e7eb", variant: "text", autoWidth: true, w: 440, h: 46 });
	b.setTool("select");
	b.renderAll();
});
await caption("Busca también lo escrito a mano", "Ctrl+F encuentra tu letra, con o sin tildes");
await page.mouse.move(1100, 560);
await page.keyboard.down("Control"); await page.keyboard.press("f"); await page.keyboard.up("Control");
await sleep(500);
await page.keyboard.type("sol", { delay: 160 });
await sleep(1500);
await page.keyboard.press("Enter");
await sleep(1500);
await page.keyboard.press("Escape");
await caption(null);
await sleep(400);

// 8 · Ink replay
await clearBoard();
await v(() => window.__view.setTool("pen"));
await write(FORMULA, [330, 70], 1.75, 0, 1);
await v(() => window.__view.setTool("select"));
await caption("Reproduce cómo lo escribiste", "Ideal para repasar un ejercicio paso a paso");
await v(() => window.__view.startInkReplay());
await sleep(4600);
await page.keyboard.press("Escape");
await caption(null);
await sleep(300);

// 9 · The whole board, dark then light paper
await pen(false);
await clearBoard();
await v(() => {
	const b = window.__view, pageId = b.data.activePageId;
	b.data.tables.push({ id: "t9", pageId, x: 70, y: 175, w: 480, h: 190, rows: 4, cols: 3, header: true, title: "Leyes de Newton", color: "violet",
		cells: [["Ley", "Enunciado", "Fórmula"], ["1ª", "Inercia", "ΣF = 0"], ["2ª", "Dinámica", "F = m·a"], ["3ª", "Acción-reacción", "F₁₂ = −F₂₁"]] });
	b.data.texts.push(
		{ id: "h9", pageId, x: 70, y: 115, text: "**Tema 3 · Dinámica**", fontSize: 32, color: "#f8fafc", variant: "text", autoWidth: true, w: 420, h: 50 },
		{ id: "p9", pageId, x: 590, y: 175, text: "La fuerza neta es igual a la masa por la ==aceleración==.\n- Unidades: newton (N)\n- 1 N = 1 kg·m/s²", fontSize: 20, color: "#e5e7eb", variant: "text", w: 400, h: 110 },
		{ id: "m9", pageId, x: 600, y: 320, text: "x = (-b +- sqrt(b^2-4ac))/(2a)", fontSize: 26, color: "#f8fafc", variant: "math", autoWidth: true, w: 360, h: 80 },
		{ id: "s9", pageId, x: 1020, y: 165, text: "Repasar ejercicios 4–9 antes del viernes", fontSize: 20, color: "#1f2937", variant: "text", stickyColor: "#fef08a", w: 200, h: 150 },
		{ id: "s10", pageId, x: 1035, y: 345, text: "Preguntar por el rozamiento", fontSize: 20, color: "#1f2937", variant: "text", stickyColor: "#bbf7d0", w: 190, h: 130 }
	);
	b.data.badges.push({ id: "b9", pageId, x: 430, y: 128, tagId: "important", label: "Importante", title: "Examen" });
	b.data.shapes.push({ id: "sh9", pageId, kind: "ellipse", x: 110, y: 420, w: 190, h: 100, color: "#a78bfa", width: 3, fill: "#a78bfa", fillOpacity: 0.12 });
	b.data.shapes.push({ id: "sh10", pageId, kind: "arrow", x: 320, y: 470, w: 200, h: 0, color: "#f472b6", width: 3 });
	b.renderAll();
});
await caption("Todo en una pizarra infinita", "Tablas, fórmulas, notas, formas, PDFs y vídeo");
await sleep(2000);
await v(() => { const b = window.__view; b.data.backgroundColor = "#fdfcf7"; b.data.background = "lines"; for (const t of b.data.texts) if (!t.stickyColor) t.color = "#111827"; b.updateBackground(); b.renderAll(); });
await sleep(2100);
await caption(null);
await sleep(300);

// 10 · End card
await card(`<div><div class="logo">NoteLens</div><div class="tag">Estudia a mano. Repasa mejor.</div>
	<div class="pills"><span>Gratis</span><span>Sin conexión</span><span>Tu letra, entendida</span><span>Plugin de Obsidian</span></div>
	<div class="sub" style="margin-top:40px">Búscalo en los plugins de la comunidad de Obsidian</div></div>`);
await sleep(3800);

await cdp.send("Page.stopScreencast");
await v(() => clearInterval(window.__tick));
const seconds = (Date.now() - started) / 1000;
console.log(`grabado: ${frames.length} fotogramas en ${seconds.toFixed(1)} s · errores de página: ${errors.length ? errors.slice(0, 3) : "(ninguno)"}`);
await browser.close();

// ---------------------------------------------------------------------------
// Encoding: each frame lasts until the next one arrived; resampled to 30 fps.
// ---------------------------------------------------------------------------
const list = frames.map((f, i) => {
	const next = frames[i + 1]?.t ?? f.t + 0.5;
	return `file '${f.file.replace(/\\/g, "/")}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}`;
}).join("\n") + `\nfile '${frames[frames.length - 1].file.replace(/\\/g, "/")}'\n`;
const listFile = path.join(framesDir, "frames.txt");
fs.writeFileSync(listFile, list);
const total = frames[frames.length - 1].t - frames[0].t + 0.5;
// A soft pad: an A-major chord of sines, breathing slowly, faded in and out.
const pad = `aevalsrc='0.05*sin(2*PI*220*t)*(0.8+0.2*sin(2*PI*0.13*t))+0.04*sin(2*PI*277.18*t)*(0.8+0.2*sin(2*PI*0.11*t+1))+0.035*sin(2*PI*329.63*t)*(0.8+0.2*sin(2*PI*0.09*t+2))+0.025*sin(2*PI*110*t)':s=48000:d=${total.toFixed(2)}`;
execFileSync("ffmpeg", [
	"-y", "-loglevel", "error",
	"-f", "concat", "-safe", "0", "-i", listFile,
	"-f", "lavfi", "-i", pad,
	"-filter_complex", `[0:v]fps=30,scale=${W * DPR}:${H * DPR}:flags=lanczos,format=yuv420p[v];[1:a]lowpass=f=1800,afade=t=in:d=2,afade=t=out:st=${Math.max(0, total - 3).toFixed(2)}:d=3,volume=0.9[a]`,
	"-map", "[v]", "-map", "[a]",
	"-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart",
	"-c:a", "aac", "-b:a", "160k", "-shortest",
	out
], { stdio: "inherit" });
console.log(`vídeo: ${out}`);
