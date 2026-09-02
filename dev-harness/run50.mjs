// Dominant symbols: a radical owning what is under it, sums and integrals
// owning their limits — the structure Microsoft's ink recognizer builds.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

const read = (strokes) => page.evaluate((s) => {
	const r = window.__assistantTest.recognizeInkFormula(s);
	return { source: r.source, confidence: Math.round(r.confidence * 100) / 100, tokens: r.tokens.map(t => t.value) };
}, strokes);

// Stroke builders, in page coordinates.
const poly = (pts, steps = 6) => {
	const points = [];
	for (let i = 0; i < pts.length - 1; i++) {
		const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
		for (let s = 0; s <= steps; s++) points.push({ x: x1 + (x2 - x1) * s / steps, y: y1 + (y2 - y1) * s / steps });
	}
	return { points };
};
const line = (x1, y1, x2, y2) => poly([[x1, y1], [x2, y2]], 8);

const radical = poly([[10, 30], [17, 48], [26, 6], [78, 6]]);
const sigma = poly([[20, 10], [52, 10], [33, 26], [52, 42], [20, 42]]);
// A real integral has a hook at each end: it curves right at the top and left
// at the bottom. A straight slanted line is not one, and must not read as one.
const integral = poly([[46, 2], [40, 0], [34, 5], [36, 15], [33, 26], [30, 38], [27, 47], [21, 52], [15, 50]], 5);
const slanted = poly([[44, 4], [21, 52]], 10);

const cases = [
	["radical solo", [radical]],
	["radical con x dentro", [radical, line(36, 16, 52, 40), line(52, 16, 36, 40)]],
	["radical con 1 dentro", [radical, line(40, 14, 40, 42)]],
	["sigma solo", [sigma]],
	["sigma con límites", [sigma, line(30, 50, 30, 66), line(28, -14, 28, -2)]],
	["integral sola", [integral]],
	["integral con límites", [integral, line(44, 56, 44, 70), line(44, -14, 44, -2)]],
	["recta inclinada (no ∫)", [slanted]]
];

// What each case must read as. A lone dominant symbol stays a plain glyph:
// an empty \sqrt{} would be worse than the symbol on its own.
const expected = {
	"radical solo": "sqrt",
	"radical con x dentro": "\\sqrt{x}",
	"radical con 1 dentro": "\\sqrt{1}",
	"sigma solo": "sum",
	"sigma con límites": "\\sum_{1}^{1}",
	"integral sola": "int",
	"integral con límites": "\\int_{1}^{1}",
	"recta inclinada (no ∫)": "/"
};

let failures = 0;
for (const [name, strokes] of cases) {
	const out = await read(strokes);
	const want = expected[name];
	const ok = out.source === want;
	if (!ok) failures++;
	console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(24)} → ${JSON.stringify(out.source)}  conf ${out.confidence}${ok ? "" : `  (esperado ${JSON.stringify(want)})`}`);
}
console.log("console issues:", errors.length ? errors.slice(0, 3).join(" | ") : "(none)");
console.log(failures ? `FALLOS: ${failures}` : "todas las comprobaciones pasan");
await browser.close();
process.exit(failures ? 1 : 0);
