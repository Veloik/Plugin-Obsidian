// PDF export with formulas: the page must carry pictures of the typeset
// maths, not the notation the user typed.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots53");
fs.mkdirSync(shots, { recursive: true });
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
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));

const insertViaDialog = async (notation) => {
	await page.click(".notelens-insert-dock button[title^='Insertar ecuación']");
	await sleep(250);
	await page.click(".notelens-ink-source");
	await page.keyboard.type(notation);
	await sleep(300);
	await page.evaluate(() => [...document.querySelectorAll(".modal button")].find(b => b.textContent.trim() === "Insertar").click());
	await sleep(400);
};
await insertViaDialog("sum_(n=1)^oo 1/n^2 = pi^2/6");
await page.evaluate(() => { const t = __view.data.texts[0]; t.x = 120; t.y = 200; });
await insertViaDialog("x = (-b +- sqrt(b^2-4ac))/(2a)");
await page.evaluate(() => { const t = __view.data.texts[1]; t.x = 120; t.y = 320; __view.data.texts.forEach(t => __view.renderTextBox ? null : null); });
// a plain text box too, so ordinary text still exports as text
await page.click(".onenote-ribbon-dock [data-tool=\"text\"]");
await page.mouse.click(200, 600);
await sleep(200);
await page.keyboard.type("Texto normal junto a las formulas");
await page.keyboard.press("Escape");
await sleep(200);

// direct check of the rasteriser on the first formula
const raster = await page.evaluate(async () => {
	const el = document.querySelector(".notelens-math-block mjx-container");
	const t0 = performance.now();
	const img = await __view.constructor.prototype.rasterizeFormulas.call(__view, __view.data);
	const first = [...img.values()][0];
	return { count: img.size, ms: Math.round(performance.now() - t0), first: first ? { w: first.width, h: first.height, dx: first.dx, dy: first.dy, png: first.dataUrl.startsWith("data:image/png"), bytes: first.dataUrl.length } : null };
});
console.log("raster:", JSON.stringify(raster));
const firstPng = await page.evaluate(async () => { const img = await __view.constructor.prototype.rasterizeFormulas.call(__view, __view.data); return [...img.values()].map(i => i.dataUrl); });
firstPng.forEach((d, i) => fs.writeFileSync(path.join(shots, `formula-${i + 1}.png`), Buffer.from(d.split(",")[1], "base64")));
console.log("pngs escritos:", firstPng.length);

// export: capture the bytes the vault would receive
await page.evaluate(() => {
	__view.app.vault.createBinary = async (p, data) => { window.__pdf = { path: p, bytes: Array.from(new Uint8Array(data)) }; return new window.__TFile(p); };
	__view.app.vault.getAbstractFileByPath = () => null;
});
await page.click(".notelens-utility-dock button[title='Exportar a PDF A4'], button[title='Exportar a PDF A4']");
await sleep(2500);
const pdf = await page.evaluate(() => window.__pdf ? { path: window.__pdf.path, size: window.__pdf.bytes.length } : null);
console.log("pdf:", JSON.stringify(pdf));
if (pdf) {
	const bytes = Buffer.from(await page.evaluate(() => window.__pdf.bytes));
	fs.writeFileSync(path.join(shots, "export.pdf"), bytes);
	const text = bytes.toString("latin1");
	console.log("images in pdf:", (text.match(/\/Subtype ?\/Image/g) || []).length, "| source leaked as text:", /sum_\(n=1\)|sqrt\(b\^2/.test(text), "| plain text present:", /Texto normal/.test(text));
}
console.log("console issues:", errors.length ? "\n" + errors.join("\n") : "(none)");
await browser.close();
