import assert from "node:assert/strict";
import test from "node:test";
import { toRenderableLatex } from "../src/asciimath";
import { recognizeInkFormula } from "../src/ink-math";
import { runLocalStudyTool } from "../src/local-intelligence";
import { createEmptyDocument, migrateDocument } from "../src/types";
import { hexToRgba, setColorAlpha, toRemoteVideoEmbed } from "../src/tools";

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
