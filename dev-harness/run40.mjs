// Settings that apply live, and a close control that does not need an icon set.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots40"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.setRequestInterception(true);
page.on("request", (r) => { const u = r.url(); if (!u.includes("11434")) return void r.continue(); if (u.endsWith("/api/tags")) return void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llava:7b" }] }) }); r.respond({ status: 404, contentType: "application/json", body: "{}" }); });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));

// ---- the close control shows a glyph, no icon set involved
await clean();
await page.click(".notelens-pet"); await sleep(900);
console.log("close control:", await page.evaluate(() => {
	const b = document.querySelector(".notelens-assistant-close");
	const r = b.getBoundingClientRect();
	return { text: b.textContent, hasSvg: !!b.querySelector("svg"), size: [Math.round(r.width), Math.round(r.height)], visible: r.width > 10 && r.height > 10 };
}));
const clip = await page.evaluate(() => { const r = document.querySelector(".notelens-assistant").getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: 70 }; });
await page.screenshot({ path: path.join(shots, "120-close-glyph.png"), clip });
await page.click(".notelens-assistant-close"); await sleep(300);
console.log("it closes:", await page.evaluate(() => document.querySelector(".notelens-assistant").classList.contains("hidden")));

// ---- changing a setting reaches the open board at once
const before = await page.evaluate(() => ({
	compact: document.querySelector(".onenote-workspace").classList.contains("is-compact"),
	tagsHidden: document.querySelector(".onenote-workspace").classList.contains("hide-quick-tags"),
	pet: !!document.querySelector(".notelens-pet"),
	textSize: __view.textSize
}));
await page.evaluate(async () => {
	const s = __view.plugin.settings;
	s.compactUi = true;
	s.showQuickTags = false;
	s.textSize = 44;
	await __view.plugin.saveSettings();
});
await sleep(300);
const after = await page.evaluate(() => ({
	compact: document.querySelector(".onenote-workspace").classList.contains("is-compact"),
	tagsHidden: document.querySelector(".onenote-workspace").classList.contains("hide-quick-tags"),
	pet: !!document.querySelector(".notelens-pet"),
	textSize: __view.textSize
}));
console.log("before:", JSON.stringify(before));
console.log("after applying settings live:", JSON.stringify(after));

// ---- hiding Leen takes effect without reopening the board
await page.evaluate(async () => { __view.plugin.settings.showAssistantPet = false; await __view.plugin.saveSettings(); });
await sleep(300);
console.log("pet after hiding live:", await page.evaluate(() => ({ pet: !!document.querySelector(".notelens-pet"), chat: !!document.querySelector(".notelens-assistant") })));
await page.evaluate(async () => { __view.plugin.settings.showAssistantPet = true; await __view.plugin.saveSettings(); });
await sleep(300);
console.log("pet after showing again:", await page.evaluate(() => ({ pet: !!document.querySelector(".notelens-pet"), chat: !!document.querySelector(".notelens-assistant") })));

// ---- the board button label
await clean();
await page.click(".notelens-settings-btn"); await sleep(300);
console.log("board button label:", await page.evaluate(() => document.querySelector(".notelens-settings-link")?.textContent));
console.log("console issues:", errors.length ? errors.join("\n") : "(none)");
await browser.close();
