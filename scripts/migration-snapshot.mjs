/**
 * Characterization harness for migrateDocument.
 *
 * It bundles src/types.ts, runs a battery of legacy and malformed documents
 * through the migration, and compares the result against the recorded snapshot
 * in tests/migration-snapshot.json. Generated ids carry a timestamp and a
 * counter, so they are replaced by a stable marker first.
 *
 * A migration is the code that reads boards people already saved, so any change
 * in what it produces should be a decision, not a surprise.
 *
 *   node scripts/migration-snapshot.mjs            checks against the snapshot
 *   node scripts/migration-snapshot.mjs --update   records the current output
 */
import { build } from "esbuild";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const obsidianStub = {
	name: "obsidian-stub",
	setup(b) {
		b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "obsidian-stub" }));
		b.onLoad({ filter: /.*/, namespace: "obsidian-stub" }, () => ({
			contents: 'export function getLanguage() { return "es"; }', loader: "js"
		}));
	}
};

const dir = mkdtempSync(path.join(tmpdir(), "notelens-migration-"));
const out = path.join(dir, "types.mjs");
let migrateDocument;
try {
	await build({
		entryPoints: ["src/types.ts"], bundle: true, platform: "node", format: "esm",
		target: "node20", outfile: out, logLevel: "silent", plugins: [obsidianStub]
	});
	({ migrateDocument } = await import(pathToFileURL(out).href));
} finally {
	// The module is already loaded; the temp copy is not needed any more.
	setTimeout(() => rmSync(dir, { recursive: true, force: true }), 0);
}

const GENERATED = /^(page|stroke|shape|badge|badge_image|task_item|text|table|bookmark|embed)_[0-9a-z]+_[0-9a-z]+$/;
const seen = new Map();
function normalize(value) {
	if (Array.isArray(value)) return value.map(normalize);
	if (value && typeof value === "object") {
		const out = {};
		for (const k of Object.keys(value).sort()) out[k] = normalize(value[k]);
		return out;
	}
	if (typeof value === "string" && GENERATED.test(value)) {
		if (!seen.has(value)) seen.set(value, `<generated:${value.split("_").slice(0, -2).join("_")}:${seen.size}>`);
		return seen.get(value);
	}
	return value;
}

const IMG = "data:image/png;base64,AAAA";

const cases = {
	"not an object": [null, undefined, 42, "board", true, []],
	"empty object": [{}],
	"legacy flat v1 with margin paper": [{
		version: 1, background: "margin", marginEnabled: false, gridSize: "large",
		backgroundColor: "#101014", lineColor: "#334155", a4Guides: true,
		viewTransform: { x: 12, y: -8, scale: 12 },
		strokes: [
			{ id: "s1", points: [{ x: 1, y: 2, p: 0.9 }, { x: 3, y: 4 }], type: "highlighter", color: "#ff0000", width: 9, style: "brush" },
			{ points: [] },
			{ points: [{ x: "no", y: 2 }, { x: 5, y: 6 }] },
			{ points: [{ x: 1, y: 1 }], type: "nope", color: 7, width: "wide", style: "crayon" }
		],
		shapes: [
			{ id: "sh1", kind: "rectangle", x: 1, y: 2, w: 80, h: 40, color: "#ffffff", width: 3, fill: "#ff0000", fillOpacity: 0.35, rotation: 45 },
			{ kind: "rectangle", x: 1, y: 2, w: 80, h: 40, width: 900, fillOpacity: 8, fill: "red" },
			{ kind: "spiral", x: 1, y: 2, w: 3, h: 4 },
			{ kind: "line", x: 1, y: 2, w: 3 }
		],
		texts: [
			{ id: "t1", x: 10, y: 20, text: "Apunte", fontSize: 20, color: "#ffffff", bold: true, align: "center", w: 40, h: 4000, variant: "code", language: "js", fontFamily: "mono", runs: [{ text: "a", bold: true }] },
			{ x: 0, y: 0 },
			{ x: 0 }
		],
		badges: [
			{
				id: "b1", x: 5, y: 6, scale: 9, tagId: "tag_idea", label: "Idea", title: "  Titulo  ", tooltip: "t", sketch: IMG,
				checklist: [{ id: "c1", text: " hazlo ", done: true }, { sketch: IMG, done: false }, { text: "", sketch: "nope" }],
				images: [{ id: "i1", src: IMG, name: "n", x: 9999, y: -5, w: 5, h: 9999 }, { src: "nope" }]
			},
			{ x: 1, y: 1, done: true },
			{ x: 1 }
		],
		tables: [
			{ id: "tb1", x: 1, y: 2, rows: 2, cols: 2, cells: [["a", "b"], ["c"]], header: true, title: " T ", colWidths: [1, 2], rowHeights: [3] },
			{ x: 1, y: 2, rows: 900, cols: -4, w: 1, h: 99999 }
		],
		bookmarks: [{ id: "bk1", x: 1, y: 2, label: "Cap", scale: 90 }, { x: 1, y: 2 }, { y: 2 }],
		embeds: [
			{ id: "e1", x: 1, y: 2, src: "a.pdf", kind: "pdf", page: 3, pages: 9, pdfMode: "pages", w: 10, h: 20, rotation: 5 },
			{ x: 1, y: 2, src: "https://youtu.be/x", kind: "youtube" },
			{ x: 1, y: 2, src: "c", kind: "chart", chart: { data: "1,2", type: "pie", extra: 1 } },
			{ x: 1, y: 2, src: "d", kind: "chart", chart: { data: 5 } },
			{ x: 1, y: 2, src: "e", kind: "unknown", provider: "vimeo", captionSrc: "s.vtt" },
			{ x: 1, y: 2 }
		]
	}],
	"multi-page": [{
		version: 9,
		pages: [
			{ id: "p1", title: "  Uno  ", background: "margin", gridSize: "small", backgroundColor: "#000000", lineColor: "#ffffff", a4Guides: true, viewTransform: { x: 1, y: 2, scale: 99 } },
			{ title: 5, background: "dots", marginEnabled: true },
			{ id: "p3", background: "nope", gridSize: "huge", backgroundColor: "red" },
			null,
			"nope"
		],
		activePageId: "p3",
		strokes: [{ points: [{ x: 1, y: 1 }], pageId: "p1" }, { points: [{ x: 1, y: 1 }], pageId: "ghost" }],
		marginEnabled: false
	}],
	"active page id that does not exist": [{ pages: [{ id: "p1" }], activePageId: "gone" }],
	"corrupt shapes that still parse": [{
		tables: [{ x: 1, y: 2, rows: 1, cols: 2, cells: "abc" }, { x: 1, y: 2, rows: 1, cols: 1, cells: [{ 0: "z" }] }],
		badges: [{ x: 1, y: 1, tagId: { a: 1 }, label: 5, checklist: ["str", 7, null] }],
		strokes: ["str", 7, { points: "abc" }],
		texts: [{ x: 1, y: 1, text: { a: 1 }, runs: "no" }],
		embeds: [{ x: 1, y: 1, src: "a", kind: "chart", chart: "no" }]
	}],
	"an array at the root": [[1, 2, 3]],
	"wrong types everywhere": [{
		pages: "no", strokes: {}, shapes: 5, texts: null, badges: "x", tables: 0,
		bookmarks: false, embeds: "", viewTransform: { x: "1", y: 2, scale: 3 },
		background: 7, backgroundColor: "#12345", lineColor: "nope", gridSize: "tiny",
		marginEnabled: "yes", a4Guides: "yes", activePageId: 9
	}]
};

const snapshot = {};
for (const [name, inputs] of Object.entries(cases)) {
	snapshot[name] = inputs.map(input => normalize(migrateDocument(input)));
}
const rendered = `${JSON.stringify(snapshot, null, 2)}\n`;
const expectedFile = "tests/migration-snapshot.json";

if (process.argv.includes("--update")) {
	writeFileSync(expectedFile, rendered);
	console.log(`Recorded ${expectedFile}.`);
} else if (!existsSync(expectedFile)) {
	console.error(`${expectedFile} is missing. Run with --update to record it.`);
	process.exitCode = 1;
} else if (readFileSync(expectedFile, "utf8") !== rendered) {
	console.error("Document migration changed. Compare the two and, if the change is wanted, re-record with --update:");
	const expected = readFileSync(expectedFile, "utf8").split("\n");
	const actual = rendered.split("\n");
	for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
		if (expected[i] !== actual[i]) console.error(`  line ${i + 1}\n    was: ${expected[i] ?? "(end)"}\n    now: ${actual[i] ?? "(end)"}`);
	}
	process.exitCode = 1;
} else {
	console.log("Document migration matches the recorded snapshot.");
}
