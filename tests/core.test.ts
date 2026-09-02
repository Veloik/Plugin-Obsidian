import assert from "node:assert/strict";
import test from "node:test";
import { toRenderableLatex } from "../src/asciimath";
import { recognizeInkFormula } from "../src/ink-math";
import { runLocalStudyTool } from "../src/local-intelligence";
import { createEmptyDocument, migrateDocument } from "../src/types";
import { hexToRgba, setColorAlpha, toRemoteVideoEmbed } from "../src/tools";
import { setLocale, tr } from "../src/i18n";
import { en } from "../src/locales/en";

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
