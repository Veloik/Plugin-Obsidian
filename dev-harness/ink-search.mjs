// Searching handwriting: writes "sol 12" by hand and, further down, a typed
// "Energía", then checks that Ctrl+F finds the handwritten word, frames it,
// ignores accents in typed text, and finds nothing for a word never written.
// Screenshots in shots-ink/.
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
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await sleep(1200);
let failed = 0;
const check = (ok, label, detail = "") => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`); };
await page.click('.onenote-ribbon-dock [data-tool="pen"]');
const origin = [420, 380];
for (const stroke of STROKES) {
	const pts = penPath(stroke);
	await page.mouse.move(origin[0] + pts[0][0], origin[1] + pts[0][1]);
	await page.mouse.down();
	for (const [x, y] of pts.slice(1)) await page.mouse.move(origin[0] + x, origin[1] + y);
	await page.mouse.up();
}
await page.evaluate(() => {
	__view.data.texts.push({ id: "t-energia", pageId: __view.data.activePageId, x: 300, y: 700, text: "Energía cinética", fontSize: 20, color: "#fff", variant: "text", autoWidth: true, w: 200, h: 40 });
	__view.renderAll();
});
await page.click('.onenote-ribbon-dock [data-tool="select"]');
await page.mouse.move(1100, 250);
await page.keyboard.down("Control"); await page.keyboard.press("f"); await page.keyboard.up("Control");
await sleep(150);
const search = async (text) => {
	await page.$eval(".notelens-search-input", (input, value) => { input.value = value; input.dispatchEvent(new Event("input")); }, text);
	await sleep(400);
	return page.evaluate(() => ({
		count: document.querySelector(".notelens-search-count")?.textContent,
		frames: document.querySelectorAll(".notelens-ink-hit").length,
		current: !!document.querySelector(".notelens-ink-hit.notelens-search-current"),
		texts: document.querySelectorAll(".notelens-search-hit:not(.notelens-ink-hit)").length
	}));
};
let r = await search("sol");
check(r.count === "1/1" && r.frames === 1 && r.current, "encuentra «sol» escrito a mano y lo enmarca", JSON.stringify(r));
await page.screenshot({ path: path.join(shots, "buscar-tinta.png") });
r = await search("12");
check(r.frames === 1, "y el número escrito a mano", JSON.stringify(r));
r = await search("energia");
check(r.count === "1/1" && r.texts === 1 && r.frames === 0, "«energia» encuentra «Energía» tecleado", JSON.stringify(r));
r = await search("planeta");
check(r.count === "0" && r.frames === 0, "nada para una palabra que no está", JSON.stringify(r));
await page.keyboard.press("Escape");
await sleep(100);
check(await page.$(".notelens-ink-hit") === null && await page.$(".notelens-search") === null, "Escape cierra la búsqueda y quita los marcos");
console.log("errores de página:", errors.length ? errors.slice(0, 3) : "(ninguno)");
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;
console.log(failed ? `${failed} fallo(s)` : "todo correcto");
