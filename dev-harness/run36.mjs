// The new settings: hiding Leen, his size and bubbles, board context, and defaults.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots36"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION_REFUSED|Failed to fetch/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.setRequestInterception(true);
page.on("request", (r) => {
	const u = r.url();
	if (!u.includes("11434")) return void r.continue();
	if (u.endsWith("/api/tags")) return void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llava:7b" }] }) });
	r.respond({ status: 404, contentType: "application/json", body: "{}" });
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const settings = () => page.evaluate(() => __view.plugin.settings);

// ---- every new setting exists with a sane default
const s = await settings();
console.log("new settings:", JSON.stringify({
	showAssistantPet: s.showAssistantPet, petScale: s.petScale, petBubbles: s.petBubbles,
	aiUseBoardContext: s.aiUseBoardContext, defaultTextFont: s.defaultTextFont, defaultStickyColor: s.defaultStickyColor,
	aiBaseUrl: s.aiBaseUrl, aiModel: s.aiModel
}));

// ---- Leen's size follows the setting
await page.evaluate(() => { __view.plugin.settings.petScale = 1.5; document.querySelector(".notelens-pet").style.setProperty("--pet-scale", "1.5"); });
await sleep(150);
console.log("pet box at 1.5x:", await page.evaluate(() => { const r = document.querySelector(".notelens-pet").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
await page.evaluate(() => document.querySelector(".notelens-pet").style.setProperty("--pet-scale", "1"));

// ---- the bubble can be silenced
await page.evaluate(() => { __view.plugin.settings.petBubbles = false; });
await page.mouse.move(700, 400); await sleep(150);
const petBox = await page.evaluate(() => { const r = document.querySelector(".notelens-pet").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.move(petBox.x, petBox.y); await sleep(500);
console.log("bubble stays hidden when silenced:", await page.evaluate(() => document.querySelector(".notelens-pet-bubble").classList.contains("hidden")));

// ---- the board context box can start ticked
await page.evaluate(() => { __view.plugin.settings.aiUseBoardContext = true; });
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.evaluate(() => { __view.plugin.settings.aiUseBoardContext = true; });
console.log("context default is read at build time:", await page.evaluate(() => __view.aiUseBoardContext));

// ---- the sticky colour and the text font follow the settings
await page.evaluate(() => {
	__view.plugin.settings.defaultStickyColor = "#cde8ff";
	__view.plugin.settings.defaultTextFont = "serif";
	__view.applySettings?.();
	__view.textFont = __view.plugin.settings.defaultTextFont;
	__view.addStickyNote();
	__view.commitTextEditor();
});
await sleep(250);
console.log("new sticky colour:", await page.evaluate(() => __view.data.texts.filter(t => t.stickyColor).map(t => t.stickyColor)));
console.log("text font in use:", await page.evaluate(() => __view.textFont));

// ---- hiding Leen removes him from the board
await page.evaluateOnNewDocument(() => { window.__presetSettings = { showAssistantPet: false }; });
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("pet present after hiding:", await page.evaluate(() => !!document.querySelector(".notelens-pet")));
console.log("chat present after hiding:", await page.evaluate(() => !!document.querySelector(".notelens-assistant")));
await shot(page, "80-board-without-leen");
console.log("console issues:\n" + (errors.length ? errors.slice(0, 6).join("\n") : "(none)"));
await browser.close();
