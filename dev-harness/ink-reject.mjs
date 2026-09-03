// Calibrates the line between "I know this" and "I have no idea".
//
// Prints the match distance for symbols the library knows (should be small)
// and for things it has never seen (should be large). A threshold that
// separates the two is what stops the reader inventing an answer.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CASES, path as penPath, line, ring } from "./ink-corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const strokes = (...points) => points.map(p => ({ points: p.map(([x, y]) => ({ x, y })) }));

// Things a student might draw that the library does not contain. Some are real
// symbols it does not know, some are not symbols at all.
const UNKNOWN = {
	"espiral": strokes(Array.from({ length: 60 }, (_, i) => {
		const t = i / 8, r = 3 + t * 3.4;
		return [32 + r * Math.cos(t), 34 + r * Math.sin(t)];
	})),
	"garabato": strokes(penPath([[8, 40], [24, 12], [30, 52], [44, 16], [50, 56], [60, 26]])),
	"corazón": strokes(penPath([[32, 60], [8, 34], [16, 14], [32, 26], [48, 14], [56, 34], [32, 60]])),
	"casa": strokes(penPath([[10, 60], [10, 30], [32, 10], [54, 30], [54, 60], [10, 60]])),
	"estrella": strokes(penPath([[32, 6], [42, 38], [58, 38], [45, 50], [50, 62], [32, 46], [14, 62], [19, 50], [6, 38], [22, 38], [32, 6]])),
	"aprox (≈)": strokes(penPath([[10, 28], [20, 22], [30, 32], [40, 24]]), penPath([[10, 44], [20, 38], [30, 48], [40, 40]])),
	"nabla (∇)": strokes(line(10, 10, 54, 10), line(54, 10, 32, 60), line(32, 60, 10, 10)),
	"cara": strokes(ring(32, 34, 24, 26), line(24, 26, 24, 30), line(40, 26, 40, 30), penPath([[20, 44], [32, 52], [44, 44]])),
	"rayas": strokes(line(10, 20, 54, 20), line(10, 34, 54, 34), line(10, 48, 54, 48)),
	"punto y coma": strokes(line(30, 24, 33, 27), penPath([[33, 50], [30, 58], [24, 66]]))
};

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

const distanceOf = (strokeList) => page.evaluate((s) => {
	const matches = window.__assistantTest.matchShape(s.map(stroke => stroke.points));
	// The exported score is 1 - distance / 14, so undo it to see the raw number.
	return matches.slice(0, 3).map(m => ({ value: m.value, distance: Math.round((1 - m.score) * 14 * 100) / 100 }));
}, strokeList);

console.log("=== símbolos que la biblioteca conoce ===");
const known = [];
// Single symbols only: the distance of a whole expression to one prototype
// means nothing.
for (const c of CASES.filter(c => c.label.includes("#"))) {
	const top = await distanceOf(c.strokes);
	known.push(top[0].distance);
	console.log(`  ${c.label.padEnd(8)} ${top.map(t => `${t.value}:${t.distance}`).join("  ")}`);
}

console.log("\n=== cosas que NO conoce ===");
const unknown = [];
for (const [label, strokeList] of Object.entries(UNKNOWN)) {
	const top = await distanceOf(strokeList);
	unknown.push(top[0].distance);
	console.log(`  ${label.padEnd(13)} ${top.map(t => `${t.value}:${t.distance}`).join("  ")}`);
}

const sorted = (a) => [...a].sort((x, y) => x - y);
const at = (a, q) => sorted(a)[Math.floor((a.length - 1) * q)];
console.log(`\nconocidos:   mediana ${at(known, 0.5)}  p90 ${at(known, 0.9)}  peor ${Math.max(...known)}`);
console.log(`desconocidos: mejor ${Math.min(...unknown)}  mediana ${at(unknown, 0.5)}`);
await browser.close();
