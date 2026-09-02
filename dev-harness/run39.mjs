// Telling apart: no server, server without models, and a working server.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots39"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
let catalogue = [];
let up = true;
await page.setRequestInterception(true);
page.on("request", (r) => {
	const u = r.url();
	if (!u.includes("11434")) return void r.continue();
	if (!up) return void r.abort("connectionrefused");
	if (u.endsWith("/api/tags")) return void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: catalogue }) });
	r.respond({ status: 404, contentType: "application/json", body: "{}" });
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const reopen = async () => {
	await clean();
	const open = await page.evaluate(() => !document.querySelector(".notelens-assistant").classList.contains("hidden"));
	if (open) { await page.click(".notelens-pet"); await sleep(200); }
	await page.click(".notelens-pet"); await sleep(1200);
	return page.evaluate(() => ({
		status: document.querySelector(".notelens-assistant-status").textContent,
		button: document.querySelector(".notelens-assistant-server").classList.contains("hidden") ? null : document.querySelector(".notelens-assistant-server").textContent,
		options: [...document.querySelector(".notelens-assistant-model").options].map(o => o.text)
	}));
};

// 1. Ollama answers but has nothing downloaded: exactly the user's machine.
console.log("A · servidor sin modelos:", JSON.stringify(await reopen(), null, 1));
await page.screenshot({ path: path.join(shots, "110-no-models.png"), clip: { x: 940, y: 150, width: 460, height: 460 } });

// 2. A model appears.
catalogue = [{ name: "llava:7b" }];
console.log("B · con un modelo:", JSON.stringify(await reopen(), null, 1));

// 3. Nothing listening at all.
up = false;
catalogue = [];
console.log("C · sin servidor:", JSON.stringify(await reopen(), null, 1));
console.log("console issues:", errors.length ? errors.join("\n") : "(none)");
await browser.close();
