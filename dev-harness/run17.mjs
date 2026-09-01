import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots17");
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

await page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
await page.click(".notelens-document-dock button[title='Calculadora científica']");
await sleep(100);
const calc = async (expr) => {
	await page.evaluate(() => { const i = document.querySelector(".notelens-calculator-input"); i.value = ""; });
	await page.focus(".notelens-calculator-input");
	await page.keyboard.type(expr);
	await sleep(30);
	const preview = await page.evaluate(() => [document.querySelector(".notelens-calculator-output").textContent, document.querySelector(".notelens-calculator-alt").textContent]);
	await page.keyboard.press("Enter");
	await sleep(30);
	return preview;
};
const cases = [
	["2sin(30)^2 + sqrt(16)", "4.5"], ["200 + 15%", "230"], ["30% * 80", "24"], ["50 - 10%", "45"],
	["a = 3", "3"], ["2a + 1", "7"], ["r = 2", "2"], ["pi r^2", "12.566370614"],
	["5 km to mi", "3.1068559612 mi"], ["20 C to F", "68 F"], ["1 h to min", "60 min"], ["2 GB to MB", "2000 MB"], ["90 deg to rad", "1.5707963268 rad"],
	["sum(i^2, i, 1, 10)", "385"], ["prod(i, i, 1, 5)", "120"], ["integral(x^2, x, 0, 1)", "0.33333333333"], ["deriv(x^3, x, 2)", "12"], ["solve(x^2 - 2, x, 1)", "1.4142135624"],
	["mean(4, 7, 9)", "6.6666666667"], ["median(1, 5, 3)", "3"], ["stdev(2, 4, 4, 4, 5, 5, 7, 9)", "2.1380899353"],
	["0xFF + 0b101", "260"], ["10 mod 3", "1"], ["7!", "5040"], ["ncr(5, 2)", "10"], ["3/4", "3/4"], ["ans * 2", "1.5"]
];
let fails = 0;
for (const [expr, expected] of cases) {
	const [out, alt] = await calc(expr);
	const ok = out === expected;
	if (!ok) fails++;
	console.log((ok ? "ok  " : "FAIL") + `  ${expr.padEnd(32)} => ${out}${alt ? "   " + alt : ""}${ok ? "" : "   (esperado " + expected + ")"}`);
}
console.log("variables shown:", await page.evaluate(() => [...document.querySelectorAll(".notelens-calculator-var")].map(v => v.textContent)));
await page.evaluate(() => [...document.querySelectorAll(".notelens-calculator-tab")].find(t => t.textContent === "Avanzada").click());
await sleep(50);
await shot(page, "01-calculator-advanced");
console.log("advanced keys:", await page.evaluate(() => document.querySelectorAll(".notelens-calculator-key").length));
await page.evaluate(() => [...document.querySelectorAll(".notelens-calculator-tab")].find(t => t.textContent === "Unidades").click());
await sleep(50);
await shot(page, "02-calculator-units");
await page.click(".notelens-calculator-header .notelens-embed-close");

// tables without a forced header
await page.click(".notelens-insert-dock button[title='Insertar tabla']");
await sleep(150);
console.log("new table:", await page.evaluate(() => { const t = __view.data.tables[0]; return { header: t.header, firstRow: t.cells[0], headerCells: document.querySelectorAll(".notelens-table-cell.is-header").length }; }));
await page.evaluate(() => document.querySelector(".notelens-table-control[title^='Usar la primera fila']").click());
await sleep(100);
console.log("after header toggle:", await page.evaluate(() => ({ header: __view.data.tables[0].header, headerCells: document.querySelectorAll(".notelens-table-cell.is-header").length })));
await page.evaluate(() => { const t = __view.data.tables[0]; t.headerColumn = true; __view.renderAll(); });
await sleep(100);
console.log("header column cells:", await page.evaluate(() => document.querySelectorAll(".notelens-table-cell.is-header-column").length));
await shot(page, "03-table");
console.log(fails ? `${fails} calculator cases failed` : "all calculator cases passed");
console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
