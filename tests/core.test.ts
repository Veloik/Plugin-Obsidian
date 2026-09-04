import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { toRenderableLatex } from "../src/asciimath";
import { recognizeInkFormula } from "../src/ink-math";
import { runLocalStudyTool } from "../src/local-intelligence";
import { createEmptyDocument, migrateDocument } from "../src/types";
import { hexToRgba, setColorAlpha, toRemoteVideoEmbed } from "../src/tools";
import { setLocale, tr } from "../src/i18n";
import { mergeRuns, notePreview, parseInline, planListToggle, runsFromInline, runsToMarked, stripInlineMarks } from "../src/rich-text";
import { en } from "../src/locales/en";
import { PersistenceManager } from "../src/persistence";
import { CanvasRenderer } from "../src/renderer";
import { unpackShareArchive } from "../src/share-archive";
import { zipSync, strToU8, strFromU8 } from "fflate";

test("share archives stop at the expanded memory limit before importing files", () => {
	const bytes = zipSync({ "notelens.json": strToU8('{"document":{}}'), "assets/data": new Uint8Array(1000) });
	assert.equal(strFromU8(unpackShareArchive(bytes)["notelens.json"]), '{"document":{}}');
	assert.throws(() => unpackShareArchive(bytes, 100), /memoria/);
});

test("mobile share URLs keep playable IDs, timestamps and private Vimeo hashes", () => {
	assert.match(toRemoteVideoEmbed("Mira esto https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")!.embedUrl, /start=90/);
	const embedded = toRemoteVideoEmbed("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=12")!;
	assert.match(embedded.originalUrl, /watch\?v=dQw4w9WgXcQ/);
	assert.match(embedded.embedUrl, /start=12/);
	assert.match(toRemoteVideoEmbed("https://vimeo.com/123456789/abcdef0123")!.embedUrl, /\?h=abcdef0123$/);
	assert.match(toRemoteVideoEmbed("https://player.vimeo.com/video/123456789?h=abcdef0123")!.embedUrl, /\?h=abcdef0123$/);
	for (const url of ["https://vm.tiktok.com/ABC123/", "https://vt.tiktok.com/ABC123/", "https://www.instagram.com/share/reel/ABC123/"]) {
		const result = toRemoteVideoEmbed(url)!;
		assert.ok(result);
		assert.equal(result.embedUrl, "", "unresolved share links must not pretend to be players");
		assert.equal(result.originalUrl, url);
	}
});

test("video providers reject lookalike hosts, credentials and unsafe schemes", () => {
	for (const url of ["https://evilyoutube.com/watch?v=dQw4w9WgXcQ", "https://eviltiktok.com/@u/video/123456789", "ftp://youtube.com/watch?v=dQw4w9WgXcQ", "https://user:password@youtube.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://example.com/?url=https://youtu.be/dQw4w9WgXcQ"]) {
		assert.equal(toRemoteVideoEmbed(url), null, url);
	}
});

test("canvas resize keeps the bitmap for unchanged or transient zero dimensions and caps high DPR", () => {
	const previous = globalThis.window;
	(globalThis as any).window = { devicePixelRatio: 4 };
	let resets = 0, width = 1, height = 1;
	const canvas = { style: {}, getContext: () => ({}) } as any;
	Object.defineProperties(canvas, {
		width: { get: () => width, set: v => { width = v; resets++; } },
		height: { get: () => height, set: v => { height = v; resets++; } }
	});
	try {
		const renderer = new CanvasRenderer({ createEl: () => canvas } as any);
		renderer.resize(820, 1180);
		assert.ok(width <= 4096 && height <= 4096 && width * height <= 8_000_000);
		const before = resets;
		renderer.resize(820, 1180);
		renderer.resize(0, 0);
		renderer.resize(Number.NaN, 1180);
		assert.equal(resets, before);
		renderer.resize(820, 500);
		assert.ok(resets > before);
	} finally { (globalThis as any).window = previous; }
});

test("failed saves remain pending, retry on flush, and cached history never crosses files", async () => {
	const previous = globalThis.window;
	(globalThis as any).window = globalThis;
	let fail = true, errors = 0;
	const written: string[] = [];
	const app = { vault: { modify: async (_file: unknown, text: string) => {
		if (fail) throw new Error("disk full");
		written.push(text);
	} } };
	const manager = new PersistenceManager(app as any, () => ({ path: "a.notelens" }) as any, () => errors++);
	const doc = createEmptyDocument();
	try {
		manager.scheduleSave(doc);
		assert.equal(await manager.flush(doc), false);
		assert.equal(errors, 1);
		assert.equal(manager.currentPayload(), null);
		fail = false;
		assert.equal(await manager.flush(doc), true);
		assert.equal(written.length, 1);
		assert.equal(manager.currentPayload(), JSON.stringify(doc));
		manager.reset();
		assert.equal(manager.currentPayload(), null);
	} finally { manager.reset(); (globalThis as any).window = previous; }
});

test("document migration keeps editable content and normalizes legacy paper", () => {
	const migrated = migrateDocument({
		version: 1,
		background: "margin",
		marginEnabled: false,
		viewTransform: { x: 12, y: -8, scale: 12 },
		shapes: [{ id: "shape", kind: "rectangle", x: 1, y: 2, w: 80, h: 40, color: "#ffffff", width: 3, fill: "#ff0000", fillOpacity: 0.35 }],
		texts: [{ id: "text", x: 10, y: 20, text: "Apunte", fontSize: 20, color: "#ffffff" }]
	});
	assert.equal(migrated.version, 10);
	assert.equal(migrated.background, "lines");
	assert.equal(migrated.marginEnabled, true);
	assert.equal(migrated.viewTransform.scale, 4);
	assert.equal(migrated.shapes[0]?.fillOpacity, 0.35);
	assert.equal(migrated.texts[0]?.text, "Apunte");
	assert.equal(createEmptyDocument().pages.length, 1);
});

test("remote video links are normalized to safe provider embeds", () => {
	const cases: Array<[string, string]> = [
		["https://youtu.be/dQw4w9WgXcQ", "youtube"],
		["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube"],
		["https://www.tiktok.com/@user/video/7123456789012345678", "tiktok"],
		["https://www.instagram.com/reel/ABC_def12/", "instagram"],
		["https://x.com/user/status/1234567890123456789", "x"],
		["https://vimeo.com/123456789", "vimeo"]
	];
	for (const [url, provider] of cases) {
		const embed = toRemoteVideoEmbed(url);
		assert.equal(embed?.provider, provider);
		assert.match(embed?.embedUrl ?? "", /^https:\/\//);
	}
	assert.equal(toRemoteVideoEmbed("https://example.com/video/123"), null);
});

test("inline marks style a fragment and survive a round trip", () => {
	const runs = parseInline("normal **negrita** y ==resaltado==");
	assert.deepEqual(runs.map(r => r.text), ["normal ", "negrita", " y ", "resaltado"]);
	assert.equal(runs[1]?.bold, true);
	assert.equal(runs[3]?.mark, true);
	// Marks nest, and an orphan marker is text, not formatting.
	const nested = parseInline("**==clave==**");
	assert.equal(nested.length, 1);
	assert.equal(nested[0]?.bold && nested[0]?.mark, true);
	assert.deepEqual(parseInline("2 * 3 * 4").map(r => r.text), ["2 * 3 * 4"]);
	assert.equal(stripInlineMarks("__hola__ `x` ~~no~~"), "hola x no");
});

test("a box written with marks opens as runs and is stored as marks again", () => {
	const runs = runsFromInline("La __entropia__ mide el **desorden**", "#fde68a");
	assert.deepEqual(runs.map(r => r.text), ["La ", "entropia", " mide el ", "desorden"]);
	assert.equal(runs[1]?.underline, true);
	assert.equal(runs[3]?.bold, true);
	assert.equal(runsToMarked(runs), "La __entropia__ mide el **desorden**");
	// A highlighted fragment keeps its own tint, which marks alone cannot say.
	assert.equal(runsFromInline("==clave==", "#bfdbfe")[0]?.mark, "#bfdbfe");
	// Blanks stay outside the marks, and neighbours that look alike become one run.
	assert.equal(runsToMarked([{ text: "hola ", bold: true }]), "**hola** ");
	assert.deepEqual(mergeRuns([{ text: "a", bold: true }, { text: "b", bold: true }, { text: "" }]), [{ text: "ab", bold: true }]);
});

test("a list prefix goes in and out line by line, keeping what is around it", () => {
	const text = "Primero\nSegundo\nTercero";
	// Nothing selected works on the whole box, and the numbers are counted as they go in.
	const put = planListToggle(text, 0, 0, "number");
	assert.deepEqual(put.map(e => e.text), ["1. ", "2. ", "3. "]);
	assert.deepEqual(put.map(e => e.from), [0, 8, 16]);
	// The same call on a bulleted box takes the bullets off instead.
	const bulleted = "• Primero\n• Segundo";
	const removed = planListToggle(bulleted, 0, 0, "bullet");
	assert.deepEqual(removed.map(e => [e.from, e.to, e.text]), [[0, 2, ""], [10, 12, ""]]);
	// A selection only covers the lines it touches, and blank lines are left alone.
	assert.equal(planListToggle("Uno\n\nDos", 0, 3, "dash").length, 1);
});

test("the preview of a note shows its words, not its machinery", () => {
	const note = [
		"---", "tags: [clase]", "---",
		"```js", "const suma = (a, b) => a + b;", "```",
		"<div class=\"callout\">",
		"# La entropía",
		"Mide el **desorden** de un sistema.",
		"- Repasar [[Induccion|la induccion]] y ![[diagrama.png]]",
		"| a | b |", "| --- | --- |"
	].join("\n");
	assert.equal(notePreview(note), "La entropía\nMide el desorden de un sistema.\nRepasar la induccion y");
	assert.equal(notePreview("uno\ndos\ntres", 2), "uno\ndos");
});

test("color alpha helpers preserve the selected transparency", () => {
	assert.equal(hexToRgba("#336699", 0.4), "rgba(51, 102, 153, 0.4)");
	assert.equal(setColorAlpha("rgb(1, 2, 3)", 0.25), "rgba(1, 2, 3, 0.25)");
	assert.equal(setColorAlpha("rgba(1, 2, 3, 0.9)", 0), "rgba(1, 2, 3, 0)");
});

test("local study actions and easy math work without a model", () => {
	const notes = "La fotosíntesis convierte energía luminosa en energía química. La clorofila absorbe la luz. Tarea: repasar la fase luminosa.";
	const summary = runLocalStudyTool("summary", notes);
	const tasks = runLocalStudyTool("tasks", notes);
	assert.ok(summary.content.includes("fotosíntesis"));
	assert.ok(tasks.content.includes("[ ]"));
	const latex = toRenderableLatex("x^2/2 + sqrt(x)");
	assert.match(latex, /\\frac|\\sqrt/);
});

test("vector ink recognizes a plus sign", () => {
	const line = (x1: number, y1: number, x2: number, y2: number) => ({
		points: Array.from({ length: 9 }, (_, index) => ({
			x: x1 + (x2 - x1) * index / 8,
			y: y1 + (y2 - y1) * index / 8
		}))
	});
	const result = recognizeInkFormula([line(10, 25, 50, 25), line(30, 5, 30, 45)]);
	assert.equal(result.source, "+");
	assert.ok(result.confidence > 0.5);
});

test("the English catalogue keeps every placeholder its message needs", () => {
	const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
	const broken: string[] = [];
	for (const [spanish, english] of Object.entries(en)) {
		if (!english.trim()) broken.push(`vacío: ${spanish}`);
		const wanted = placeholders(spanish).join(",");
		const got = placeholders(english).join(",");
		// A translation that drops {p0} silently prints a message with a hole in it.
		if (wanted !== got) broken.push(`${spanish} → ${english} (${wanted} ≠ ${got})`);
	}
	assert.deepEqual(broken, []);
	assert.ok(Object.keys(en).length > 400, "the catalogue should cover the interface");
});

test("the quick tags say nothing in Spanish to an English reader", () => {
	setLocale("en");
	// Everything the five tags print: their names, the wording of a task's steps
	// and the empty states of the summary pane.
	for (const spanish of [
		"Importante", "Duda", "Idea clave", "Tarea", "Nota flotante",
		"Nueva etiqueta: {p0}", "Editar etiqueta: {p0}", "Buscar etiquetas…",
		"Paso", "Paso a mano", "paso a mano", "Paso escrito a mano", "Marcar paso {p0}",
		"hecho", "pendiente", "Duda pendiente", "Duda resuelta", "Tarea hecha",
		"Junto a: «{p0}»", "{p0} · Siguiente: {p1}", "No hay tareas ni dudas pendientes.",
		"Nada que mostrar con estos filtros.",
		"Explica por qué marcaste esto. Aparece al pasar el cursor por la etiqueta.",
		"Añade el contexto de esta etiqueta. También puedes dibujar o adjuntar imágenes desde Pizarra."
	]) {
		assert.notEqual(tr(spanish), spanish, `sin traducir: ${spanish}`);
	}
	// The tag files must not ask for a message the catalogue cannot answer;
	// a key made only of placeholders and punctuation reads the same either way.
	const untranslated: string[] = [];
	let checked = 0;
	for (const file of ["src/view.ts", "src/hover-note.ts", "src/ui.ts", "src/pdf-export.ts"]) {
		const source = fs.readFileSync(file, "utf8");
		for (const match of source.matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)) {
			const key = JSON.parse(`"${match[1]}"`) as string;
			if (!/\p{L}/u.test(key.replace(/\{\w+\}/g, ""))) continue;
			checked++;
			if (!(key in en)) untranslated.push(`${file}: ${key}`);
		}
	}
	assert.deepEqual(untranslated, []);
	// A scan that stops matching would pass silently; these files ask for hundreds.
	assert.ok(checked > 300, `only ${checked} messages scanned`);
	setLocale("es");
});

test("translation falls back to Spanish and fills placeholders", () => {
	setLocale("es");
	assert.equal(tr("Insertar tabla"), "Insertar tabla");
	assert.equal(tr("Paso {p0}", { p0: 3 }), "Paso 3");
	setLocale("en");
	assert.equal(tr("Insertar tabla"), "Insert table");
	assert.equal(tr("Paso {p0}", { p0: 3 }), "Step 3");
	// A message the catalogue does not carry must read as Spanish, never as a key.
	assert.equal(tr("Mensaje que no existe en el catálogo"), "Mensaje que no existe en el catálogo");
	setLocale("es");
});

test("a radical owns what is written under it", () => {
	const poly = (pts: [number, number][], steps = 6) => {
		const points: { x: number; y: number }[] = [];
		for (let i = 0; i < pts.length - 1; i++) {
			const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
			for (let s = 0; s <= steps; s++) points.push({ x: x1 + (x2 - x1) * s / steps, y: y1 + (y2 - y1) * s / steps });
		}
		return { points };
	};
	const line = (x1: number, y1: number, x2: number, y2: number) => poly([[x1, y1], [x2, y2]], 8);
	const radical = poly([[10, 30], [17, 48], [26, 6], [78, 6]]);

	// A plus sign under the vinculum: hard geometry reads both without a canvas.
	const inside = recognizeInkFormula([radical, line(36, 26, 60, 26), line(48, 14, 48, 38)]);
	assert.equal(inside.source, "\\sqrt{+}");
	assert.ok(inside.confidence > 0.5);

	// On its own it stays a symbol: an empty root would be worse.
	assert.equal(recognizeInkFormula([radical]).source, "sqrt");
});

test("two marks on the same line are not one glyph", () => {
	const line = (x1: number, y1: number, x2: number, y2: number) => ({
		points: Array.from({ length: 9 }, (_, index) => ({
			x: x1 + (x2 - x1) * index / 8,
			y: y1 + (y2 - y1) * index / 8
		}))
	});
	// Collinear segments make every cross product zero, so the classic sign test
	// called them crossing however far apart they were, merging the limits of an
	// integral into a single glyph.
	const apart = recognizeInkFormula([line(44, -14, 44, -2), line(44, 56, 44, 70)]);
	assert.equal(apart.tokens.length, 2);
});

/** A smooth line through control points, the way the bench draws its corpus. */
function penPath(controls: [number, number][], perSegment = 6): { x: number; y: number }[] {
	if (controls.length < 3) {
		return controls.flatMap(([x, y], index) => index === controls.length - 1 ? [{ x, y }] :
			Array.from({ length: 8 }, (_, s) => ({
				x: x + (controls[index + 1][0] - x) * s / 8,
				y: y + (controls[index + 1][1] - y) * s / 8
			})));
	}
	const pts = [controls[0], ...controls, controls[controls.length - 1]];
	const out: { x: number; y: number }[] = [];
	for (let i = 1; i < pts.length - 2; i++) {
		const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
		for (let s = 0; s < perSegment; s++) {
			const t = s / perSegment, t2 = t * t, t3 = t2 * t;
			out.push({
				x: 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
				y: 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
			});
		}
	}
	out.push({ x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] });
	return out;
}

test("vector ink reads ordinary handwriting, not printed shapes", () => {
	// Comparing ink with font glyphs read every round shape as "b"; these are
	// the symbols that failed then, drawn the way a hand draws them.
	const cases: [string, [number, number][][]][] = [
		["3", [[[16, 10], [38, 4], [52, 16], [38, 30], [28, 32], [42, 34], [56, 48], [40, 64], [16, 60]]]],
		["5", [[[52, 8], [20, 8]], [[20, 8], [18, 32]], [[18, 32], [40, 28], [54, 42], [42, 62], [18, 58]]]],
		["9", [[[48, 20], [36, 8], [24, 18], [32, 32], [46, 28], [48, 16], [46, 40], [38, 64]]]],
		["c", [[[48, 30], [34, 24], [22, 34], [22, 50], [34, 62], [48, 56]]]],
		["7", [[[12, 8], [56, 8]], [[56, 8], [26, 64]]]]
	];
	for (const [expected, strokes] of cases) {
		const result = recognizeInkFormula(strokes.map(points => ({ points: penPath(points) })));
		assert.equal(result.source, expected, `handwritten ${expected} read as ${result.source}`);
	}
});

test("a six is not an integral, and a bracket is not a two", () => {
	// Both were claimed by geometry rules that were too eager: an integral
	// descends the whole way and a two lands on a base.
	const six = recognizeInkFormula([{ points: penPath([[48, 6], [30, 20], [22, 38], [24, 54], [38, 62], [50, 52], [44, 38], [28, 38], [22, 46]]) }]);
	assert.equal(six.source, "6");
	const bracket = recognizeInkFormula([{ points: penPath([[42, 8], [28, 24], [26, 40], [40, 62]]) }]);
	assert.equal(bracket.source, "(");
});

test("strokes that meet at a corner are one symbol", () => {
	// A seven came out as "-" then "/", and a flagged one as "x", because any
	// touch counted as a crossing and no touch counted as a join.
	const seven = recognizeInkFormula([
		{ points: penPath([[12, 8], [56, 8]]) },
		{ points: penPath([[56, 8], [26, 64]]) }
	]);
	assert.equal(seven.source, "7");
	const one = recognizeInkFormula([
		{ points: penPath([[18, 16], [32, 6]]) },
		{ points: penPath([[32, 6], [32, 64]]) }
	]);
	assert.equal(one.source, "1");
	const tee = recognizeInkFormula([
		{ points: penPath([[32, 6], [32, 62]]) },
		{ points: penPath([[16, 24], [48, 24]]) }
	]);
	assert.equal(tee.source, "t");
});
