// Fixed name, a chat that pops out of Leen wherever he is, and installing Ollama.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots34"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
let serverUp = true;
await page.setRequestInterception(true);
page.on("request", (req) => {
	const url = req.url();
	if (!url.includes("11434")) return void req.continue();
	if (!serverUp) return void req.abort("connectionrefused");
	if (url.endsWith("/api/tags")) return void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llava:7b" }] }) });
	req.respond({ status: 404, contentType: "application/json", body: "{}" });
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const drag = async (pts, steps = 5) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps }); await page.mouse.up(); };
const petCentre = () => page.evaluate(() => { const r = document.querySelector(".notelens-pet").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });

// ---- the name is a fixed label, not an editable field
await clean();
await page.click(".notelens-pet"); await sleep(700);
console.log("name element:", await page.evaluate(() => {
	const el = document.querySelector(".notelens-assistant-name");
	return { tag: el.tagName, text: el.textContent, editable: el.tagName === "INPUT" || el.isContentEditable };
}));

// ---- the chat sits beside the cat, wherever he is
const corners = [["arriba izquierda", 160, 150], ["arriba derecha", 1250, 150], ["abajo izquierda", 160, 760], ["abajo derecha", 1250, 760]];
for (const [label, x, y] of corners) {
	const from = await petCentre();
	await drag([[from.x, from.y], [x, y]], 6);
	await sleep(450);
	const layout = await page.evaluate(() => {
		const board = document.querySelector(".onenote-workspace").getBoundingClientRect();
		const pet = document.querySelector(".notelens-pet").getBoundingClientRect();
		const chat = document.querySelector(".notelens-assistant").getBoundingClientRect();
		const gapLeft = Math.round(pet.left - chat.right);
		const gapRight = Math.round(chat.left - pet.right);
		return {
			side: chat.left > pet.left ? "derecha" : "izquierda",
			gap: Math.max(gapLeft, gapRight),
			insideBoard: chat.left >= board.left - 1 && chat.right <= board.right + 1 && chat.top >= board.top - 1 && chat.bottom <= board.bottom + 1,
			verticalOverlap: Math.round(Math.min(chat.bottom, pet.bottom) - Math.max(chat.top, pet.top))
		};
	});
	console.log(`${label}: chat a la ${layout.side}, separación ${layout.gap}px, dentro de la pizarra ${layout.insideBoard}, solapa ${layout.verticalOverlap}px con el gato`);
	await shot(page, `60-chat-${label.replace(/ /g, "-")}`);
}

// ---- with nothing installed the plugin offers to install Ollama
serverUp = false;
await page.evaluate(() => {
	// Pretend Electron is here and that `ollama --version` fails but the install works.
	window.process = { platform: "win32" };
	window.__ranCommands = [];
	let installed = false;
	window.require = (id) => {
		if (id !== "child_process") throw new Error("no module " + id);
		return {
			spawn(cmd, args) {
				window.__ranCommands.push([cmd, ...args].join(" "));
				const handlers = {};
				setTimeout(() => {
					const ok = cmd === "ollama" && args[0] === "--version" ? installed : true;
					if (cmd === "winget") installed = true;
					handlers.close?.(ok ? 0 : 1);
				}, 30);
				return { unref() {}, on(event, fn) { handlers[event] = fn; } };
			}
		};
	};
});
await page.click(".notelens-pet"); await sleep(200);
await page.click(".notelens-pet"); await sleep(1400);
console.log("status when Ollama is missing:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));
const button = await page.evaluate(() => { const b = document.querySelector(".notelens-assistant-server"); return { hidden: b.classList.contains("hidden"), label: b.textContent }; });
console.log("install button:", JSON.stringify(button));
await shot(page, "61-install-offer");
if (!button.hidden) {
	await page.click(".notelens-assistant-server"); await sleep(1600);
	console.log("commands the plugin ran:", await page.evaluate(() => window.__ranCommands));
	console.log("status after installing:", await page.evaluate(() => document.querySelector(".notelens-assistant-status").textContent));
}
console.log("console issues:\n" + (errors.length ? errors.slice(0, 6).join("\n") : "(none)"));
await browser.close();
