// Handwriting → LaTeX, end to end: opens "Insertar ecuación", writes formulas
// with the mouse the way a pen would, and checks the notation the dialog fills
// in, the review list and that the preview renders. Screenshots in shots-ink/.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots-ink");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** A smooth pen path through control points (Catmull-Rom), in pad pixels. */
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

const CASES = [
	{
		name: "potencia-fraccion",
		expected: "x^{2}+1=\\frac{3}{4}",
		strokes: [
			[[60, 140], [78, 162], [96, 186]], [[96, 140], [78, 162], [60, 186]],
			[[104, 112], [113, 103], [125, 106], [124, 118], [106, 134], [130, 134]],
			[[146, 163], [182, 162]], [[164, 146], [164, 180]],
			[[203, 150], [214, 140], [214, 186]],
			[[238, 156], [272, 156]], [[238, 172], [272, 172]],
			[[302, 104], [320, 96], [336, 106], [322, 119], [338, 131], [322, 145], [300, 140]],
			[[290, 160], [352, 160]],
			[[318, 172], [304, 199], [336, 199]], [[328, 176], [328, 216]]
		]
	},
	{
		name: "dos-renglones",
		expected: "\\begin{aligned}x+1&=3\\\\x&=2\\end{aligned}",
		strokes: [
			[[60, 70], [78, 92], [96, 116]], [[96, 70], [78, 92], [60, 116]],
			[[120, 93], [156, 92]], [[138, 76], [138, 110]],
			[[177, 80], [188, 70], [188, 116]],
			[[212, 86], [246, 86]], [[212, 102], [246, 102]],
			[[272, 72], [290, 64], [306, 74], [292, 87], [308, 99], [292, 113], [270, 108]],
			[[60, 190], [78, 212], [96, 236]], [[96, 190], [78, 212], [60, 236]],
			[[212, 206], [246, 206]], [[212, 222], [246, 222]],
			[[272, 196], [281, 187], [293, 190], [292, 202], [274, 228], [298, 228]]
		]
	},
	{
		name: "raiz",
		expected: "\\sqrt{2}+y",
		strokes: [
			[[60, 160], [70, 156], [82, 190], [100, 118], [170, 118]],
			[[112, 142], [124, 132], [138, 136], [136, 150], [114, 176], [142, 176]],
			[[190, 158], [226, 158]], [[208, 141], [208, 176]],
			[[250, 144], [260, 166], [272, 144]], [[274, 144], [262, 180], [248, 206]]
		]
	}
];

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 980 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

let failed = 0;
for (const c of CASES) {
	await page.click(".notelens-insert-dock button[title^='Insertar ecuación']");
	await sleep(300);
	const [left, top] = await page.evaluate(() => {
		const r = document.querySelector(".notelens-ink-board canvas").getBoundingClientRect();
		return [r.left, r.top];
	});
	for (const stroke of c.strokes) {
		const pts = penPath(stroke);
		await page.mouse.move(left + pts[0][0], top + pts[0][1]);
		await page.mouse.down();
		for (const [x, y] of pts.slice(1)) await page.mouse.move(left + x, top + y);
		await page.mouse.up();
		await sleep(40);
	}
	await sleep(1400);
	const state = await page.evaluate(() => ({
		source: document.querySelector(".notelens-ink-source").value,
		status: document.querySelector(".notelens-ink-status").textContent,
		preview: !!document.querySelector(".notelens-ink-preview mjx-container, .notelens-ink-preview .MathJax, .notelens-ink-preview mjx-math"),
		review: [...document.querySelectorAll(".notelens-ink-candidates select")].map(s => [...s.options].map(o => o.value).join("|"))
	}));
	const ok = state.source.replace(/\s+/g, "") === c.expected;
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "FAIL"} ${c.name}: ${JSON.stringify(state.source)} (esperado ${JSON.stringify(c.expected)})`);
	console.log(`     estado: ${state.status} · vista previa: ${state.preview ? "sí" : "NO"} · revisar: ${state.review.join(" ; ") || "—"}`);
	await page.screenshot({ path: path.join(shots, `${c.name}.png`) });
	await page.keyboard.press("Escape");
	await sleep(300);
}
// Ink already on the board: select it, "Convertir la tinta en fórmula", insert.
{
	const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
	await tool("pen");
	const origin = [360, 380];
	for (const stroke of CASES[0].strokes) {
		const pts = penPath(stroke);
		await page.mouse.move(origin[0] + pts[0][0], origin[1] + pts[0][1]);
		await page.mouse.down();
		for (const [x, y] of pts.slice(1)) await page.mouse.move(origin[0] + x, origin[1] + y);
		await page.mouse.up();
	}
	const before = await page.evaluate(() => __view.data.strokes.length);
	await tool("select");
	await page.mouse.move(origin[0] + 20, origin[1] + 60); await page.mouse.down();
	await page.mouse.move(origin[0] + 400, origin[1] + 250, { steps: 5 }); await page.mouse.up();
	await sleep(150);
	const button = await page.$(".notelens-selection-action[title='Convertir la tinta en fórmula (LaTeX)']");
	if (!button) { failed++; console.log("FAIL pizarra: no aparece el botón de convertir"); }
	else {
		await button.click();
		await sleep(1400);
		const source = await page.evaluate(() => document.querySelector(".notelens-ink-source")?.value);
		await page.screenshot({ path: path.join(shots, "pizarra-dialogo.png") });
		await page.evaluate(() => [...document.querySelectorAll(".notelens-ink-footer button")].find(b => b.textContent === "Insertar")?.click());
		await sleep(600);
		const after = await page.evaluate(() => ({
			strokes: __view.data.strokes.length,
			formula: __view.data.texts.filter(t => t.variant === "math").map(t => t.text).pop()
		}));
		await page.screenshot({ path: path.join(shots, "pizarra-insertada.png") });
		await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
		await sleep(300);
		const undone = await page.evaluate(() => __view.data.strokes.length);
		const ok = source?.replace(/\s+/g, "") === CASES[0].expected && after.strokes === before - CASES[0].strokes.length
			&& after.formula === source && undone === before;
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} pizarra: leído ${JSON.stringify(source)}, trazos ${before} → ${after.strokes} → deshacer ${undone}, fórmula ${JSON.stringify(after.formula)}`);
	}
}
console.log("errores de página:", errors.length ? errors.slice(0, 3) : "(ninguno)");
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;
