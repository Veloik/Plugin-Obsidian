// Builds the training set for the symbol classifier.
//
//   node dev-harness/train-ink/build-dataset.mjs <data-dir> <out-dir>
//
// <data-dir> holds the sources (none of them are in the repository):
//   uji2/ujipenchars2.txt        UJI Pen Characters v2, CC BY 4.0 (UCI id 177)
//   pendigits/tra.txt, tes.txt   Pen-Based Recognition of Handwritten Digits, CC BY 4.0 (UCI id 81), decompressed
//   handtex.db                   Hand-TeX database, ODbL 1.0 (github.com/VoxelCubes/Hand-TeX)
//   hwrt/symbols.csv, train-data.csv, test-data.csv   HWRT, ODbL 1.0 (doi.org/10.5281/zenodo.50022)
//   mwfull/mathwriting-2024/symbols/   MathWriting symbols, CC BY-NC-SA 4.0 — EVALUATION ONLY, never trained on
//
// Writes train.bin / train-labels.bin / eval.bin / eval-labels.bin / meta.json.
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { CLASSES, HANDTEX, ujiClass, mathWritingClass } from "./classes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [dataDir, outDir] = process.argv.slice(2);
if (!dataDir || !outDir) {
	console.error("uso: node build-dataset.mjs <data-dir> <out-dir>");
	process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const PER_CLASS = Number(process.env.PER_CLASS ?? 1400);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "notelens-feat-"));
await build({
	entryPoints: [path.join(here, "..", "..", "src", "ink-features.ts")], bundle: true, platform: "node",
	format: "esm", outfile: path.join(temp, "f.mjs"), logLevel: "silent"
});
const { glyphFeatures, FEATURE_SIZE, FEATURE_VERSION } = await import(pathToFileURL(path.join(temp, "f.mjs")).href);

// Deterministic randomness, so a rebuild gives the same set.
let seed = 12345;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rand(); return u - 3; };
const pick = (list) => list[Math.floor(rand() * list.length)];

// --------------------------------------------------------------------------
// Sources
// --------------------------------------------------------------------------
const base = new Map(CLASSES.map(name => [name, []]));
const add = (name, strokes, source) => {
	if (!name || !base.has(name)) return;
	const clean = strokes.map(s => s.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))).filter(s => s.length);
	if (clean.length) base.get(name).push({ strokes: clean, source });
};

// UJI: "WORD a trn_UJI_W01-01" / "NUMSTROKES n" / "POINTS k # x y x y ..."
{
	const lines = fs.readFileSync(path.join(dataDir, "uji2", "ujipenchars2.txt"), "latin1").split(/\r?\n/);
	let label = null, strokes = [];
	for (const line of lines) {
		const word = /^WORD (\S+) /.exec(line);
		if (word) {
			if (label !== null) add(ujiClass(label), strokes, "uji");
			label = word[1];
			strokes = [];
			continue;
		}
		const pts = /POINTS \d+ # (.*)$/.exec(line);
		if (pts) {
			const nums = pts[1].trim().split(/\s+/).map(Number);
			const stroke = [];
			for (let i = 0; i + 1 < nums.length; i += 2) stroke.push({ x: nums[i], y: nums[i + 1] });
			strokes.push(stroke);
		}
	}
	if (label !== null) add(ujiClass(label), strokes, "uji");
}

// Pen digits (UNIPEN format). y grows upwards on that tablet, so it is flipped.
for (const file of ["tra.txt", "tes.txt"]) {
	const lines = fs.readFileSync(path.join(dataDir, "pendigits", file), "latin1").split(/\r?\n/);
	let label = null, strokes = [], current = null;
	const flush = () => { if (label !== null && strokes.length) add(label, strokes, "pendigits"); };
	for (const line of lines) {
		const seg = /^\.SEGMENT DIGIT .*"(\d)"/.exec(line);
		if (seg) { flush(); label = seg[1]; strokes = []; current = null; continue; }
		if (line.startsWith(".PEN_DOWN")) { current = []; strokes.push(current); continue; }
		if (line.startsWith(".PEN_UP")) { current = null; continue; }
		const m = /^\s*(-?\d+)\s+(-?\d+)\s*$/.exec(line);
		if (m && current) current.push({ x: Number(m[1]), y: -Number(m[2]) });
	}
	flush();
}

// Hand-TeX
{
	const db = new DatabaseSync(path.join(dataDir, "handtex.db"), { readOnly: true });
	const query = db.prepare("select strokes from samples where key = ?");
	for (const [key, name] of Object.entries(HANDTEX)) {
		let rows = query.all(key);
		if (rows.length > PER_CLASS * 2) {
			rows = rows.map(r => [rand(), r]).sort((a, b) => a[0] - b[0]).slice(0, PER_CLASS * 2).map(r => r[1]);
		}
		for (const row of rows) {
			try {
				const strokes = JSON.parse(row.strokes).filter(s => s.length >= 1).map(s => s.map(([x, y]) => ({ x, y })));
				add(name, strokes, "handtex");
			} catch { /* malformed row */ }
		}
	}
}

// HWRT (write-math.com, M. Thoma), ODbL 1.0: many more writers for letters,
// digits and the plain signs. train-data.csv is 1.2 GB, so it is streamed.
{
	const dir = path.join(dataDir, "hwrt");
	if (fs.existsSync(path.join(dir, "train-data.csv"))) {
		const { createInterface } = await import("node:readline");
		const idToClass = new Map();
		for (const line of fs.readFileSync(path.join(dir, "symbols.csv"), "utf8").split(/\r?\n/).slice(1)) {
			const [id, latex] = line.split(";");
			const name = latex ? mathWritingClass(latex) : null;
			if (name) idToClass.set(id, name);
		}
		const taken = new Map();
		for (const file of ["train-data.csv", "test-data.csv"]) {
			const rl = createInterface({ input: fs.createReadStream(path.join(dir, file), "utf8"), crlfDelay: Infinity });
			for await (const line of rl) {
				const first = line.indexOf(";");
				const name = idToClass.get(line.slice(0, first));
				if (!name || (taken.get(name) ?? 0) >= PER_CLASS) continue;
				const start = line.indexOf("[["), end = line.lastIndexOf("]]");
				if (start < 0 || end < 0) continue;
				try {
					const strokes = JSON.parse(line.slice(start, end + 2)).map(s => s.map(p => ({ x: p.x, y: p.y })));
					add(name, strokes, "hwrt");
					taken.set(name, (taken.get(name) ?? 0) + 1);
				} catch { /* malformed row */ }
			}
		}
	}
}

// Synthetic marks for the few symbols no dataset has: they are all straight
// lines, so a line with a hand's wobble is a faithful sample.
function wobblyLine(x1, y1, x2, y2) {
	const n = 8 + Math.floor(rand() * 10);
	const bend = gauss() * 0.04;
	const out = [];
	for (let i = 0; i < n; i++) {
		const t = i / (n - 1);
		const nx = -(y2 - y1), ny = x2 - x1;
		const b = Math.sin(t * Math.PI) * bend;
		out.push({ x: x1 + (x2 - x1) * t + nx * b + gauss() * 0.006, y: y1 + (y2 - y1) * t + ny * b + gauss() * 0.006 });
	}
	return rand() < 0.5 ? out : out.reverse();
}
const j = (v = 0.06) => gauss() * v;
const SYNTH = {
	"+": () => {
		const cy = 0.5 + j(0.08), cx = 0.5 + j(0.08);
		const h = [wobblyLine(0.05 + j(), cy + j(0.04), 0.95 + j(), cy + j(0.04))];
		const v = [wobblyLine(cx + j(0.04), 0.05 + j(), cx + j(0.04), 0.95 + j())];
		return rand() < 0.5 ? [...h, ...v] : [...v, ...h];
	},
	"=": () => {
		const gap = 0.25 + rand() * 0.35, w = 0.9;
		return [wobblyLine(0, 0.5 - gap / 2 + j(0.03), w + j(0.08), 0.5 - gap / 2 + j(0.03)),
			wobblyLine(j(0.08), 0.5 + gap / 2 + j(0.03), w + j(0.08), 0.5 + gap / 2 + j(0.03))];
	},
	"/": () => { const lean = 0.25 + rand() * 0.5; return [wobblyLine(0.5 + lean / 2, 0, 0.5 - lean / 2, 1)]; },
	"[": () => {
		const w = 0.3 + rand() * 0.2;
		if (rand() < 0.5) return [[...wobblyLine(0.5 + w, 0, 0.5, 0), ...wobblyLine(0.5, 0, 0.5, 1), ...wobblyLine(0.5, 1, 0.5 + w, 1)]];
		return [wobblyLine(0.5, 0, 0.5, 1), wobblyLine(0.5, 0, 0.5 + w, 0), wobblyLine(0.5, 1, 0.5 + w, 1)];
	},
	"]": () => {
		const w = 0.3 + rand() * 0.2;
		if (rand() < 0.5) return [[...wobblyLine(0.5 - w, 0, 0.5, 0), ...wobblyLine(0.5, 0, 0.5, 1), ...wobblyLine(0.5, 1, 0.5 - w, 1)]];
		return [wobblyLine(0.5, 0, 0.5, 1), wobblyLine(0.5 - w, 0, 0.5, 0), wobblyLine(0.5 - w, 1, 0.5, 1)];
	},
	"|": () => [wobblyLine(0.5 + j(0.03), 0, 0.5 + j(0.03), 1)],
	"-": () => [wobblyLine(0, 0.5, 1, 0.5 + j(0.04))]
};
for (const [name, make] of Object.entries(SYNTH)) {
	const have = base.get(name).length;
	for (let i = have; i < 300; i++) add(name, make(), "synthetic");
}

// A sheet with a few samples of every class, to check with the eye that no
// source is upside down or mirrored before trusting a number.
if (process.env.PREVIEW) {
	const cells = [];
	for (const [name, list] of base) {
		const bySource = new Map();
		for (const s of list) if ((bySource.get(s.source)?.length ?? 0) < 3) bySource.set(s.source, [...(bySource.get(s.source) ?? []), s]);
		for (const s of [...bySource.values()].flat()) {
			const n = normalise(s.strokes);
			const d = n.map(st => "M" + st.map(p => `${(p.x * 40 + 4).toFixed(1)} ${(p.y * 40 + 4).toFixed(1)}`).join("L")).join("");
			cells.push(`<div><svg width="48" height="48"><path d="${d}" fill="none" stroke="black" stroke-width="1.5"/></svg><br>${name.replace("<", "&lt;")} ${s.source[0]}</div>`);
		}
	}
	fs.writeFileSync(process.env.PREVIEW, `<style>div{display:inline-block;width:60px;font:9px sans-serif;text-align:center}</style>${cells.join("")}`);
}

// --------------------------------------------------------------------------
// Augmentation: the same symbol by another hand.
// --------------------------------------------------------------------------
function normalise(strokes) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const s of strokes) for (const p of s) {
		minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
	}
	const size = Math.max(maxX - minX, maxY - minY, 1e-9);
	return strokes.map(s => s.map(p => ({ x: (p.x - minX) / size, y: (p.y - minY) / size })));
}
/**
 * People lift the pen at corners: the same 7 comes as one stroke or as a bar
 * and a slash. Cut a stroke at its sharpest turn now and then.
 */
function splitAtCorner(strokes) {
	const out = [];
	for (const stroke of strokes) {
		if (stroke.length < 8 || rand() > 0.35) { out.push(stroke); continue; }
		let best = -1, sharp = 0.9;
		for (let i = 3; i < stroke.length - 3; i++) {
			const a = stroke[i - 3], b = stroke[i], c = stroke[i + 3];
			const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
			const l = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
			if (l < 1e-9) continue;
			const cos = (v1x * v2x + v1y * v2y) / l;
			if (cos < sharp) { sharp = cos; best = i; }
		}
		if (best < 0) { out.push(stroke); continue; }
		out.push(stroke.slice(0, best + 1), stroke.slice(best));
	}
	return out;
}

function augment(strokes, strength = 1) {
	const n = normalise(strength >= 0.9 ? splitAtCorner(strokes) : strokes);
	const rot = gauss() * Number(process.env.ROT ?? 0.07) * strength;
	const shear = gauss() * Number(process.env.SHEAR ?? 0.14) * strength;
	const sx = Math.exp(gauss() * 0.12 * strength), sy = Math.exp(gauss() * 0.12 * strength);
	const noise = 0.004 * strength;
	const c = Math.cos(rot), s = Math.sin(rot);
	// A smooth random warp: a hand does not deform a letter uniformly, it makes
	// one loop rounder and the other flatter.
	const waves = Array.from({ length: 3 }, () => ({
		fx: 1 + rand() * 2.5, fy: 1 + rand() * 2.5, px: rand() * 6.3, py: rand() * 6.3,
		ax: gauss() * 0.035 * strength, ay: gauss() * 0.035 * strength
	}));
	const warp = (x, y) => {
		let dx = 0, dy = 0;
		for (const w of waves) {
			dx += w.ax * Math.sin(w.fy * y * Math.PI + w.px);
			dy += w.ay * Math.sin(w.fx * x * Math.PI + w.py);
		}
		return { x: x + dx, y: y + dy };
	};
	return n.map(stroke => {
		// Each pen-down lands a little off from where the previous one would have.
		const ox = gauss() * 0.025 * strength, oy = gauss() * 0.025 * strength;
		// Devices sample at different rates; drop points now and then.
		const kept = stroke.length > 6 && rand() < 0.4 ? stroke.filter((_, i) => i === 0 || i === stroke.length - 1 || rand() < 0.6) : stroke;
		return kept.map(p => {
			const w = warp(p.x, p.y);
			const x0 = (w.x - 0.5) * sx + (w.y - 0.5) * shear, y0 = (w.y - 0.5) * sy;
			return { x: x0 * c - y0 * s + gauss() * noise + ox, y: x0 * s + y0 * c + gauss() * noise + oy };
		});
	});
}

/** Two symbols (or a symbol and a piece of another) read as one: the classifier must say so. */
function junk(pool) {
	const a = normalise(pick(pool).strokes);
	const bSample = normalise(pick(pool).strokes);
	const b = rand() < 0.4 && bSample.length > 1 ? [pick(bSample)] : bSample;
	const scale = 0.5 + rand() * 0.8;
	const gap = -0.05 + rand() * 0.5;
	const dy = gauss() * 0.25;
	let maxX = 0;
	for (const s of a) for (const p of s) maxX = Math.max(maxX, p.x);
	const moved = b.map(s => s.map(p => ({ x: maxX + gap + p.x * scale, y: dy + p.y * scale })));
	return rand() < 0.5 ? [...a, ...moved] : [...moved, ...a];
}

/**
 * Pieces of a formula read as one symbol, laid out the way formulas are: a
 * glyph and the next one, an exponent, a subscript, a numerator over its bar.
 * The recogniser proposes runs of consecutive strokes, so the pieces are often
 * the end of one symbol and the start of the next.
 */
const byClass = [...base.entries()].filter(([name, list]) => name !== "junk" && list.length).map(([, list]) => list);
function boxOfStrokes(strokes) {
	let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity;
	for (const s of strokes) for (const p of s) { x = Math.min(x, p.x); y = Math.min(y, p.y); r = Math.max(r, p.x); b = Math.max(b, p.y); }
	return { x, y, r, b, w: r - x, h: b - y };
}
/** A symbol at a writing size of 1 (its height, or most of its width when it is flat). */
function asGlyph(strokes) {
	const n = normalise(strokes);
	const box = boxOfStrokes(n);
	const size = box.h > box.w * 0.35 ? box.h : box.w * 0.7;
	return n.map(s => s.map(p => ({ x: p.x / size, y: p.y / size })));
}
/**
 * Doodles that are no symbol at all, so a drawing is reported as unreadable
 * instead of being named as the least unlike letter: spirals, zigzags,
 * hearts, stars and tangles.
 */
function doodle() {
	const kind = Math.floor(rand() * 5);
	const pts = [];
	if (kind === 0) {
		const turns = 1.6 + rand() * 2, n = 60 + Math.floor(rand() * 60), dir = rand() < 0.5 ? 1 : -1;
		for (let i = 0; i < n; i++) { const t = i / n * turns * Math.PI * 2; const r = 0.05 + i / n * 0.5; pts.push({ x: 0.5 + Math.cos(t * dir) * r, y: 0.5 + Math.sin(t * dir) * r }); }
	} else if (kind === 1) {
		const teeth = 6 + Math.floor(rand() * 5), amp = 0.15 + rand() * 0.35;
		for (let i = 0; i <= teeth; i++) pts.push({ x: i / teeth, y: 0.5 + (i % 2 ? amp : -amp) });
	} else if (kind === 2) {
		for (let i = 0; i <= 60; i++) {
			const t = i / 60 * Math.PI * 2;
			pts.push({ x: 0.5 + 0.4 * Math.pow(Math.sin(t), 3), y: 0.45 - (0.32 * Math.cos(t) - 0.13 * Math.cos(2 * t) - 0.05 * Math.cos(3 * t) - 0.02 * Math.cos(4 * t)) });
		}
	} else if (kind === 3) {
		for (let i = 0; i <= 5; i++) { const t = i * 4 * Math.PI / 5 - Math.PI / 2; pts.push({ x: 0.5 + Math.cos(t) * 0.45, y: 0.5 + Math.sin(t) * 0.45 }); }
	} else {
		let x = 0.5, y = 0.5, a = rand() * 6.3;
		for (let i = 0; i < 90; i++) { a += gauss() * 0.9; x = Math.min(1, Math.max(0, x + Math.cos(a) * 0.06)); y = Math.min(1, Math.max(0, y + Math.sin(a) * 0.06)); pts.push({ x, y }); }
	}
	return [pts.map(p => ({ x: p.x + gauss() * 0.01, y: p.y + gauss() * 0.01 }))];
}

function layoutJunk() {
	const pieces = rand() < 0.55 ? 2 : rand() < 0.75 ? 3 : 4;
	const out = [];
	let prev = null;
	for (let k = 0; k < pieces; k++) {
		let glyph = asGlyph(pick(pick(byClass)).strokes);
		// Half of a neighbour: its first strokes after the previous glyph, or
		// its last strokes before the next one.
		if (glyph.length > 1 && rand() < 0.35) {
			const cut = 1 + Math.floor(rand() * (glyph.length - 1));
			glyph = k === 0 ? glyph.slice(cut) : glyph.slice(0, cut);
		}
		const box = boxOfStrokes(glyph);
		let size = 0.8 + rand() * 0.4, x = 0, y = 0;
		if (prev) {
			const r = rand();
			if (r < 0.55) { x = prev.r + (-0.05 + rand() * 0.45); y = prev.b - box.h * size + gauss() * 0.1; }
			else if (r < 0.72) { size = 0.45 + rand() * 0.3; x = prev.r - 0.05 + rand() * 0.2; y = prev.y - box.h * size * (0.4 + rand() * 0.5); }
			else if (r < 0.89) { size = 0.45 + rand() * 0.3; x = prev.r - 0.05 + rand() * 0.2; y = prev.b - box.h * size * (0.1 + rand() * 0.5); }
			else { x = prev.x + gauss() * 0.3; y = rand() < 0.5 ? prev.b + 0.2 + rand() * 0.3 : prev.y - 0.2 - rand() * 0.3 - box.h * size; }
		}
		const placed = glyph.map(s => s.map(p => ({ x: x + (p.x - box.x) * size, y: y + (p.y - box.y) * size })));
		out.push(...placed);
		prev = boxOfStrokes(placed);
	}
	// A fraction bar written across what is already there.
	if (rand() < 0.12) {
		const all = boxOfStrokes(out);
		const yBar = rand() < 0.5 ? all.b + 0.15 : all.y - 0.15;
		out.push(wobblyLine(all.x - 0.1, yBar, all.r + 0.1, yBar));
	}
	return out;
}

// --------------------------------------------------------------------------
// Assemble
// --------------------------------------------------------------------------
const counts = [];
const train = [];
const labels = [];
const pool = [...base.entries()].filter(([name]) => name !== "junk").flatMap(([, list]) => list);
for (const [index, name] of CLASSES.entries()) {
	const list = base.get(name);
	if (name === "junk") {
		const many = PER_CLASS * 5;
		for (let i = 0; i < many; i++) {
			const r = rand();
			train.push(glyphFeatures(augment(r < 0.1 ? doodle() : r < 0.3 ? junk(pool) : layoutJunk(), 0.5)));
			labels.push(index);
		}
		counts.push([name, many, "generated"]);
		continue;
	}
	if (!list.length) { console.warn("sin muestras:", name); counts.push([name, 0]); continue; }
	const shuffled = list.map(s => [rand(), s]).sort((a, b) => a[0] - b[0]).map(p => p[1]);
	for (let i = 0; i < PER_CLASS; i++) {
		const sample = shuffled[i % shuffled.length];
		const strokes = i < shuffled.length ? augment(sample.strokes, 0.4) : augment(sample.strokes, 1);
		train.push(glyphFeatures(strokes));
		labels.push(index);
	}
	const sources = {};
	for (const s of list) sources[s.source] = (sources[s.source] ?? 0) + 1;
	counts.push([name, list.length, JSON.stringify(sources)]);
}

const writeSet = (prefix, rows, labelList) => {
	const flat = new Float32Array(rows.length * FEATURE_SIZE);
	rows.forEach((row, i) => flat.set(row, i * FEATURE_SIZE));
	fs.writeFileSync(path.join(outDir, `${prefix}.bin`), Buffer.from(flat.buffer));
	fs.writeFileSync(path.join(outDir, `${prefix}-labels.bin`), Buffer.from(new Uint16Array(labelList).buffer));
};
writeSet("train", train, labels);

// MathWriting symbols: someone else's hands entirely. Only measured.
const evalRows = [], evalLabels = [];
const mwDir = path.join(dataDir, "mwfull", "mathwriting-2024", "symbols");
if (fs.existsSync(mwDir)) {
	for (const file of fs.readdirSync(mwDir)) {
		const xml = fs.readFileSync(path.join(mwDir, file), "utf8");
		const label = /type="label">([^<]*)</.exec(xml)?.[1]?.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
		const name = label ? mathWritingClass(label) : null;
		if (!name) continue;
		const strokes = [...xml.matchAll(/<trace[^>]*>([^<]*)<\/trace>/g)].map(m => m[1].trim().split(",").map(p => {
			const [x, y] = p.trim().split(/\s+/).map(Number);
			return { x, y };
		}));
		evalRows.push(glyphFeatures(strokes));
		evalLabels.push(CLASSES.indexOf(name));
	}
}
writeSet("eval", evalRows, evalLabels);
fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify({ classes: CLASSES, featureSize: FEATURE_SIZE, featureVersion: FEATURE_VERSION, train: train.length, eval: evalRows.length }, null, 1));
for (const [name, n, src] of counts) console.log(name.padEnd(18), String(n).padStart(6), src ?? "");
console.log(`\ntrain ${train.length} · eval ${evalRows.length} · rasgos ${FEATURE_SIZE}`);
fs.rmSync(temp, { recursive: true, force: true });
