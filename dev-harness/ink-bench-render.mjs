// Draws the bench corpus so a failure can be blamed on the right side: a
// recogniser that cannot read the symbol, or a test that draws it wrong.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { CASES } from "./ink-corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "shots-ink");
fs.mkdirSync(out, { recursive: true });

const COLS = 8;
const CELL = 150;
const rows = Math.ceil(CASES.length / COLS);

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	defaultViewport: { width: COLS * CELL, height: rows * CELL, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
await page.setContent(`<html><body style="margin:0;background:#fff"><canvas id="c" width="${COLS * CELL}" height="${rows * CELL}"></canvas></body></html>`);
await page.evaluate((cases, cols, cell) => {
	const ctx = document.getElementById("c").getContext("2d");
	ctx.lineWidth = 2.4;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.font = "12px sans-serif";
	cases.forEach((c, index) => {
		const ox = (index % cols) * cell;
		const oy = Math.floor(index / cols) * cell;
		ctx.strokeStyle = "#dfe3ea";
		ctx.strokeRect(ox + 0.5, oy + 0.5, cell - 1, cell - 1);
		// fit the strokes into the cell
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const s of c.strokes) for (const p of s.points) {
			minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
		}
		const scale = Math.min((cell - 46) / Math.max(1, maxX - minX), (cell - 46) / Math.max(1, maxY - minY));
		ctx.strokeStyle = "#111827";
		for (const s of c.strokes) {
			ctx.beginPath();
			s.points.forEach((p, i) => {
				const x = ox + 23 + (p.x - minX) * scale;
				const y = oy + 32 + (p.y - minY) * scale;
				i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
			});
			ctx.stroke();
		}
		ctx.fillStyle = "#2563eb";
		ctx.fillText(c.label, ox + 8, oy + 18);
	});
}, CASES, COLS, CELL);
await page.screenshot({ path: path.join(out, "corpus.png") });
console.log("corpus dibujado:", CASES.length, "casos ->", path.join(out, "corpus.png"));
await browser.close();
