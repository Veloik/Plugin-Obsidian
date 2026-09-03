// Math boxes end to end: the equation dialog's notation field, the placed box,
// re-editing it with the live preview, and whether tall formulas fit.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots52");
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
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"), "mathjax:", await page.evaluate(() => !!window.MathJax));

const boxInfo = (index) => page.evaluate((i) => {
	const els = document.querySelectorAll(".notelens-math-block");
	const el = els[i < 0 ? els.length + i : i];
	if (!el) return "no box";
	const r = el.getBoundingClientRect();
	const m = (el.querySelector("mjx-math") || el.querySelector("mjx-container"))?.getBoundingClientRect();
	const err = !!el.querySelector("mjx-merror");
	const tb = __view.data.texts.find(t => t.id === el.getAttribute("data-id"));
	return { text: tb?.text, box: [Math.round(r.width), Math.round(r.height)], stored: [tb?.w, tb?.h], mjx: m ? [Math.round(m.width), Math.round(m.height)] : null, overflow: m ? (m.right > r.right + 1 || m.bottom > r.bottom + 1) : null, error: err };
}, index);

const insertViaDialog = async (notation) => {
	await page.click(".notelens-insert-dock button[title^='Insertar ecuación']");
	await sleep(250);
	await page.click(".notelens-ink-source");
	await page.keyboard.type(notation);
	await sleep(400);
	return page.evaluate(() => {
		const preview = document.querySelector(".notelens-ink-preview, .notelens-ink-equation-preview");
		return { previewMjx: !!document.querySelector(".modal mjx-container"), previewError: !!document.querySelector(".modal mjx-merror") };
	});
};

// 1. a classic through the dialog
console.log("dialog:", JSON.stringify(await insertViaDialog("sum_(n=1)^oo 1/n^2 = pi^2/6")));
await shot(page, "01-dialog-typed");
await page.evaluate(() => [...document.querySelectorAll(".modal button")].find(b => b.textContent.trim() === "Insertar").click());
await sleep(400);
console.log("placed:", JSON.stringify(await boxInfo(0)));
await shot(page, "02-placed");

// 2. re-edit it: double-click with select tool, type more, preview should follow
await page.click(".onenote-ribbon-dock [data-tool=\"select\"]");
{
	const r = await page.evaluate(() => { const b = document.querySelector(".notelens-math-block").getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
	await page.mouse.click(r[0], r[1], { clickCount: 2 });
}
await sleep(250);
console.log("editor open:", await page.evaluate(() => !!document.querySelector(".notelens-math-editor")), "preview:", await page.evaluate(() => !!document.querySelector(".notelens-math-preview mjx-container")));
await page.keyboard.press("End");
await page.keyboard.type(", x_1, x_2, ..., x_n");
await sleep(300);
await shot(page, "03-editing-with-preview");
await page.keyboard.press("Escape");
await sleep(300);
console.log("after edit:", JSON.stringify(await boxInfo(0)));
await shot(page, "04-after-edit");

// 3. a tall one: matrix, cases, binomial
console.log("dialog tall:", JSON.stringify(await insertViaDialog("A = [[1,2,3],[4,5,6],[7,8,9]], f(x) = {(x^2, x>=0),(-x, x<0):}, ((n),(k))")));
await page.evaluate(() => [...document.querySelectorAll(".modal button")].find(b => b.textContent.trim() === "Insertar").click());
await sleep(400);
console.log("tall placed:", JSON.stringify(await boxInfo(-1)));
await shot(page, "05-tall");

// 4. unicode from a maths keyboard
console.log("dialog unicode:", JSON.stringify(await insertViaDialog("∫₀¹ x² dx ≈ π/√2 → ∞, α+β≠γ")));
await page.evaluate(() => [...document.querySelectorAll(".modal button")].find(b => b.textContent.trim() === "Insertar").click());
await sleep(400);
console.log("unicode placed:", JSON.stringify(await boxInfo(-1)));
await shot(page, "06-unicode");

// 5. inline $…$ in a plain text box
await page.click(".onenote-ribbon-dock [data-tool=\"text\"]");
await page.mouse.click(300, 700);
await sleep(200);
await page.keyboard.type("La solución es $x = (-b +- sqrt(b^2-4ac))/(2a)$ y luego $$e^(i pi) + 1 = 0$$");
await page.keyboard.press("Escape");
await sleep(300);
console.log("inline:", JSON.stringify(await page.evaluate(() => { const el = [...document.querySelectorAll(".onenote-textbox")].pop(); return { mjx: el.querySelectorAll("mjx-container").length, error: !!el.querySelector("mjx-merror"), h: el.getBoundingClientRect().height }; })));
await shot(page, "07-inline");

console.log("console issues:", errors.length ? "\n" + errors.join("\n") : "(none)");
await browser.close();
