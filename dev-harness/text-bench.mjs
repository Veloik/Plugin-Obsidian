// Ink → text benchmark.
//
// Builds handwritten phrases out of the UJI Pen Characters v2 file (CC BY 4.0,
// https://archive.ics.uci.edu/dataset/467): the letters of one writer, scaled
// to typographic proportions (small letters, ascenders, descenders, capitals),
// set on a baseline with the spacing of handwriting, and read back with the
// real recogniser. Only the "tst_" writers are used.
//
//   node dev-harness/text-bench.mjs <ujipenchars2.txt> [--n 300] [--show 15]
//
// The network saw UJI in training, so the absolute number is optimistic; what
// this measures honestly is the rest of the pipeline — cutting words, spaces,
// case, letters against digits, dots of i — and it compares changes to it.
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--") && !/^\d+$/.test(a));
const option = (name, fallback) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : fallback; };
const count = Number(option("n", "300"));
const show = Number(option("show", "15"));
if (!file || !fs.existsSync(file)) {
	console.error("uso: node dev-harness/text-bench.mjs <ujipenchars2.txt> [--n 300]");
	process.exit(1);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "notelens-text-"));
fs.writeFileSync(path.join(temp, "entry.ts"), `export { recognizeInkText } from ${JSON.stringify(path.join(here, "..", "src", "ink-text.ts").replace(/\\/g, "/"))};
export { segmentInk } from ${JSON.stringify(path.join(here, "..", "src", "ink-math.ts").replace(/\\/g, "/"))};`);
await build({
	entryPoints: [path.join(temp, "entry.ts")], bundle: true, platform: "node", format: "esm", target: "node20",
	outfile: path.join(temp, "bundle.mjs"), logLevel: "silent",
	plugins: [{ name: "obsidian-stub", setup(b) {
		b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
		b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export function getLanguage() { return "es"; }', loader: "js" }));
	} }]
});
const { recognizeInkText, segmentInk } = await import(pathToFileURL(path.join(temp, "bundle.mjs")).href);
fs.rmSync(temp, { recursive: true, force: true });

// writer -> char -> [strokes]
const writers = new Map();
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
	const m = /^WORD (\S+) (tst_\S+)-\d+$/.exec(lines[i]);
	if (!m) continue;
	const n = Number(/NUMSTROKES (\d+)/.exec(lines[i + 1])[1]);
	const strokes = [];
	for (let k = 0; k < n; k++) {
		const nums = lines[i + 2 + k].split("#")[1].trim().split(/\s+/).map(Number);
		const pts = [];
		for (let j = 0; j + 1 < nums.length; j += 2) pts.push({ x: nums[j], y: nums[j + 1] });
		strokes.push(pts);
	}
	if (!writers.has(m[2])) writers.set(m[2], new Map());
	const chars = writers.get(m[2]);
	if (!chars.has(m[1])) chars.set(m[1], strokes);
}

const PHRASES = [
	"la masa total", "el valor de x", "ver la tabla", "punto y recta", "the same rate", "note this idea",
	"tarea para el lunes", "Fuerza y masa", "velocidad media", "Energia total", "sin datos", "dos casos",
	"page two", "the result", "Ley de Ohm", "curva normal", "Serie de Taylor", "cada paso", "idea clave",
	"graph of f", "base y altura", "suma de cuadrados", "Examen final", "nota media", "tiempo total",
	"Kepler", "Newton", "Pascal", "Gauss", "vector nulo", "limite finito", "resto cero", "hoja nueva",
	"tema tres", "caso general", "ejemplo claro", "one more step", "table of values", "Ohm law", "mass and force",
	"123", "2024", "tema 5", "pagina 42", "hoja 3", "test 1", "valor 10", "paso 7"
];
const XH = 20;
const SMALL = new Set([..."acemnorsuvwxz"]);
const DESC = new Set([..."gjpqy"]);

function place(ch, strokes, x, rnd) {
	const all = strokes.flat();
	const minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x));
	const minY = Math.min(...all.map(p => p.y)), maxY = Math.max(...all.map(p => p.y));
	const h = SMALL.has(ch) ? XH : /[A-Z0-9]/.test(ch) ? XH * 1.45 : XH * 1.5;
	const k = h / Math.max(1, maxY - minY) * (0.92 + rnd() * 0.16);
	const bottom = DESC.has(ch) ? XH * 0.5 : 0;
	const out = strokes.map(s => ({ width: 2.5, points: s.map(p => ({ x: x + (p.x - minX) * k, y: bottom - (maxY - p.y) * k })) }));
	return { strokes: out, right: x + (maxX - minX) * k };
}

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const ids = [...writers.keys()];
let chars = 0, charErrors = 0, exact = 0, done = 0;
const fails = [];
function distance(a, b) {
	const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) dp[0][j] = j;
	for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
	return dp[a.length][b.length];
}
for (let t = 0; done < count && t < count * 4; t++) {
	const phrase = PHRASES[t % PHRASES.length];
	const writer = writers.get(ids[Math.floor(rnd() * ids.length)]);
	if (![...phrase.replace(/ /g, "")].every(c => writer.has(c))) continue;
	const strokes = [];
	let x = 0;
	for (const c of phrase) {
		if (c === " ") { x += XH * (0.9 + rnd() * 0.6); continue; }
		const placed = place(c, writer.get(c), x, rnd);
		strokes.push(...placed.strokes);
		x = placed.right + XH * (0.12 + rnd() * 0.22);
	}
	const got = recognizeInkText(strokes).text;
	if (option("debug", "") && got !== phrase && phrase.includes(option("debug", ""))) {
		console.log(`«${phrase}» → «${got}»`);
		for (const g of segmentInk(strokes).glyphs) console.log(`   ${g.dot ? "·" : " "} ${g.strokes.length}tr @${g.box.x.toFixed(0)},${g.box.y.toFixed(0)} ${g.box.w.toFixed(0)}x${g.box.h.toFixed(0)}  ${g.ranked.slice(0, 4).map(r => `${r.value}:${r.p.toFixed(2)}`).join(" ")}`);
	}
	const d = distance([...phrase], [...got]);
	chars += phrase.length;
	charErrors += Math.min(d, phrase.length);
	if (d === 0) exact++; else fails.push(`   esperado «${phrase}»  leído «${got}»`);
	done++;
}
console.log(fails.slice(0, show).join("\n"));
console.log(`\nFrases: ${done} · exactas ${(exact / done * 100).toFixed(1)} % · error por carácter ${(charErrors / chars * 100).toFixed(1)} %`);
