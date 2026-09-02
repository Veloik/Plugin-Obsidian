// The assistant pet: name, board actions, drawing to it, and model ranking.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots31"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

// A fake local server: it lists models and replies with board actions.
let reply = "Aquí tienes.";
let lastRequest = null;
await page.setRequestInterception(true);
page.on("request", (req) => {
	const url = req.url();
	if (!url.includes("11434")) return void req.continue();
	if (url.endsWith("/api/tags")) {
		return void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [
			{ name: "nomic-embed-text" }, { name: "deepseek-coder:33b" }, { name: "qwen2.5:7b" }, { name: "llava:13b" }, { name: "llama3.2:1b" }
		] }) });
	}
	if (url.endsWith("/api/chat")) {
		lastRequest = JSON.parse(req.postData() || "{}");
		return void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ message: { role: "assistant", content: reply } }) });
	}
	req.respond({ status: 404, contentType: "application/json", body: "{}" });
});

await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));

// ---- the pet has a name and the chat greets with it
await clean();
await page.click(".notelens-pet"); await sleep(700);
console.log("name field:", await page.evaluate(() => document.querySelector(".notelens-assistant-name").value));
console.log("greeting:", await page.evaluate(() => document.querySelector(".notelens-assistant-empty div").textContent.slice(0, 60)));

// ---- model ranking: embeddings dropped, coder demoted, best marked
console.log("model options:", await page.evaluate(() => [...document.querySelector(".notelens-assistant-model").options].map(o => o.text)));
console.log("status:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));
await shot(page, "30-chat-model-choice", { x: 940, y: 150, width: 450, height: 740 });

// ---- the assistant writes on the board by itself
reply = "Te lo dejo apuntado.\n[[posit:verde]]Repasar derivadas[[/posit]]\n[[latex]]x^2/2 + sqrt(x)[[/latex]]\n[[tarea]]Práctica 3; Leer el enunciado; Resolver; Entregar[[/tarea]]";
const before = await page.evaluate(() => ({ texts: __view.data.texts.length, badges: __view.data.badges.length }));
await page.focus(".notelens-assistant-input");
await page.keyboard.type("Apúntame el repaso");
await page.keyboard.press("Enter");
await sleep(900); await clean();
const after = await page.evaluate(() => ({
	texts: __view.data.texts.length,
	badges: __view.data.badges.length,
	sticky: __view.data.texts.filter(t => t.stickyColor).map(t => ({ color: t.stickyColor, text: t.text })),
	math: __view.data.texts.filter(t => t.variant === "math").map(t => t.text),
	task: __view.data.badges.filter(b => b.tagId === "tag_todo").map(b => ({ title: b.title, steps: (b.checklist || []).map(s => s.text) }))
}));
console.log("before:", JSON.stringify(before));
console.log("after:", JSON.stringify(after, null, 1));
console.log("chat reports:", await page.evaluate(() => document.querySelector(".notelens-assistant-msg.is-assistant .notelens-assistant-msg-text").textContent));
await shot(page, "31-actions-on-board");

// ---- talking with a drawing
await page.click(".notelens-assistant-mode:nth-child(2)"); await sleep(200);
const canvas = await page.evaluate(() => { const c = document.querySelector(".notelens-assistant-sketch canvas"); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
await page.mouse.move(canvas.x + 40, canvas.y + 100); await page.mouse.down();
for (const [dx, dy] of [[80, 40], [120, 100], [180, 30], [240, 90]]) await page.mouse.move(canvas.x + dx, canvas.y + dy, { steps: 4 });
await page.mouse.up(); await sleep(250);
await shot(page, "32-sketch-composer", { x: 940, y: 150, width: 450, height: 740 });
// a text-only model must refuse images with a clear reason
await page.select(".notelens-assistant-model", "qwen2.5:7b"); await sleep(400);
reply = "Veo una función con dos máximos.";
await page.click(".notelens-assistant-send"); await sleep(800);
console.log("text model with a drawing:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));
// the vision model accepts it and receives the image
await page.select(".notelens-assistant-model", "llava:13b"); await sleep(400);
await page.click(".notelens-assistant-mode:nth-child(2)"); await sleep(150);
await page.mouse.move(canvas.x + 40, canvas.y + 60); await page.mouse.down();
for (const [dx, dy] of [[90, 110], [150, 50], [220, 120]]) await page.mouse.move(canvas.x + dx, canvas.y + dy, { steps: 4 });
await page.mouse.up(); await sleep(200);
await page.click(".notelens-assistant-send"); await sleep(900);
console.log("vision request carried an image:", await page.evaluate(() => true) && !!(lastRequest?.messages?.some(m => m.images?.length)));
console.log("model used:", lastRequest?.model);
console.log("messages now:", await page.evaluate(() => document.querySelectorAll(".notelens-assistant-msg").length));
await shot(page, "33-vision-answer", { x: 940, y: 150, width: 450, height: 740 });
console.log("console issues:\n" + (errors.length ? errors.slice(0, 6).join("\n") : "(none)"));
await browser.close();
