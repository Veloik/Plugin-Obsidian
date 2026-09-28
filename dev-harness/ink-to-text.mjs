// Ink → text, end to end: writes a word and a number on the board with the
// mouse the way a pen would, selects them, presses "Convertir la tinta en
// texto" and checks the text box that replaces the ink, then that Ctrl+Z
// brings the ink back. Screenshots in shots-ink/.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots-ink");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** A smooth pen path through control points (Catmull-Rom). */
function penPath(controls, perSegment = 6) {
	if (controls.length < 3) {
		const [[x1, y1], [x2, y2]] = controls;
		return Array.from({ length: 10 }, (_, i) => [x1 + (x2 - x1) * i / 9, y1 + (y2 - y1) * i / 9]);
	}
	const pts = [controls[0], ...controls, controls[controls.length - 1]];
	const out = [];
	for (let i = 1; i < pts.length - 2; i++) {
		const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
		for (let s = 0; s < perSegment; s++) {
			const t = s / perSegment, t2 = t * t, t3 = t2 * t;
			out.push([0, 1].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
		}
	}
	out.push(controls[controls.length - 1]);
	return out;
}

// "sol 12": baseline at y = 100, small letters 30 tall, ascenders 50.
const circle = (cx, cy, r) => Array.from({ length: 13 }, (_, i) => [cx + r * Math.cos(-Math.PI / 2 - i * Math.PI / 6), cy + r * Math.sin(-Math.PI / 2 - i * Math.PI / 6)]);
const STROKES = [
	[[46, 74], [34, 70], [24, 76], [28, 86], [42, 90], [46, 98], [36, 104], [22, 100]],
	circle(74, 88, 15),
	[[104, 50], [104, 102]],
	[[150, 62], [160, 52], [160, 102]],
	[[178, 62], [188, 52], [202, 55], [201, 68], [180, 100], [206, 100]]
];

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 980 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
	window.__markdownFiles = ["Astronomía/Sistema solar.md"];
	window.__fileHeadings = { "Astronomía/Sistema solar.md": ["El sol y sus planetas"] };
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await sleep(1200);
let failed = 0;
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
await tool("pen");
const origin = [420, 380];
for (const stroke of STROKES) {
	const pts = penPath(stroke);
	await page.mouse.move(origin[0] + pts[0][0], origin[1] + pts[0][1]);
	await page.mouse.down();
	for (const [x, y] of pts.slice(1)) await page.mouse.move(origin[0] + x, origin[1] + y);
	await page.mouse.up();
}
const before = await page.evaluate(() => __view.data.strokes.length);
await tool("select");
await page.mouse.move(origin[0] - 10, origin[1] + 20); await page.mouse.down();
await page.mouse.move(origin[0] + 240, origin[1] + 130, { steps: 5 }); await page.mouse.up();
await sleep(150);
await page.screenshot({ path: path.join(shots, "texto-seleccion.png") });
const button = await page.$(".notelens-selection-action[title='Convertir la tinta en texto']");
if (!button) { failed++; console.log("FAIL no aparece el botón de convertir en texto"); }
else {
	await button.click();
	await sleep(500);
	const after = await page.evaluate(() => {
		const box = __view.data.texts[__view.data.texts.length - 1];
		return { strokes: __view.data.strokes.length, text: box?.text, size: box?.fontSize, selected: __view.selTexts.has(box?.id) };
	});
	await page.screenshot({ path: path.join(shots, "texto-convertido.png") });
	const ok = after.text === "sol 12" && after.strokes === before - STROKES.length && after.selected && after.size >= 20 && after.size <= 72;
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "FAIL"} leído ${JSON.stringify(after.text)} · trazos ${before} → ${after.strokes} · tamaño ${after.size} · seleccionado ${after.selected}`);
	await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
	await sleep(300);
	const undone = await page.evaluate(() => ({ strokes: __view.data.strokes.length, texts: __view.data.texts.length }));
	const back = undone.strokes === before && undone.texts === 0;
	if (!back) failed++;
	console.log(`${back ? "ok  " : "FAIL"} Ctrl+Z devuelve la tinta · trazos ${undone.strokes} · textos ${undone.texts}`);
}
console.log("errores de página:", errors.length ? errors.slice(0, 3) : "(ninguno)");
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;
