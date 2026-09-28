// Whole-formula benchmark on handwriting other people produced.
//
// Reads InkML files (the MathWriting dataset: https://github.com/google-research/google-research/tree/master/mathwriting,
// CC BY-NC-SA 4.0 — it is used here to MEASURE, never shipped), keeps the
// expressions written with the notation a student uses, runs the real
// recogniser on each one and compares the LaTeX it would render.
//
//   node dev-harness/formula-bench.mjs <dir-with-inkml> [--limit N] [--show N] [--json out.json]
//
// Prints exact-match rate, token error rate (edit distance over LaTeX tokens)
// and the most frequent confusions, which is what points at the next fix.
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith("--") && !/^\d+$/.test(a));
const option = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at >= 0 ? args[at + 1] : fallback;
};
const limit = Number(option("limit", "600"));
const show = Number(option("show", "25"));
const jsonOut = option("json", "");
const debugId = option("debug", "");
const renderOut = option("render", "");
// Only what a student writes: numbers, a few letters, the four operations,
// powers, fractions and roots. The full set is research papers.
const school = args.includes("--school");
if (!dir || !fs.existsSync(dir)) {
	console.error("uso: node dev-harness/formula-bench.mjs <carpeta-inkml> [--limit N] [--show N]");
	process.exit(1);
}

// ---------------------------------------------------------------------------
// The recogniser, bundled for node the same way the core tests do it.
// ---------------------------------------------------------------------------
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "notelens-bench-"));
const entry = path.join(temp, "entry.ts");
fs.writeFileSync(entry, `
export { recognizeInkFormula, inspectInkFormula } from ${JSON.stringify(path.join(here, "..", "src", "ink-math.ts").replace(/\\/g, "/"))};
export { toRenderableLatex } from ${JSON.stringify(path.join(here, "..", "src", "asciimath.ts").replace(/\\/g, "/"))};
`);
await build({
	entryPoints: [entry], bundle: true, platform: "node", format: "esm", target: "node20",
	outfile: path.join(temp, "bundle.mjs"), logLevel: "silent",
	plugins: [{
		name: "obsidian-stub",
		setup(b) {
			b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
			b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export function getLanguage() { return "es"; }', loader: "js" }));
		}
	}]
});
const { recognizeInkFormula, inspectInkFormula, toRenderableLatex } = await import(pathToFileURL(path.join(temp, "bundle.mjs")).href);
fs.rmSync(temp, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// LaTeX normalisation: two spellings of the same formula must compare equal.
// ---------------------------------------------------------------------------
const ALIASES = {
	"\\to": "\\rightarrow", "\\le": "\\leq", "\\ge": "\\geq", "\\ne": "\\neq", "\\leqslant": "\\leq", "\\geqslant": "\\geq",
	"\\dots": "\\ldots", "\\cdots": "\\ldots", "\\lbrace": "\\{", "\\rbrace": "\\}", "\\lbrack": "[", "\\rbrack": "]",
	"\\varepsilon": "\\epsilon", "\\varphi": "\\phi", "\\vert": "|", "\\mid": "|", "\\lvert": "|", "\\rvert": "|",
	"\\ast": "*", "\\colon": ":", "\\prime": "'", "\\surd": "\\sqrt", "\\neg": "\\lnot"
};
const DROP = new Set(["\\left", "\\right", "\\big", "\\Big", "\\bigg", "\\Bigg", "\\displaystyle", "\\,", "\\;", "\\!", "\\ ", "\\quad", "\\qquad", "\\limits", "\\mathrm", "\\operatorname", "\\text", "\\mathit"]);

function tokenize(latex) {
	const out = [];
	const s = latex.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
	for (let i = 0; i < s.length;) {
		const ch = s[i];
		if (/\s/.test(ch)) { i++; continue; }
		if (ch === "\\") {
			const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
			const tok = m ? m[0] : "\\";
			i += tok.length;
			out.push(ALIASES[tok] ?? tok);
			continue;
		}
		if (s.startsWith("...", i)) { out.push("\\ldots"); i += 3; continue; }
		out.push(ch);
		i++;
	}
	return out;
}

/** Canonical token list: scripts always braced, redundant groups gone. */
function canonical(latex) {
	let toks = tokenize(latex).filter(t => !DROP.has(t));
	// Parse into a tree so braces can be normalised.
	let pos = 0;
	const parseGroup = () => {
		const items = [];
		while (pos < toks.length && toks[pos] !== "}") {
			if (toks[pos] === "{") { pos++; items.push({ group: parseGroup() }); pos++; }
			else items.push(toks[pos++]);
		}
		return items;
	};
	const tree = parseGroup();
	const ARGS = { "\\frac": 2, "\\sqrt": 1, "^": 1, "_": 1, "\\overline": 1, "\\bar": 1, "\\hat": 1, "\\vec": 1, "\\dot": 1, "\\tilde": 1, "\\mathbb": 1 };
	const emit = (items) => {
		const out = [];
		for (let i = 0; i < items.length; i++) {
			const it = items[i];
			if (typeof it === "string" && ARGS[it]) {
				out.push(it);
				for (let k = 0; k < ARGS[it]; k++) {
					let arg = items[i + 1];
					// \sqrt[n]{x}
					if (it === "\\sqrt" && arg === "[") {
						const close = items.indexOf("]", i + 1);
						out.push("[", ...emit(items.slice(i + 2, close)), "]");
						i = close;
						arg = items[i + 1];
					}
					i++;
					out.push("{", ...(arg === undefined ? [] : typeof arg === "string" ? [arg] : emit(arg.group)), "}");
				}
				continue;
			}
			if (typeof it === "string") out.push(it);
			else out.push(...emit(it.group));
		}
		return out;
	};
	const out = emit(tree);
	// x^{a}_{b} and x_{b}^{a} are the same formula.
	// f' and f^{'} are the same prime.
	return out.join(" ").replace(/\^ \{ ((?:' )+)\}/g, "$1").replace(/(\^ \{[^{}]*\}) (_ \{[^{}]*\})/g, "$2 $1").split(" ").filter(Boolean);
}

function editDistance(a, b) {
	const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) dp[0][j] = j;
	for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
		dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
	}
	return dp[a.length][b.length];
}

// ---------------------------------------------------------------------------
// Which formulas count as "what a student writes on the board".
// ---------------------------------------------------------------------------
const SUPPORTED = new Set([
	..."0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
	..."+-=()[]<>,./^_{}|!'*:",
	"\\frac", "\\sqrt", "\\int", "\\sum", "\\prod", "\\lim", "\\infty", "\\partial", "\\nabla",
	"\\alpha", "\\beta", "\\gamma", "\\delta", "\\Delta", "\\epsilon", "\\theta", "\\lambda", "\\mu", "\\pi",
	"\\rho", "\\sigma", "\\tau", "\\phi", "\\omega", "\\Omega", "\\Sigma",
	"\\times", "\\cdot", "\\pm", "\\leq", "\\geq", "\\neq", "\\approx", "\\rightarrow", "\\Rightarrow",
	"\\in", "\\ldots", "\\sin", "\\cos", "\\tan", "\\log", "\\ln", "\\exp", "\\{", "\\}"
]);

const SCHOOL = new Set([
	..."0123456789abcdefghknmprstuvwxyzABCFKLMNPRSTVXY", ..."+-=()[]^_{},.'/<>",
	"\\frac", "\\sqrt", "\\pi", "\\alpha", "\\beta", "\\theta", "\\lambda", "\\Delta", "\\infty", "\\int", "\\sum",
	"\\leq", "\\geq", "\\neq", "\\cdot", "\\times", "\\pm", "\\sin", "\\cos", "\\tan", "\\log", "\\ln", "\\lim", "\\rightarrow"
]);

function parseInk(xml) {
	const label = /type="normalizedLabel">([^<]*)</.exec(xml)?.[1] ?? /type="label">([^<]*)</.exec(xml)?.[1] ?? "";
	const human = /inkCreationMethod">human/.test(xml);
	const strokes = [...xml.matchAll(/<trace[^>]*>([^<]*)<\/trace>/g)].map(m => ({
		points: m[1].trim().split(",").map(p => {
			const [x, y] = p.trim().split(/\s+/).map(Number);
			return { x, y };
		}).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
	})).filter(s => s.points.length);
	return { label, human, strokes };
}

const files = fs.readdirSync(dir).filter(f => f.endsWith(".inkml")).sort();
const cases = [];
for (const file of files) {
	const ink = parseInk(fs.readFileSync(path.join(dir, file), "utf8"));
	if (!ink.human || !ink.label || !ink.strokes.length) continue;
	const toks = canonical(ink.label);
	if (!toks.length || toks.length > 24) continue;
	if (!toks.every(t => SUPPORTED.has(t))) continue;
	if (school && (toks.length > 18 || !toks.every(t => SCHOOL.has(t)))) continue;
	cases.push({ id: file.replace(/\.inkml$/, ""), ...ink, expected: toks });
	if (cases.length >= limit) break;
}

// Real board ink arrives in screen pixels with a stroke width; MathWriting is
// in tablet units of varying size. Scale every formula so its median stroke
// height is what a hand writes on the board (~28 px), which is the regime the
// thresholds in the recogniser were written for.
function toBoardScale(strokes) {
	const heights = strokes.map(s => {
		const ys = s.points.map(p => p.y);
		return Math.max(...ys) - Math.min(...ys);
	}).filter(h => h > 0).sort((a, b) => a - b);
	const med = heights[Math.floor(heights.length / 2)] || 1;
	const k = 28 / med;
	return strokes.map(s => ({ width: 2.5, points: s.points.map(p => ({ x: p.x * k, y: p.y * k })) }));
}

if (debugId) {
	const file = path.join(dir, `${debugId}.inkml`);
	const ink = parseInk(fs.readFileSync(file, "utf8"));
	const strokes = toBoardScale(ink.strokes);
	console.log("etiqueta:", ink.label);
	console.log("leído:   ", recognizeInkFormula(strokes).source);
	const info = inspectInkFormula(strokes);
	console.log("escala:", info.scale.toFixed(1));
	for (const g of info.glyphs) console.log(`  [${g.ids.join(",")}] ${g.value.padEnd(10)} junk ${g.junk}  ${g.top}  @${g.box.x.toFixed(0)},${g.box.y.toFixed(0)} ${g.box.w.toFixed(0)}x${g.box.h.toFixed(0)}`);
	if (renderOut) {
		const all = strokes.flatMap(s => s.points);
		const minX = Math.min(...all.map(p => p.x)) - 10, minY = Math.min(...all.map(p => p.y)) - 10;
		const paths = strokes.map((s, i) => `<path d="M${s.points.map(p => `${(p.x - minX).toFixed(1)} ${(p.y - minY).toFixed(1)}`).join("L")}" fill="none" stroke="black" stroke-width="2"/><text x="${(s.points[0].x - minX).toFixed(0)}" y="${(s.points[0].y - minY - 2).toFixed(0)}" font-size="9" fill="red">${i}</text>`).join("");
		fs.writeFileSync(renderOut, `<svg xmlns="http://www.w3.org/2000/svg" width="${(Math.max(...all.map(p => p.x)) - minX + 10).toFixed(0)}" height="${(Math.max(...all.map(p => p.y)) - minY + 10).toFixed(0)}" style="background:white">${paths}</svg>`);
	}
	process.exit(0);
}

// --perf N: N formulas side by side and in rows, read as one region, to time
// what "Leer de la pizarra" does over a whole page of notes.
if (args.includes("--perf")) {
	const n = Number(option("perf", "20"));
	const strokes = [];
	cases.slice(0, n).forEach((c, k) => {
		for (const s of toBoardScale(c.strokes)) strokes.push({ ...s, points: s.points.map(p => ({ x: p.x + (k % 4) * 700, y: p.y + Math.floor(k / 4) * 160 })) });
	});
	const t = Date.now();
	const out = recognizeInkFormula(strokes);
	console.log(`${strokes.length} trazos · ${Date.now() - t} ms · ${out.source.length} caracteres`);
	process.exit(0);
}

let exact = 0, errors = 0, total = 0;
const confusions = new Map();
const rows = [];
const started = Date.now();
for (const c of cases) {
	let got = [];
	let raw = "";
	try {
		raw = recognizeInkFormula(toBoardScale(c.strokes)).source;
		got = canonical(toRenderableLatex(raw));
	} catch (error) {
		raw = `!! ${error.message}`;
	}
	const d = editDistance(got, c.expected);
	total += c.expected.length;
	errors += Math.min(d, c.expected.length);
	if (d === 0) exact++;
	else if (got.length === c.expected.length) {
		for (let i = 0; i < got.length; i++) if (got[i] !== c.expected[i]) {
			const key = `${c.expected[i]} → ${got[i]}`;
			confusions.set(key, (confusions.get(key) ?? 0) + 1);
		}
	}
	rows.push({ id: c.id, expected: c.expected.join(" "), got: got.join(" "), raw, distance: d });
}
const ms = Date.now() - started;

const failures = rows.filter(r => r.distance > 0);
for (const r of failures.slice(0, show)) {
	console.log(`FAIL ${r.id}\n   esperado ${r.expected}\n   leído    ${r.got}   (${r.raw})`);
}
console.log(`\nFórmulas: ${cases.length}  ·  ${Math.round(ms / Math.max(1, cases.length))} ms/fórmula`);
console.log(`EXACTAS: ${exact}/${cases.length} (${(exact / Math.max(1, cases.length) * 100).toFixed(1)} %)`);
console.log(`ERROR POR TOKEN: ${(errors / Math.max(1, total) * 100).toFixed(1)} %`);
console.log(`Confusiones más frecuentes: ${[...confusions].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${k} ×${n}`).join(" · ")}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
