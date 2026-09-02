// localhost vs 127.0.0.1, a close button that is really there, and drawing requests.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots37"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION_REFUSED|Failed to fetch/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

// Only 127.0.0.1 answers, exactly like Ollama with an IPv6 "localhost" lookup.
let sent = null;
await page.setRequestInterception(true);
page.on("request", (r) => {
	const u = r.url();
	if (!u.includes("11434")) return void r.continue();
	if (u.includes("//localhost")) return void r.abort("connectionrefused");
	if (u.endsWith("/api/tags")) return void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llava:7b" }] }) });
	if (u.endsWith("/api/chat")) { sent = JSON.parse(r.postData() || "{}"); return void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ message: { role: "assistant", content: "Es una función con dos máximos." } }) }); }
	r.respond({ status: 404, contentType: "application/json", body: "{}" });
});
// The setting still says localhost, as an existing install would.
await page.evaluateOnNewDocument(() => { window.__presetSettings = { aiBaseUrl: "http://localhost:11434" }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
await clean();
await page.click(".notelens-pet"); await sleep(1200);
console.log("setting says:", await page.evaluate(() => __view.plugin.settings.aiBaseUrl));
console.log("status:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));
console.log("models found despite localhost failing:", await page.evaluate(() => [...document.querySelector(".notelens-assistant-model").options].map(o => o.text)));

// ---- the close button
const close = await page.evaluate(() => {
	const b = document.querySelector(".notelens-assistant-close");
	if (!b) return "MISSING";
	const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
	const panel = document.querySelector(".notelens-assistant").getBoundingClientRect();
	const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
	return { size: [Math.round(r.width), Math.round(r.height)], bg: cs.backgroundColor, insidePanel: r.right <= panel.right + 1 && r.left >= panel.left - 1, clickable: b.contains(hit) || hit === b };
});
console.log("close button:", JSON.stringify(close));
await shot(page, "90-header-with-close", { x: 940, y: 150, width: 460, height: 300 });
await page.keyboard.press("Escape"); await sleep(300);
console.log("Escape closes it:", await page.evaluate(() => document.querySelector(".notelens-assistant").classList.contains("hidden")));
await page.click(".notelens-pet"); await sleep(700);

// ---- asking about a drawing is a choice
await page.click(".notelens-assistant-mode:nth-child(2)"); await sleep(250);
console.log("request chips:", await page.evaluate(() => [...document.querySelectorAll(".notelens-assistant-request")].map(c => c.textContent)));
const canvas = await page.evaluate(() => { const c = document.querySelector(".notelens-assistant-sketch canvas"); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top }; });
await page.mouse.move(canvas.x + 40, canvas.y + 100); await page.mouse.down();
for (const [dx, dy] of [[90, 40], [140, 110], [210, 40]]) await page.mouse.move(canvas.x + dx, canvas.y + dy, { steps: 4 });
await page.mouse.up(); await sleep(250);
// sending with no request and no text must not invent a question
await page.click(".notelens-assistant-send"); await sleep(500);
console.log("without choosing:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));
console.log("nothing was sent:", sent === null);
await shot(page, "91-request-chips");
// now pick one
await page.evaluate(() => [...document.querySelectorAll(".notelens-assistant-request")].find(c => c.textContent === "Resuélvelo").click());
await page.click(".notelens-assistant-send"); await sleep(900);
console.log("prompt actually sent:", sent?.messages?.find(m => m.role === "user")?.content);
console.log("carried the drawing:", !!sent?.messages?.some(m => m.images?.length));
console.log("console issues:\n" + (errors.length ? errors.slice(0, 6).join("\n") : "(none)"));
await browser.close();
