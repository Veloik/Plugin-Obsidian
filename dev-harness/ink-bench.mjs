// How good is handwriting recognition, really? Draws each symbol the way a
// person writes it (several variants, with a little tremor), runs the real
// recognizer in the browser and prints a per-symbol score.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CASES } from "./ink-corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security"],
	defaultViewport: { width: 900, height: 700 }
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

const cases = CASES;

const results = await page.evaluate((serialised) => {
	const recognize = window.__assistantTest?.recognizeInkFormula;
	if (!recognize) return { error: "no recognizer exposed" };
	return serialised.map(c => {
		const out = recognize(c.strokes);
		return { label: c.label, expected: c.expected, got: out.source, confidence: Math.round(out.confidence * 100) / 100, alternatives: (out.tokens ?? []).map(t => t.alternatives?.slice(0, 3).join("")).slice(0, 4) };
	});
}, cases);

if (results.error) {
	console.log("!!", results.error);
} else {
	let ok = 0;
	const failures = [];
	for (const r of results) {
		// "o" and "0" are the same shape on paper, and every recogniser reads a
		// lone round mark as a zero. Answering "0" to an "o" is not a failure.
		const same = (text) => text.replace(/\s+/g, "").replace(/o/g, "0");
		const hit = same(r.got) === same(r.expected);
		if (hit) ok++; else failures.push(r);
		console.log(`${hit ? "ok  " : "FAIL"} ${r.label.padEnd(8)} esperado ${JSON.stringify(r.expected).padEnd(9)} leído ${JSON.stringify(r.got).padEnd(12)} conf ${r.confidence}`);
	}
	console.log(`\nACIERTOS: ${ok}/${results.length} (${Math.round(ok / results.length * 100)} %)`);
	fs.writeFileSync(path.join(here, "ink-bench.json"), JSON.stringify(results, null, 1));
}
// --- robustness: the same symbols, written differently -----------------------
// Tuning against a fixed corpus makes it agree with itself. These variations
// were never used while fixing anything: a different tremor, written smaller
// and larger, and slightly slanted, which is what a real hand does.
const vary = (strokes, { seed, scale, slant, wobble }) => {
	let state = seed;
	const noise = () => { state = (state * 1103515245 + 12345) % 2147483648; return (state / 2147483648 - 0.5) * wobble; };
	return strokes.map(stroke => ({
		points: stroke.points.map(p => {
			const x = p.x * scale + noise();
			const y = p.y * scale + noise();
			return { x: x + y * slant, y };
		})
	}));
};
const VARIATIONS = [
	{ seed: 101, scale: 0.55, slant: 0, wobble: 1.2 },
	{ seed: 202, scale: 1, slant: 0.12, wobble: 1.6 },
	{ seed: 303, scale: 2.2, slant: -0.08, wobble: 2.4 },
	{ seed: 404, scale: 3.5, slant: 0.05, wobble: 3.2 }
];
const varied = [];
for (const c of CASES) {
	VARIATIONS.forEach((v, i) => varied.push({ ...c, label: `${c.label}~${i + 1}`, strokes: vary(c.strokes, v) }));
}
const robust = await page.evaluate((serialised) => serialised.map(c => {
	const out = window.__assistantTest.recognizeInkFormula(c.strokes);
	return { label: c.label, expected: c.expected, got: out.source };
}), varied);
const same = (text) => text.replace(/\s+/g, "").replace(/o/g, "0");
const wrong = robust.filter(r => same(r.got) !== same(r.expected));
console.log(`
ROBUSTEZ (tamaño, temblor e inclinación distintos): ${robust.length - wrong.length}/${robust.length} (${Math.round((robust.length - wrong.length) / robust.length * 100)} %)`);
const byLabel = new Map();
for (const r of wrong) {
	const base = r.label.split("~")[0];
	byLabel.set(base, [...(byLabel.get(base) ?? []), r.got.replace(/\s+/g, "")]);
}
for (const [label, gots] of [...byLabel].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
	console.log(`  ${label.padEnd(8)} falla ${gots.length}/${VARIATIONS.length}: ${gots.join(" · ")}`);
}

await browser.close();
