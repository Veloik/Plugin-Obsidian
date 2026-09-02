// Close button, arrow side, obstacle-aware placement and server diagnosis.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots35"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + ".png") }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION_REFUSED|Failed to fetch/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
let serverUp = true;
await page.setRequestInterception(true);
page.on("request", (r) => {
	const u = r.url();
	if (!u.includes("11434")) return void r.continue();
	if (!serverUp) return void r.abort("connectionrefused");
	if (u.endsWith("/api/tags")) return void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llava:7b" }] }) });
	r.respond({ status: 404, contentType: "application/json", body: "{}" });
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const drag = async (pts, steps = 5) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps }); await page.mouse.up(); };
const petCentre = () => page.evaluate(() => { const r = document.querySelector(".notelens-pet").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });

// show the minimap too, so it counts as an obstacle
await page.evaluate(() => __view.toggleMiniMap());
await clean();
await page.click(".notelens-pet"); await sleep(800);

// ---- the close button is visible and closes the chat
console.log("close button:", await page.evaluate(() => {
	const b = document.querySelector(".notelens-assistant-header .notelens-embed-close");
	const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
	return { size: [Math.round(r.width), Math.round(r.height)], background: cs.backgroundColor, border: cs.borderTopWidth, contrastWithPanel: cs.backgroundColor !== "rgba(0, 0, 0, 0)" };
}));
await page.click(".notelens-assistant-header .notelens-embed-close"); await sleep(300);
console.log("closes on click:", await page.evaluate(() => document.querySelector(".notelens-assistant").classList.contains("hidden")));
await page.click(".notelens-pet"); await sleep(600);

// ---- the arrow points at the cat, and nothing important is covered
const spots = [["arriba izquierda", 150, 200], ["arriba derecha", 1260, 200], ["abajo izquierda", 150, 800], ["abajo derecha", 1280, 800], ["centro", 700, 450]];
for (const [label, x, y] of spots) {
	const from = await petCentre();
	await drag([[from.x, from.y], [x, y]], 6);
	await sleep(500);
	const check = await page.evaluate(() => {
		const bounds = document.querySelector(".onenote-workspace").getBoundingClientRect();
		const pet = document.querySelector(".notelens-pet").getBoundingClientRect();
		const panel = document.querySelector(".notelens-assistant");
		const p = panel.getBoundingClientRect();
		const arrow = getComputedStyle(panel, "::after");
		const panelLeftOfCat = p.left < pet.left;
		const arrowOnRightEdge = arrow.right !== "auto" && parseFloat(arrow.right) < 0;
		const covered = [];
		for (const sel of [".onenote-ribbon-dock", ".notelens-insert-dock", ".notelens-document-dock", ".onenote-quick-tags", ".notelens-settings-btn", ".notelens-bookmarks-dock", ".notelens-pages-dock", ".notelens-navigation-controls", ".notelens-minimap", ".notelens-focus-toggle"]) {
			const el = document.querySelector(sel);
			if (!el || el.classList.contains("hidden") || !el.offsetWidth) continue;
			const r = el.getBoundingClientRect();
			if (p.left < r.right && p.right > r.left && p.top < r.bottom && p.bottom > r.top) covered.push(sel.replace(/^\./, ""));
		}
		return { panelLeftOfCat, arrowOnRightEdge, arrowPointsAtCat: panelLeftOfCat === arrowOnRightEdge, covered,
			inside: p.left >= bounds.left - 1 && p.right <= bounds.right + 1 && p.top >= bounds.top - 1 && p.bottom <= bounds.bottom + 1 };
	});
	console.log(`${label}: flecha hacia el gato ${check.arrowPointsAtCat}, dentro ${check.inside}, tapa ${check.covered.length ? check.covered.join(", ") : "nada"}`);
	await shot(page, `70-${label.replace(/ /g, "-")}`);
}

// ---- with the server down the message says why
serverUp = false;
await page.click(".notelens-pet"); await sleep(200);
await page.click(".notelens-pet"); await sleep(1200);
console.log("status when nothing answers:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));
console.log("console issues:\n" + (errors.length ? errors.slice(0, 6).join("\n") : "(none)"));
await browser.close();
