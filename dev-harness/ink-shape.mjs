// Draw and hold: a circle drawn with the pen and held still becomes an
// ellipse shape; the same circle lifted at once stays ink; handwriting held
// still stays ink; Ctrl+Z gives the stroke back; the setting turns it off.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots-ink");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
await page.evaluate(() => __view.setTool("pen"));

const draw = async (points, hold) => {
	await page.mouse.move(points[0][0], points[0][1]);
	await page.mouse.down();
	for (const [x, y] of points.slice(1)) await page.mouse.move(x, y);
	await sleep(hold);
	await page.mouse.up();
	await sleep(100);
};
const circle = (cx, cy, r) => Array.from({ length: 50 }, (_, i) => {
	const t = i / 49 * Math.PI * 2.05;
	return [cx + Math.cos(t) * r + Math.sin(i * 1.7) * 2, cy + Math.sin(t) * r * 0.8 + Math.cos(i * 1.3) * 2];
});
const counts = () => page.evaluate(() => ({ strokes: __view.data.strokes.length, shapes: __view.data.shapes.map(s => s.kind) }));

await draw(circle(500, 400, 90), 900);
let c = await counts();
check(c.strokes === 0 && c.shapes.join() === "ellipse", "un círculo mantenido se convierte en elipse", JSON.stringify(c));
await page.screenshot({ path: path.join(shots, "forma-elipse.png") });

await draw([[800, 300], [950, 300], [950, 420], [800, 420], [801, 302]].flatMap((p, i, a) => i ? Array.from({ length: 12 }, (_, k) => [a[i - 1][0] + (p[0] - a[i - 1][0]) * (k + 1) / 12, a[i - 1][1] + (p[1] - a[i - 1][1]) * (k + 1) / 12]) : [p]), 900);
c = await counts();
check(c.shapes.join() === "ellipse,rectangle", "un rectángulo mantenido se convierte en rectángulo", JSON.stringify(c));

await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
await sleep(200);
c = await counts();
check(c.strokes === 1 && c.shapes.join() === "ellipse", "Ctrl+Z devuelve el trazo a mano", JSON.stringify(c));

await draw(circle(500, 700, 90), 50);
c = await counts();
check(c.strokes === 2 && c.shapes.length === 1, "levantado enseguida sigue siendo tinta", JSON.stringify(c));

// A small letter held still is handwriting pausing, not a shape.
await draw(circle(300, 700, 12), 900);
c = await counts();
check(c.strokes === 3 && c.shapes.length === 1, "una letra pequeña mantenida sigue siendo tinta", JSON.stringify(c));

await page.evaluate(() => { __view.plugin.settings.holdToShape = false; });
await draw(circle(900, 700, 90), 900);
c = await counts();
check(c.strokes === 4 && c.shapes.length === 1, "con el ajuste apagado no convierte", JSON.stringify(c));

console.log("errores de página:", errors.length ? errors.slice(0, 3) : "(ninguno)");
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;
console.log(failed ? `${failed} fallo(s)` : "todo correcto");
