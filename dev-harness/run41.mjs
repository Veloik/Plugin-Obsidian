// Multimodal-only catalogue with a picker, and the fuller LaTeX palette.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots41"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
let catalogue = [];
await page.setRequestInterception(true);
page.on("request", (r) => { const u = r.url(); if (!u.includes("11434")) return void r.continue(); if (u.endsWith("/api/tags")) return void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: catalogue }) }); r.respond({ status: 404, contentType: "application/json", body: "{}" }); });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const reopen = async () => {
	await clean();
	if (await page.evaluate(() => !document.querySelector(".notelens-assistant").classList.contains("hidden"))) { await page.click(".notelens-pet"); await sleep(200); }
	await page.click(".notelens-pet"); await sleep(1100);
	return page.evaluate(() => ({
		status: document.querySelector(".notelens-assistant-status").textContent,
		chooser: document.querySelector(".notelens-assistant-chooser").classList.contains("hidden") ? null : [...document.querySelector(".notelens-assistant-chooser-select").options].map(o => o.text),
		options: [...document.querySelector(".notelens-assistant-model").options].map(o => o.text)
	}));
};

// ---- the catalogue this machine can run
console.log("options for 4 / 8 / 16 / 64 GB:", await page.evaluate(() => {
	const t = window.__assistantTest;
	return { g4: t.visionOptionsFor(4).map(o => o.model), g8: t.visionOptionsFor(8).map(o => o.model), g16: t.visionOptionsFor(16).map(o => o.model), g64: t.visionOptionsFor(64).length };
}));
console.log("a 2 GB machine gets nothing:", await page.evaluate(() => window.__assistantTest.visionOptionsFor(2).length === 0));

// ---- text-only models are not enough for Leen
catalogue = [{ name: "llama3.2:3b" }, { name: "qwen2.5:7b" }];
const textOnly = await reopen();
console.log("only text models:", JSON.stringify({ status: textOnly.status, options: textOnly.options }));
console.log("picker offered:", textOnly.chooser ? textOnly.chooser.length + " modelos" : "no");
await page.screenshot({ path: path.join(shots, "130-needs-multimodal.png"), clip: { x: 940, y: 150, width: 460, height: 420 } });

// ---- with a multimodal model it just works
catalogue = [{ name: "llama3.2:3b" }, { name: "qwen2.5vl:7b" }];
const withVision = await reopen();
console.log("with a multimodal model:", JSON.stringify(withVision.options), "·", withVision.status.slice(0, 70));
console.log("text-only model hidden from the list:", !withVision.options.some(o => o.includes("llama3.2")));

// ---- the LaTeX palette
// The palette belongs to editing a formula, which the ink dialog inserts.
await page.evaluate(() => { __view.setTool("select"); __view.createTextBoxAt(420, 400, undefined, "math"); });
await sleep(400);
const math = await page.evaluate(() => {
	const groups = [...document.querySelectorAll(".notelens-math-group")].map(g => g.textContent);
	const keys = [...document.querySelectorAll(".notelens-math-key")].map(k => k.textContent);
	return { groups, firstGroupKeys: keys.length };
});
console.log("palette groups:", JSON.stringify(math.groups), "· teclas del primer grupo:", math.firstGroupKeys);
if (math.groups.includes("Conjuntos")) {
	await page.evaluate(() => [...document.querySelectorAll(".notelens-math-group")].find(g => g.textContent === "Conjuntos").click());
	await sleep(200);
	console.log("Conjuntos:", await page.evaluate(() => [...document.querySelectorAll(".notelens-math-key")].map(k => k.textContent).join(" ")));
	await page.evaluate(() => [...document.querySelectorAll(".notelens-math-key")].find(k => k.textContent === "∈").click());
	await sleep(150);
	console.log("insertado:", await page.evaluate(() => document.querySelector(".notelens-text-editor")?.value));
}
await page.screenshot({ path: path.join(shots, "131-latex-palette.png") });
console.log("console issues:", errors.length ? errors.join("\n") : "(none)");
await browser.close();
