// Assistant pet: sprites, chat panel, local-model client and its failure modes.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots30"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

// Stand in for a local model server so the test never needs one running.
await page.setRequestInterception(true);
let mode = "ollama";
page.on("request", (req) => {
	const url = req.url();
	if (!url.includes("11434")) return void req.continue();
	if (mode === "down") return void req.abort("connectionrefused");
	if (url.endsWith("/api/tags")) {
		return void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llama3.2:3b" }, { name: "qwen2.5:7b" }] }) });
	}
	if (url.endsWith("/api/chat")) {
		const sent = JSON.parse(req.postData() || "{}");
		const hasContext = /Apuntes de la pizarra/.test(sent.messages?.[0]?.content || "");
		return void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ message: { role: "assistant", content: `Respuesta local de ${sent.model}. Contexto: ${hasContext ? "sí" : "no"}.` } }) });
	}
	req.respond({ status: 404, contentType: "application/json", body: "{}" });
});

await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));

// The pet is on the board with the idle sprite.
console.log("pet:", await page.evaluate(() => {
	const pet = document.querySelector(".notelens-pet");
	const img = pet?.querySelector("img");
	return { present: !!pet, mood: pet?.getAttribute("data-mood"), spriteBytes: (img?.src || "").length, isPng: (img?.src || "").startsWith("data:image/png") };
}));
await shot(page, "20-pet-idle", { x: 1180, y: 680, width: 210, height: 200 });

// Some board content, so the context toggle has something to send.
await page.evaluate(() => {
	__view.data.texts.push({ id: "t1", pageId: __view.data.activePageId, x: 300, y: 300, text: "La derivada mide la tasa de cambio", fontSize: 20, color: "#f8fafc", variant: "text" });
	__view.renderAll();
});

// Clicking the cat opens the chat and lists the local models.
await clean();
await page.click(".notelens-pet"); await sleep(600);
console.log("panel open:", await page.evaluate(() => !document.querySelector(".notelens-assistant").classList.contains("hidden")));
console.log("models offered:", await page.evaluate(() => [...document.querySelector(".notelens-assistant-model").options].map(o => o.text)));
console.log("status:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));
await shot(page, "21-chat-open", { x: 940, y: 180, width: 450, height: 700 });

// Ask with the board as context.
await page.click(".notelens-assistant-context input");
await page.focus(".notelens-assistant-input");
await page.keyboard.type("Resume esto");
await page.keyboard.press("Enter");
await sleep(700);
console.log("messages:", await page.evaluate(() => [...document.querySelectorAll(".notelens-assistant-msg")].map(m => m.textContent.slice(0, 70))));
console.log("mood after answering:", await page.evaluate(() => document.querySelector(".notelens-pet").getAttribute("data-mood")));
await shot(page, "22-chat-answer", { x: 940, y: 180, width: 450, height: 700 });

// The answer can be dropped on the board.
const before = await page.evaluate(() => __view.data.texts.length);
await page.click(".notelens-assistant-msg.is-assistant .notelens-assistant-action");
await sleep(400); await clean();
console.log("texts before/after inserting:", before, await page.evaluate(() => __view.data.texts.length));
console.log("inserted text:", await page.evaluate(() => __view.data.texts[__view.data.texts.length - 1].text.slice(0, 60)));

// With no server running the pet explains itself instead of failing silently.
mode = "down";
await page.evaluate(() => { document.querySelector(".notelens-assistant-model").value = ""; });
await page.click(".notelens-pet"); await sleep(200);
await page.click(".notelens-pet"); await sleep(900);
console.log("status with no server:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));
await shot(page, "23-chat-no-server", { x: 940, y: 180, width: 450, height: 700 });
console.log("console issues:\n" + (errors.length ? errors.slice(0, 6).join("\n") : "(none)"));
await browser.close();
