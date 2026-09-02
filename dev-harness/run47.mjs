// Local-first assistant and geometry-aware board-to-LaTeX.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots47");
fs.mkdirSync(shots, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 900 }
});
const page = await browser.newPage();
const errors = [];
let modelRequests = 0;
page.on("pageerror", error => errors.push(error.message));
await page.setRequestInterception(true);
page.on("request", request => {
	if (request.url().includes("11434")) { modelRequests++; return void request.abort("connectionrefused"); }
	request.continue();
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));

// Seed realistic study notes, open Leen and verify the useful route is offline.
await page.evaluate(() => {
	const pageId = __view.data.activePageId;
	__view.data.texts.push({
		id: "local-source", pageId, x: 100, y: 220, w: 430, h: 150,
		text: "La fotosíntesis convierte energía luminosa en energía química.\nLa clorofila absorbe la luz.\nEl proceso produce glucosa y libera oxígeno.\nTarea: repasar la fase luminosa.",
		fontSize: 20, color: "#f8fafc", variant: "text"
	});
	__view.renderAll();
});
await page.click(".notelens-pet");
await sleep(250);
console.log("instant tools:", await page.evaluate(() => [...document.querySelectorAll(".notelens-assistant-instant-tool")].map(button => button.textContent)));
console.log("opens without model requests:", modelRequests === 0);
console.log("status:", await page.$eval(".notelens-assistant-status", element => element.textContent));
await page.screenshot({ path: path.join(shots, "170-local-actions.png") });

const beforeTexts = await page.evaluate(() => __view.data.texts.length);
await page.evaluate(() => [...document.querySelectorAll(".notelens-assistant-instant-tool")].find(button => button.textContent.includes("Resumir")).click());
await sleep(250);
console.log("summary inserted:", beforeTexts, "->", await page.evaluate(() => __view.data.texts.length));
console.log("summary text:", await page.evaluate(() => __view.data.texts.at(-1).text.slice(0, 150)));

// The compact handwriting pad also inserts locally and never probes a model.
await page.evaluate(() => [...document.querySelectorAll(".notelens-assistant-mode")].find(button => button.textContent.includes("Fórmula rápida")).click());
await sleep(100);
const sketch = await page.$eval(".notelens-assistant-sketch canvas", canvas => { const rect = canvas.getBoundingClientRect(); return { x: rect.left, y: rect.top }; });
await page.mouse.move(sketch.x + 35, sketch.y + 65); await page.mouse.down(); await page.mouse.move(sketch.x + 105, sketch.y + 65, { steps: 8 }); await page.mouse.up();
await page.mouse.move(sketch.x + 70, sketch.y + 30); await page.mouse.down(); await page.mouse.move(sketch.x + 70, sketch.y + 100, { steps: 8 }); await page.mouse.up();
const mathBefore = await page.evaluate(() => __view.data.texts.filter(text => text.variant === "math").length);
await page.click(".notelens-assistant-send"); await sleep(180);
console.log("quick formula inserted:", mathBefore, "->", await page.evaluate(() => __view.data.texts.filter(text => text.variant === "math").length));
console.log("still no model requests:", modelRequests === 0);

// Vector recognition: operator grouping, superscript layout and fraction bars.
const vector = await page.evaluate(() => {
	const line = (x1, y1, x2, y2) => ({ points: Array.from({ length: 9 }, (_, i) => ({ x: x1 + (x2 - x1) * i / 8, y: y1 + (y2 - y1) * i / 8 })) });
	const plus = __assistantTest.recognizeInkFormula([line(10, 25, 50, 25), line(30, 5, 30, 45)]);
	const equals = __assistantTest.recognizeInkFormula([line(10, 15, 55, 15), line(10, 31, 55, 31)]);
	const fraction = __assistantTest.recognizeInkFormula([
		line(44, 5, 44, 30),
		line(15, 43, 78, 43),
		{ points: Array.from({ length: 25 }, (_, i) => ({ x: 44 + Math.cos(i / 24 * Math.PI * 2) * 12, y: 68 + Math.sin(i / 24 * Math.PI * 2) * 16 })) }
	]);
	const power = __assistantTest.recognizeInkFormula([
		line(8, 45, 38, 78), line(38, 45, 8, 78),
		{ points: [{ x: 48, y: 30 }, { x: 57, y: 20 }, { x: 66, y: 29 }, { x: 48, y: 42 }, { x: 67, y: 42 }] }
	]);
	return { plus, equals, fraction, power };
});
console.log("vector:", JSON.stringify(vector, null, 1));

// Dark page with light ink: this used to become a solid black OCR image.
const darkOcr = await page.evaluate(async () => {
	const canvas = document.createElement("canvas");
	canvas.width = 820; canvas.height = 180;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#0b0e14"; ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = "#f8fafc"; ctx.font = "68px Georgia"; ctx.fillText("x^2 + 3x = 12", 35, 120);
	return await __assistantTest.recognizeFormula(canvas);
});
console.log("dark OCR:", darkOcr);

const fractionOcr = await page.evaluate(async () => {
	const canvas = document.createElement("canvas");
	canvas.width = 520; canvas.height = 260;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = "#111"; ctx.font = "58px Georgia"; ctx.textAlign = "center";
	ctx.fillText("x+1", 260, 86); ctx.fillRect(135, 122, 250, 6); ctx.fillText("x-1", 260, 210);
	return await __assistantTest.recognizeFormula(canvas);
});
console.log("stacked fraction OCR:", fractionOcr);

const semanticFormula = await page.evaluate(async () => {
	const pageId = __view.data.activePageId;
	__view.data.texts.push({ id: "semantic-math", pageId, x: 610, y: 220, w: 260, h: 70, text: "\\frac{x+1}{x-1}", fontSize: 24, color: "#fff", variant: "math" });
	__view.renderAll();
	return await __view.readRegion({ x: 600, y: 210, w: 290, h: 90 }, "__formula__", () => {});
});
console.log("existing math recovered exactly:", semanticFormula);

// The equation dialog exposes structures and never presents a model choice.
if (await page.$(".notelens-assistant:not(.hidden)")) await page.click(".notelens-assistant-close");
await page.click(".notelens-insert-dock button[title^='Insertar ecuación']");
await sleep(250);
console.log("structures:", await page.evaluate(() => [...document.querySelectorAll(".notelens-ink-structure")].map(button => button.textContent)));
console.log("formula dialog model-free:", !(await page.$(".notelens-ink-equation .notelens-assistant-model")));
await page.screenshot({ path: path.join(shots, "171-equation-local.png") });
await page.setViewport({ width: 820, height: 650 });
await sleep(180);
console.log("compact equation bounds:", await page.$eval(".notelens-ink-equation-modal", element => {
	const rect = element.getBoundingClientRect();
	return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), viewport: [innerWidth, innerHeight], scrollable: element.scrollHeight >= element.clientHeight };
}));
await page.screenshot({ path: path.join(shots, "172-equation-compact.png") });
console.log("console issues:", errors.length ? errors.join("\n") : "(none)");
await browser.close();
