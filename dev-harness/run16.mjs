import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots16");
fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + ".png") }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const editorValue = () => page.evaluate(() => {
	const ed = document.querySelector(".notelens-text-editor");
	if (!ed) return null;
	return ed.value !== undefined ? ed.value : ed.innerText;
});
const clickBar = async (title) => { await page.evaluate((t) => document.querySelector(`.notelens-format-bar button[title='${t}']`).click(), title); await sleep(60); };

// lists and alignment
await tool("text"); await page.mouse.click(400, 300); await sleep(120);
await page.keyboard.type("Primer punto");
await page.keyboard.press("Enter"); await page.keyboard.type("Segundo punto");
await page.keyboard.press("Enter"); await page.keyboard.type("Tercero");
await clickBar("Lista con viñetas (•)");
console.log("bullets:", JSON.stringify(await editorValue()));
await page.keyboard.press("End"); await page.keyboard.press("Enter"); await page.keyboard.type("Cuarto");
console.log("enter continues:", JSON.stringify(await editorValue()));
await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
console.log("empty item ends list:", JSON.stringify(await editorValue()));
await clickBar("Lista numerada (1. 2. 3.)");
console.log("numbered:", JSON.stringify(await editorValue()));
await clickBar("Lista con flechas (→)");
console.log("arrows:", JSON.stringify(await editorValue()));
await clickBar("Lista con flechas (→)");
console.log("toggle off:", JSON.stringify(await editorValue()));
await clickBar("Lista con viñetas (•)");
await clickBar("Centrar");
console.log("align:", await page.evaluate(() => [__view.data.texts[0].align, document.querySelector(".notelens-text-editor").style.textAlign]));
await shot(page, "01-lists");
console.log("format bar X:", await page.evaluate(() => !!document.querySelector(".notelens-format-close")));
await page.evaluate(() => document.querySelector(".notelens-format-close").click());
await sleep(120);
console.log("closed via X:", await page.evaluate(() => [!document.querySelector(".notelens-text-editor"), __view.data.texts[0].text.split("\\n").length, getComputedStyle(document.querySelector(".onenote-textbox")).textAlign]));

// selection frame X deletes ink
await tool("pen"); await page.mouse.click(700, 700);
await page.mouse.move(600, 600); await page.mouse.down(); await page.mouse.move(900, 620, { steps: 5 }); await page.mouse.up();
await tool("select"); await page.mouse.move(580, 580); await page.mouse.down(); await page.mouse.move(920, 640, { steps: 4 }); await page.mouse.up();
await sleep(80);
console.log("selected strokes:", await page.evaluate(() => __view.selStrokes.size), "frame X:", await page.evaluate(() => !!document.querySelector(".notelens-selection-action[title^='Eliminar']")));
await page.evaluate(() => document.querySelector(".notelens-selection-action[title^='Eliminar']").click());
await sleep(80);
console.log("strokes after X:", await page.evaluate(() => __view.data.strokes.length));

// ruler X
await page.click(".notelens-document-dock button[title='Mostrar regla inteligente']");
await sleep(80);
console.log("ruler shown:", await page.evaluate(() => !document.querySelector(".notelens-smart-ruler").classList.contains("hidden")), "ruler X:", await page.evaluate(() => !!document.querySelector(".notelens-ruler-close")));
await page.evaluate(() => document.querySelector(".notelens-ruler-close").click());
await sleep(80);
console.log("ruler hidden via X:", await page.evaluate(() => document.querySelector(".notelens-smart-ruler").classList.contains("hidden")));

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
