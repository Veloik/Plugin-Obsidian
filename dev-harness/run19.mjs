import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots19");
fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + ".png") }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 }
});
const context = browser.defaultBrowserContext();
await context.overridePermissions(pathToFileURL(here).href.replace(/\/$/, ""), ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]).catch(() => {});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const drag = async (pts) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 4 }); await page.mouse.up(); };
const counts = () => page.evaluate(() => [__view.data.strokes.length, __view.data.texts.length, __view.selStrokes.size + __view.selTexts.size]);
// Fake system clipboard so the paste event carries what Ctrl+C wrote.
await page.evaluate(() => {
	window.__clip = "";
	navigator.clipboard.writeText = async (t) => { window.__clip = t; };
	window.__paste = () => { const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }); ev.clipboardData.setData("text/plain", window.__clip); window.dispatchEvent(ev); };
});

// copy / paste a stroke and a text box
await tool("pen"); await page.mouse.click(700, 700);
await drag([[300, 400], [450, 430], [600, 400]]);
await tool("text"); await page.mouse.click(1000, 380); await sleep(100); await page.keyboard.type("Copiado"); await page.mouse.click(1200, 820); await sleep(120);
await tool("select");
await drag([[260, 340], [1250, 480]]);
await sleep(80);
console.log("selected:", await counts());
await page.keyboard.down("Control"); await page.keyboard.press("c"); await page.keyboard.up("Control");
await sleep(80);
console.log("clipboard has payload:", await page.evaluate(() => window.__clip.startsWith("notelens-clip:")), "memory:", await page.evaluate(() => !!__view.clipboardPayload));
await page.mouse.move(700, 650);
await page.evaluate(() => window.__paste());
await sleep(200);
console.log("after paste:", await counts(), "pasted text y:", await page.evaluate(() => Math.round(__view.data.texts[1].y)));
await shot(page, "01-pasted");
// cut
await page.keyboard.down("Control"); await page.keyboard.press("x"); await page.keyboard.up("Control");
await sleep(80);
console.log("after cut:", await counts());
// plain text paste creates a text box
await page.evaluate(() => { window.__clip = "Texto pegado desde fuera"; window.__paste(); });
await sleep(150);
console.log("plain text paste:", JSON.stringify(await page.evaluate(() => __view.data.texts.map(t => t.text))));

// calculator fractions
await page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
await page.click(".notelens-document-dock button[title='Calculadora científica']");
await sleep(100);
const calc = async (expr) => {
	await page.evaluate(() => { document.querySelector(".notelens-calculator-input").value = ""; });
	await page.focus(".notelens-calculator-input");
	await page.keyboard.type(expr);
	await sleep(30);
	const r = await page.evaluate(() => [document.querySelector(".notelens-calculator-output").textContent, document.querySelector(".notelens-calculator-alt").textContent]);
	await page.keyboard.press("Enter"); await sleep(30);
	return r;
};
for (const expr of ["2/3 + 1/6", "1 1/2 + 3/4", "7/4", "3/4 * 2", "0.5 + 0.25", "1/3"]) console.log(expr.padEnd(14), "=>", JSON.stringify(await calc(expr)));
await page.click(".notelens-calculator-unit[title^='Mostrar los resultados']");
console.log("fraction mode:", JSON.stringify(await calc("0.5 + 0.25")));
await shot(page, "02-fractions");

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
