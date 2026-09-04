import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots6");
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
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"), "mathjax:", await page.evaluate(() => !!(window.MathJax && window.MathJax.tex2chtml)));
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const texts = () => page.evaluate(() => __view.data.texts.map(t => ({ text: t.text, variant: t.variant, w: t.w })));

// --- calculator
await page.click(".notelens-document-dock button[title='Calculadora científica']");
await sleep(100);
await page.keyboard.type("2sin(30)^2 + sqrt(16) + 5!");
await sleep(80);
console.log("calc preview:", await page.evaluate(() => document.querySelector(".notelens-calculator-output").textContent));
await page.keyboard.press("Enter");
await sleep(80);
await page.keyboard.type("ans / 3");
await page.keyboard.press("Enter");
await sleep(80);
console.log("history:", await page.evaluate(() => [...document.querySelectorAll(".notelens-calculator-entry")].map(e => e.textContent)));
await page.keyboard.type("ln(0");
await sleep(50);
console.log("error text:", await page.evaluate(() => document.querySelector(".notelens-calculator-output").textContent));
await page.click(".notelens-calculator-key.muted[title='Limpiar']");
await page.keyboard.type("3.5!");
await page.click(".notelens-calculator-key.insert");
await sleep(150);
console.log("inserted:", JSON.stringify(await texts()));
await shot(page, "01-calculator");
await page.click(".notelens-calculator-header .notelens-embed-close");

// --- math block
await page.click(".notelens-insert-dock button[title^='Insertar ecuación']");
await sleep(150);
await page.keyboard.type("\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}");
await sleep(300);
console.log("preview has mjx:", await page.evaluate(() => !!document.querySelector(".notelens-math-preview mjx-container")));
await shot(page, "02-math-editing");
await page.mouse.click(1200, 820);
await sleep(300);
console.log("math block rendered:", await page.evaluate(() => !!document.querySelector(".notelens-math-block mjx-container")), JSON.stringify(await texts()));

// --- inline math inside a normal text box
await tool("text");
await page.mouse.click(300, 700);
await sleep(120);
await page.keyboard.type("La energia es $E = mc^2$ y la suma $$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$");
await page.mouse.click(1200, 820);
await sleep(300);
console.log("inline mjx count:", await page.evaluate(() => document.querySelectorAll(".onenote-textbox:not(.notelens-math-block) mjx-container").length));
await shot(page, "03-inline-math");

// --- grid size from the background panel
await page.click(".notelens-settings-btn");
await sleep(80);
await page.evaluate(() => [...document.querySelectorAll(".notelens-settings-panel .notelens-settings-choice")].find(b => b.textContent.trim() === "Grande").click());
await sleep(80);
console.log("grid size:", await page.evaluate(() => [__view.data.gridSize, getComputedStyle(document.querySelector('.onenote-workspace')).backgroundSize]));
await shot(page, "04-grid-large");
await page.mouse.click(1000, 300);

// --- settings switches applied on open
await page.evaluate(() => { __view.plugin.settings.compactUi = true; __view.plugin.settings.showQuickTags = false; __view.applySettings(); });
await sleep(80);
await shot(page, "05-compact");

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
