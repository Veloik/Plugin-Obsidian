// The equation dialog with its two ways in: handwriting and keyboard, both
// feeding one notation and one preview.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots59");
fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + ".png") }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 980, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));

await page.click(".notelens-insert-dock button[title^='Insertar ecuación']");
await sleep(300);

const state = () => page.evaluate(() => {
	const vis = (sel) => { const el = document.querySelector(sel); return !!el && !el.classList.contains("hidden") && el.getBoundingClientRect().height > 0; };
	return {
		modes: [...document.querySelectorAll(".notelens-ink-mode")].map(b => b.textContent.trim() + (b.classList.contains("active") ? "*" : "")),
		board: vis(".notelens-ink-board"),
		tools: vis(".notelens-ink-tools"),
		keyboard: vis(".notelens-ink-keyboard"),
		structures: vis(".notelens-ink-structures"),
		keys: document.querySelectorAll(".notelens-ink-key").length,
		groups: [...document.querySelectorAll(".notelens-ink-group")].map(b => b.textContent.trim())
	};
});
console.log("a mano:", JSON.stringify(await state()));
await shot(page, "01-hand");

// draw something, then switch to the keyboard and finish it there
const canvas = await page.evaluate(() => { const r = document.querySelector(".notelens-ink-board canvas").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
await page.mouse.move(canvas[0] + 60, canvas[1] + 90);
await page.mouse.down();
for (let i = 0; i <= 20; i++) await page.mouse.move(canvas[0] + 60 + i * 4, canvas[1] + 90 - Math.sin(i / 3) * 22, { steps: 2 });
await page.mouse.up();
await sleep(900);
console.log("tras escribir a mano, notación:", JSON.stringify(await page.evaluate(() => document.querySelector(".notelens-ink-source").value)));

await page.evaluate(() => [...document.querySelectorAll(".notelens-ink-mode")].find(b => /Teclado|Keyboard/.test(b.textContent)).click());
await sleep(250);
console.log("teclado:", JSON.stringify(await state()));
await shot(page, "02-keyboard");

// a key from every group types into the same field
const typed = [];
for (const group of ["Básico", "Cálculo", "Griego", "Matrices"]) {
	await page.evaluate((g) => document.querySelector(`.notelens-ink-group[data-group="${g}"]`).click(), group);
	await sleep(120);
	await page.evaluate(() => { const f = document.querySelector(".notelens-ink-source"); f.value = ""; f.dispatchEvent(new Event("input")); });
	await page.evaluate(() => document.querySelectorAll(".notelens-ink-key")[0].click());
	await sleep(150);
	typed.push([group, await page.evaluate(() => document.querySelector(".notelens-ink-source").value)]);
}
console.log("teclas:", JSON.stringify(typed));
await shot(page, "03-keys");

// the preview follows what was typed, and Insertar places it
await page.evaluate(() => {
	const f = document.querySelector(".notelens-ink-source");
	f.value = "sum_(n=1)^oo 1/n^2 = pi^2/6";
	f.dispatchEvent(new Event("input"));
});
await sleep(400);
console.log("vista previa:", await page.evaluate(() => ({ mjx: !!document.querySelector(".notelens-ink-preview mjx-container"), error: !!document.querySelector(".notelens-ink-preview mjx-merror") })));
await shot(page, "04-preview");
await page.evaluate(() => [...document.querySelectorAll(".modal button")].find(b => b.textContent.trim() === "Insertar").click());
await sleep(400);
console.log("colocada:", await page.evaluate(() => __view.data.texts.map(t => t.text)));

console.log("console issues:", errors.length ? errors.slice(0, 3) : "(none)");
await browser.close();
