// The build stamp, the way into the plugin settings, and the chat's close button.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots38"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1000, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.setRequestInterception(true);
page.on("request", (r) => { const u = r.url(); if (!u.includes("11434")) return void r.continue(); if (u.endsWith("/api/tags")) return void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llava:7b" }] }) }); r.respond({ status: 404, contentType: "application/json", body: "{}" }); });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));

// ---- the settings tab: stamp first, assistant section present
const tab = await page.evaluate(() => {
	const holder = document.body.createDiv();
	holder.id = "nl-settings-overlay";
	holder.style.cssText = "position:fixed;inset:0;overflow:auto;background:#1e1e1e;color:#dcddde;padding:24px;z-index:99999;font-family:'Segoe UI',sans-serif";
	const t = window.__settingTab;
	t.containerEl = holder;
	t.display();
	return {
		stamp: holder.querySelector(".notelens-build-stamp")?.textContent,
		headings: [...holder.querySelectorAll(".setting-item-heading .setting-item-name, .setting-item-name")].map(n => n.textContent).filter(n => ["Ayudante Leen", "Mostrar a Leen", "Servidor del modelo local", "Modelo preferido", "Tamaño de Leen"].includes(n))
	};
});
console.log("build stamp:", tab.stamp);
console.log("assistant settings found:", JSON.stringify(tab.headings));
await page.screenshot({ path: path.join(shots, "100-settings-stamp.png"), clip: { x: 0, y: 0, width: 1000, height: 260 } });
await page.evaluate(() => document.getElementById("nl-settings-overlay")?.remove());

// ---- the board panel links to those settings
await page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
await page.click(".notelens-settings-btn"); await sleep(300);
const link = await page.evaluate(() => {
	const b = document.querySelector(".notelens-settings-link");
	if (!b) return "MISSING";
	const r = b.getBoundingClientRect();
	return { text: b.textContent, visible: r.width > 0 && r.height > 0 };
});
console.log("link to the plugin settings:", JSON.stringify(link));
await page.screenshot({ path: path.join(shots, "101-board-settings-link.png"), clip: { x: 0, y: 380, width: 340, height: 620 } });
await page.keyboard.press("Escape"); await sleep(200);

// ---- the chat's X
await page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
await page.click(".notelens-pet"); await sleep(900);
console.log("close button:", await page.evaluate(() => {
	const b = document.querySelector(".notelens-assistant-close");
	if (!b) return "MISSING";
	const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
	const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
	return { size: [Math.round(r.width), Math.round(r.height)], bg: cs.backgroundColor, border: cs.borderTopColor, clickable: b.contains(hit) || hit === b };
}));
const panelClip = await page.evaluate(() => { const r = document.querySelector(".notelens-assistant").getBoundingClientRect(); return { x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)), width: Math.round(r.width), height: 90 }; });
await page.screenshot({ path: path.join(shots, "102-chat-header.png"), clip: panelClip });
console.log("console issues:", errors.length ? errors.join("\n") : "(none)");
await browser.close();
