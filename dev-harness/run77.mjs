// Regression coverage for keyboard lifetime, canvas recovery, media fallbacks and failed reads.
// Provider responses are mocked: this tests integration, not remote playback availability.
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const server = http.createServer((req, res) => {
	const filename = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
	if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); res.end(); return; }
	res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(filename)] || "application/octet-stream");
	fs.createReadStream(filename).pipe(res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const shots = path.join(here, "shots77");
fs.mkdirSync(shots, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log(`✓ ${label}`); };
try {
	for (const profile of [{ name: "phone", width: 390, height: 844, dpr: 3 }, { name: "tablet", width: 1024, height: 1366, dpr: 4 }]) {
		const page = await browser.newPage();
		const errors = [];
		page.on("pageerror", error => errors.push(error.message));
		await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: profile.dpr, isMobile: true, hasTouch: true });
		await page.setRequestInterception(true);
		page.on("request", request => {
			if (/youtube|tiktok|instagram/.test(request.url())) return void request.respond({ status: 200, contentType: "text/html", body: "<p>Mock provider</p>" });
			void request.continue();
		});
		await page.evaluateOnNewDocument(() => {
			window.__presetPlatform = { isMobile: true, isDesktop: false, isPhone: true, isIosApp: false };
			window.__presetSettings = { showAssistantPet: false };
			const viewport = new EventTarget();
			Object.assign(viewport, { height: innerHeight, width: innerWidth, offsetTop: 0, scale: 1 });
			window.__keyboard = height => { viewport.height = height; viewport.dispatchEvent(new Event("resize")); };
			Object.defineProperty(window, "visualViewport", { value: viewport });
		});
		await page.goto(base + "/dev-harness/index.html");
		await page.waitForFunction(() => window.__ready || window.__bootError);
		check(await page.evaluate(() => !window.__bootError), profile.name + " boots");
		await page.evaluate(() => {
			const v = window.__view;
			v.data.strokes.push({ id: "ink", type: "pen", color: "#ff0000", width: 8, points: [{ x: 100, y: 160, p: .5 }, { x: 250, y: 160, p: .5 }] });
			v.data.texts.push({ id: "text", x: 50, y: innerHeight * .7, w: 280, h: 48, text: "Notas", variant: "text", fontSize: 20, color: "#111111" });
			v.renderAll();
			v.beginTextEdit(v.data.texts.at(-1), v.domLayerEl.querySelector('[data-id="text"]'));
			window.__originalY = v.data.viewTransform.y;
			window.__keyboard(innerHeight * .5);
		});
		await pause(350);
		await page.keyboard.type(" con teclado");
		await pause(400);
		const active = await page.evaluate(() => {
			const v = window.__view, c = v.renderer.canvas;
			const box = v.workspaceEl.getBoundingClientRect();
			const scene = v.getSceneCoords(box.left + 40, box.top + 40);
			const vt = v.data.viewTransform;
			return {
				y: vt.y, savedY: JSON.parse(window.__saved).viewTransform.y, original: window.__originalY,
				lift: v.keyboardLift, stageY: parseFloat(/translate\([^,]+,\s*(-?[\d.]+)px\)/.exec(v.stageEl.style.transform)?.[1] ?? "NaN"),
				canvasMoved: c.style.translate !== "" || c.style.transform !== "",
				canvasCovers: Math.abs(c.getBoundingClientRect().height - box.height) < 2,
				scene: scene.y, expected: (40 - vt.y + v.keyboardLift) / vt.scale,
				area: c.width * c.height, edge: Math.max(c.width, c.height)
			};
		});
		check(active.lift > 0 && Math.abs(active.stageY - (active.y - active.lift)) < 0.5, profile.name + " moves text and ink together above keyboard");
		check(!active.canvasMoved && active.canvasCovers, profile.name + " keeps the canvas covering the board while lifted");
		check(Math.abs(active.scene - active.expected) < 0.01, profile.name + " reads a touch where the lifted board shows it");
		check(active.y === active.original && active.savedY === active.original, profile.name + " does not save keyboard movement");
		check(active.area <= 8_000_000 && active.edge <= 4096, profile.name + " caps canvas memory at high DPR");
		const ime = await page.evaluate(() => {
			const editor = window.__view.activeTextEditor;
			const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true, cancelable: true });
			editor.dispatchEvent(event);
			return !event.defaultPrevented && window.__view.activeTextEditor === editor;
		});
		check(ime, profile.name + " leaves IME composition intact");
		await page.screenshot({ path: path.join(shots, profile.name + "-keyboard.png") });
		await page.evaluate(() => window.__view.commitTextEditor());
		await page.evaluate(() => window.__keyboard(innerHeight * .4));
		await pause(350);
		check(await page.evaluate(() => window.__view.keyboardLift === 0 && !window.__view.renderer.canvas.style.translate), profile.name + " cleans up on direct commit without blur");
		const squeezed = await page.evaluate(async () => {
			const v = window.__view;
			const shell = document.querySelector(".view-container");
			const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))));
			v.beginTextEdit(v.data.texts.at(-1), v.domLayerEl.querySelector('[data-id="text"]'));
			const keyboardTop = Math.round(innerHeight * .5);
			window.__keyboard(keyboardTop);
			await settled();
			// What a phone does: the keyboard taken off a viewport the system already shrank.
			shell.style.height = "88px";
			await settled();
			const strip = v.workspaceEl.getBoundingClientRect();
			const short = v.workspaceEl.classList.contains("is-short");
			const canvas = v.renderer.canvas.getBoundingClientRect().height;
			v.commitTextEditor();
			await settled();
			const released = shell.style.minHeight === "" && v.workspaceEl.style.minHeight === "";
			shell.style.height = "";
			await settled();
			return { height: strip.height, top: strip.top, canvas, keyboardTop, short, released, back: v.workspaceEl.getBoundingClientRect().height };
		});
		check(squeezed.height > 200 && squeezed.top + squeezed.height <= squeezed.keyboardTop + 2, profile.name + " keeps a board when the app squeezes the view under a keyboard");
		check(Math.abs(squeezed.canvas - squeezed.height) < 2, profile.name + " paints the whole board it was given back");
		check(squeezed.released && squeezed.back > squeezed.height, profile.name + " hands the view back its own height when the keyboard goes");
		const shortView = await page.evaluate(async () => {
			const v = window.__view;
			const shell = document.querySelector(".view-container");
			const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))));
			shell.style.height = "180px";
			await settled();
			const hidden = getComputedStyle(document.querySelector(".notelens-insert-dock")).display === "none";
			const tools = getComputedStyle(document.querySelector(".onenote-ribbon-dock")).display !== "none";
			shell.style.height = "";
			await settled();
			return { hidden, tools, restored: !v.workspaceEl.classList.contains("is-short") };
		});
		check(shortView.hidden && shortView.tools && shortView.restored, profile.name + " gives a strip of a view to the board and its tools");
		const recovery = await page.evaluate(() => {
			const v = window.__view, c = v.renderer.canvas, ctx = c.getContext("2d");
			v.handleResize();
			const before = c.toDataURL();
			v.renderer.resize(0, 0);
			const kept = before === c.toDataURL();
			ctx.clearRect(0, 0, c.width, c.height);
			c.dispatchEvent(new Event("contextrestored"));
			return { kept, restored: before === c.toDataURL() };
		});
		check(recovery.kept && recovery.restored, profile.name + " retains zero-size bitmap and redraws after restoration event");
		await page.setViewport({ width: profile.height, height: profile.width, deviceScaleFactor: profile.dpr, isMobile: true, hasTouch: true });
		await pause(250);
		check(await page.evaluate(() => { const c = window.__view.renderer.canvas; return c.width > 0 && c.height > 0 && c.width * c.height <= 8_000_000; }), profile.name + " survives orientation change");
		await page.evaluate(() => {
			const v = window.__view;
			v.data.embeds.push({ id: "video", kind: "web-video", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", x: 10, y: 80, w: 340, h: 300 });
			v.data.embeds.push({ id: "short", kind: "web-video", src: "https://vm.tiktok.com/ABC123/", x: 380, y: 80, w: 340, h: 300 });
			v.renderAll();
		});
		const media = await page.evaluate(() => {
			const full = document.querySelector('[data-id="video"]');
			const short = document.querySelector('[data-id="short"]');
			const iframe = full.querySelector("iframe");
			return { policy: iframe.referrerPolicy, original: full.querySelector(".notelens-video-fallback a").href, shortHasPlayer: !!short.querySelector("iframe"), shortLink: short.querySelector("a").href };
		});
		check(media.policy === "strict-origin-when-cross-origin" && media.original.includes("watch?v="), profile.name + " gives legacy YouTube embeds an original watch link");
		check(!media.shortHasPlayer && media.shortLink.includes("vm.tiktok.com"), profile.name + " keeps shortened links usable without a broken iframe");
		await page.screenshot({ path: path.join(shots, profile.name + "-video.png") });
		const protectedRead = await page.evaluate(async () => {
			const v = window.__view;
			await v.saver.flush(v.data);
			let writes = 0;
			v.app.vault.modify = async () => { writes++; };
			v.app.vault.read = async () => "{corrupt";
			await v.onLoadFile(new window.__TFile("corrupt.notelens"));
			v.save();
			await v.saver.flush(v.data);
			return writes === 0 && v.workspaceEl.inert && !!document.querySelector(".notelens-load-error");
		});
		check(protectedRead, profile.name + " never overwrites a file that failed to load");
		check(errors.length === 0, profile.name + " has no uncaught browser errors: " + errors.join(", "));
		await page.close();
	}
	console.log(`${checks} regression checks passed. Remote playback and real device keyboards still require device validation.`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
