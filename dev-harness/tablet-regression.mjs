// Four screen sizes, checked against the board the plugin really renders.
// Run after npm run build, from anywhere: node dev-harness/tablet-regression.mjs
import puppeteer from "puppeteer-core";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(here, "index.html")).href;

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});

try {
	for (const [width, height, touch] of [[768, 1024, true], [1024, 768, true], [390, 844, true], [1440, 900, false]]) {
		const page = await browser.newPage();
		await page.setViewport({ width, height, isMobile: touch, hasTouch: touch });
		await page.evaluateOnNewDocument((touch) => {
			window.__presetPlatform = { isMobile: touch, isDesktop: !touch, isPhone: touch && innerWidth < 600, isIosApp: touch };
			window.__presetSettings = { showAssistantPet: false };
		}, touch);
		await page.goto(url, { waitUntil: "load" });
		await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
		assert.equal(await page.evaluate(() => window.__bootError), undefined);

		// Obsidian mobile buttons have horizontal padding. Reproduce it before measuring icons.
		await page.addStyleTag({ content: "body button { padding: 12px 20px; }" });

		// Ink laid on either ruler follows its edge, whatever the angle. Half the
		// height is the straight ruler's own edge, and halfway up the protractor's
		// arc -- which is where a hand rests it, not on the thin base line.
		const report = await page.evaluate(() => {
			const v = window.__view, results = [];
			for (const mode of ["ruler", "protractor"]) for (const angle of [0, 30, 90, 135]) {
				v.rulerState = { visible: true, x: 80, y: 240, length: 300, angle, mode };
				v.renderRuler(); v.setTool("pen"); v.currentStroke = null;
				const a = angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), cx = 230, cy = 240;
				const off = v.rulerEl.offsetHeight / 2;
				const r = v.workspaceEl.getBoundingClientRect();
				const x = cx + dy * off, y = cy - dx * off;
				const p = v.getDrawingSceneCoords(r.left + x, r.top + y);
				v.currentStroke = { points: [p] };
				const q = v.getDrawingSceneCoords(r.left + x + dx * 80 - dy * 60, r.top + y + dy * 80 + dx * 60);
				results.push(Math.abs((q.x - p.x) * dy - (q.y - p.y) * dx));
				v.currentStroke = null;
			}
			v.rulerState.visible = false; v.renderRuler();
			return results;
		});
		assert.ok(report.every(d => d < 1e-8), `ruler ${report}`);

		// The rotate asa has to sit inside the ruler in both modes. Hanging over the
		// edge left it looking halved on the protractor, whose clip-path also ate
		// the press: the pointer went through to the board instead.
		const asa = await page.evaluate(() => {
			const v = window.__view, out = [];
			for (const mode of ["ruler", "protractor"]) {
				v.rulerState = { visible: true, x: 60, y: 320, length: 280, angle: 0, mode };
				v.renderRuler();
				const el = v.rulerEl;
				const r = el.getBoundingClientRect();
				const q = el.querySelector(".notelens-ruler-rotate").getBoundingClientRect();
				const l = el.querySelector(".notelens-ruler-label").getBoundingClientRect();
				const hit = document.elementFromPoint(q.right - 2, q.top + q.height / 2);
				out.push({
					mode,
					inside: q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && q.top >= r.top - 0.5 && q.bottom <= r.bottom + 0.5,
					live: !!hit?.closest(".notelens-ruler-rotate"),
					clearOfLabel: q.left >= l.right || q.right <= l.left || q.top >= l.bottom || q.bottom <= l.top
				});
			}
			v.rulerState.visible = false; v.renderRuler();
			return out;
		});
		for (const a of asa) assert.ok(a.inside && a.live && a.clearOfLabel, `rotate handle ${JSON.stringify(a)}`);

		// The scale is drawn to a viewBox, so the box it lands in has to be exactly
		// that size. A few pixels of difference squashes the ruler's millimetres and
		// turns the protractor's circle into an ellipse, putting its degrees out.
		const fit = await page.evaluate(() => {
			const v = window.__view, out = [];
			for (const mode of ["ruler", "protractor"]) {
				v.rulerState = { visible: true, x: 40, y: 300, length: 260, angle: 0, mode };
				v.renderRuler();
				const svg = v.rulerEl.querySelector(".notelens-ruler-scale");
				const box = svg.getBoundingClientRect();
				const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
				out.push({ mode, x: +(box.width / w).toFixed(3), y: +(box.height / h).toFixed(3) });
			}
			v.rulerState.visible = false; v.renderRuler();
			return out;
		});
		for (const f of fit) assert.ok(Math.abs(f.x - 1) < 0.005 && Math.abs(f.y - 1) < 0.005, `scale stretched ${JSON.stringify(f)}`);

		// Pixel regression: repeated highlighting keeps its opacity, live and committed.
		const ink = await page.evaluate(() => {
			const r = window.__view.renderer, vt = { x: 0, y: 0, scale: 1 };
			const s = { id: "a", type: "highlighter", color: "rgba(250, 204, 21, 0.35)", width: 20, points: [{ x: 60, y: 100, p: .5 }, { x: 180, y: 100, p: .5 }] };
			const pixel = () => Array.from(r.canvas.getContext("2d").getImageData(Math.round(100 * r.canvas.width / r.canvas.clientWidth), Math.round(100 * r.canvas.height / r.canvas.clientHeight), 1, 1).data);
			r.renderAll([s], [], vt); const first = pixel();
			r.renderAll([s, { ...s, id: "b" }], [], vt);
			return { first, second: pixel() };
		});
		assert.equal(ink.second[3], ink.first[3], "repeated highlighter opacity");
		assert.ok(ink.second.every((v, i) => Math.abs(v - ink.first[i]) <= 3), "stable ink color");
		assert.ok(ink.first[3] > 60, "visible ink");

		// The marker cannot use the snapshot path -- it composites with the strokes
		// it shares a colour with, under the pen ink -- so it re-renders the whole
		// document. That has to happen once a frame, not once a pointer move.
		const live = await page.evaluate(async () => {
			const v = window.__view, el = document.querySelector(".onenote-workspace");
			let renders = 0;
			const real = v.renderer.renderAll.bind(v.renderer);
			v.renderer.renderAll = (...a) => { renders++; return real(...a); };
			v.data.strokes.length = 0; v.currentStroke = null; v.setTool("highlighter");
			const ev = (k, x, y) => el.dispatchEvent(new PointerEvent(k, { bubbles: true, cancelable: true,
				clientX: x, clientY: y, pointerId: 611, pointerType: "pen", isPrimary: true, pressure: 0.5,
				button: k === "pointerdown" ? 0 : -1, buttons: 1 }));
			ev("pointerdown", 60, 200);
			for (let i = 1; i <= 120; i++) ev("pointermove", 60 + i, 200 + (i % 7));
			const duringMoves = renders;
			ev("pointerup", 180, 200);
			await new Promise(r => setTimeout(r, 80));
			v.renderer.renderAll = real;
			const c = v.renderer.canvas, d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
			let painted = 0;
			for (let i = 3; i < d.length; i += 4) if (d[i] > 8) painted++;
			v.data.strokes.length = 0;
			return { duringMoves, painted };
		});
		assert.ok(live.duringMoves <= 4, `marker re-rendered ${live.duringMoves} times for 120 moves`);
		assert.ok(live.painted > 0, "marker ink reaches the canvas");

		await page.evaluate(() => {
			window.__view.setTool("pen");
			document.querySelector(".onenote-dock-btn[data-tool=pen]").click();
		});
		const overflow = await page.$eval(".notelens-nib-grid", (grid) => {
			const r = grid.getBoundingClientRect();
			return [...grid.children].some(el => {
				const b = el.getBoundingClientRect();
				return b.left < r.left - 1 || b.right > r.right + 1 || el.scrollWidth > el.clientWidth + 1;
			});
		});
		assert.equal(overflow, false, "nib choices fit their grid");
		await page.evaluate(() => document.querySelector(".notelens-pen-panel").classList.add("hidden"));

		for (const mode of ["normal", "fullscreen", "focus"]) {
			await page.evaluate((mode) => {
				const v = window.__view;
				if (mode === "fullscreen") v.toggleFullscreen();
				if (mode === "focus") v.toggleFocusMode();
			}, mode);
			await page.$eval(".notelens-settings-btn", el => el.click());
			const metrics = await page.$eval(".notelens-settings-panel .notelens-embed-close", (el) => {
				const r = el.getBoundingClientRect(), svg = el.querySelector("svg").getBoundingClientRect();
				return { w: svg.width, h: svg.height, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
			});
			assert.ok(metrics.w >= 14 && metrics.h >= 14 && metrics.inside, `${mode} close ${JSON.stringify(metrics)}`);
			await page.$eval(".notelens-settings-panel .notelens-embed-close", el => el.click());

			await page.evaluate(() => window.__view.translateText());
			const translator = ".notelens-translator .notelens-embed-close";
			assert.ok(await page.$eval(translator, (el) => {
				const s = el.querySelector("svg").getBoundingClientRect(), r = el.getBoundingClientRect();
				return s.width >= 14 && r.right <= innerWidth && r.bottom <= innerHeight;
			}), "translator close visible");
			await page.$eval(translator, el => el.click());
		}

		await page.close();
		console.log(`PASS ${width}x${height}: ruler and protractor at four angles, rotate asa inside both, scale undistorted, settings close in three modes`);
	}
} finally {
	await browser.close();
}
