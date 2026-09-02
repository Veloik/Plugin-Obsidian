// Handwritten step trimming (card frame fits the ink) and paper-like sticky notes.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots29"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const drag = async (pts, steps = 4) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps }); await page.mouse.up(); };

// ---- 1. a short handwritten step must save a narrow image
await clean();
await page.click(".onenote-quick-tags .onenote-tag-chip[data-tag='tag_todo']"); await clean();
await page.mouse.click(430, 520); await sleep(300);
const modes = await page.$$(".notelens-task-checklist-mode");
await modes[0].click(); await sleep(200);
const pad = await page.evaluate(() => { const c = document.querySelector(".notelens-task-checklist-pad canvas"); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
// write only in the left quarter of the pad
await drag([[pad.x + 20, pad.y + 44], [pad.x + 40, pad.y + 18], [pad.x + 62, pad.y + 46], [pad.x + 86, pad.y + 20]], 6);
await sleep(250);
await shot(page, "10-pad-short-word");
await page.click(".notelens-hover-note-footer .mod-cta"); await sleep(350); await clean();
const step = await page.evaluate(() => {
	const b = __view.data.badges.find(x => x.tagId === "tag_todo");
	return { hasSketch: !!b.checklist[0].sketch, bytes: (b.checklist[0].sketch || "").length };
});
console.log("saved step:", JSON.stringify(step));
const natural = await page.evaluate(sketch => new Promise(resolve => {
	const img = new Image();
	img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
	img.src = sketch;
}), await page.evaluate(() => __view.data.badges.find(x => x.tagId === "tag_todo").checklist[0].sketch));
console.log("trimmed image size (device px, pad is 460x68 css):", natural);

await page.evaluate(() => __view.setTool("select"));
await page.mouse.move(900, 830); await sleep(400);
let rows = 0;
for (let i = 0; i < 3 && rows === 0; i++) {
	await page.mouse.move(900, 830); await sleep(250);
	const b = await page.evaluate(() => { const el = document.querySelector(".onenote-placed-badge"); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
	await page.mouse.move(b.x, b.y); await sleep(700);
	rows = await page.evaluate(() => document.querySelectorAll(".onenote-top-tooltip-checklist-item").length);
}
console.log("card metrics:", await page.evaluate(() => {
	const card = document.querySelector(".onenote-top-tooltip");
	if (!card) return "no card";
	const cr = card.getBoundingClientRect();
	const img = card.querySelector(".onenote-top-tooltip-step-sketch");
	const ir = img ? img.getBoundingClientRect() : null;
	return {
		card: [Math.round(cr.width), Math.round(cr.height)],
		img: ir ? [Math.round(ir.width), Math.round(ir.height)] : null,
		imageFitsInsideCard: ir ? ir.right <= cr.right + 1 && ir.left >= cr.left - 1 : null,
		slackRight: ir ? Math.round(cr.right - ir.right) : null
	};
}));
const cardClip = await page.evaluate(() => { const r = document.querySelector(".onenote-top-tooltip").getBoundingClientRect(); return { x: Math.max(0, Math.round(r.left) - 30), y: Math.max(0, Math.round(r.top) - 20), width: Math.round(r.width) + 60, height: Math.round(r.height) + 90 }; });
await shot(page, "11-card-fits-handwriting", cardClip);

// ---- 2. sticky notes look like paper
await page.mouse.move(1200, 200); await sleep(300);
const colours = await page.evaluate(() => {
	__view.data.texts.length = 0;
	const palette = ["#fff2a8", "#ffd9a0", "#ffd7e5", "#d8f5c9", "#cde8ff", "#eadbff"];
	palette.forEach((color, index) => {
		__view.data.texts.push({
			id: `sticky_${index}`, pageId: __view.data.activePageId,
			x: 160 + (index % 3) * 250, y: 240 + Math.floor(index / 3) * 210,
			text: index === 0 ? "Repasar el tema 3\ny hacer los ejercicios" : `Nota ${index + 1}`,
			fontSize: 20, color: "#302b19", stickyColor: color, w: 220, h: 150, fontFamily: "rounded", variant: "text"
		});
	});
	__view.renderAll();
	return palette;
});
await sleep(300);
console.log("sticky notes rendered:", await page.evaluate(() => document.querySelectorAll(".notelens-sticky-note").length));
console.log("paper styling:", await page.evaluate(() => {
	const el = document.querySelector(".notelens-sticky-note");
	const cs = getComputedStyle(el);
	const fold = getComputedStyle(el, "::after");
	return {
		tilt: el.style.transform,
		colorVar: el.style.getPropertyValue("--sticky-color").trim(),
		shadeVar: el.style.getPropertyValue("--sticky-shade").trim(),
		hasClip: cs.clipPath !== "none",
		foldWidth: fold.width,
		shadowLayers: cs.boxShadow.split("rgba").length - 1
	};
}));
console.log("tilts differ:", await page.evaluate(() => [...document.querySelectorAll(".notelens-sticky-note")].map(el => el.style.getPropertyValue("--sticky-tilt").trim())));
await shot(page, "12-sticky-wall", { x: 100, y: 190, width: 800, height: 460 });
console.log("console issues:\n" + (errors.length ? errors.slice(0, 8).join("\n") : "(none)"));
await browser.close();
