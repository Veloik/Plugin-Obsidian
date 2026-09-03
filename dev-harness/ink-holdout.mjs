// Reads real handwriting the prototype builder never saw and reports how much
// of it the recogniser names correctly, per symbol.
//
//   python dev-harness/make-holdout.py handtex.db holdout.json
//   node dev-harness/ink-holdout.mjs holdout.json
//
// The samples are ODbL data and are not in the repository; generate them where
// you need them.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
	console.error("uso: node dev-harness/ink-holdout.mjs <holdout.json>");
	process.exit(1);
}
const cases = JSON.parse(fs.readFileSync(file, "utf8"));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security"],
	defaultViewport: { width: 900, height: 700 }
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

const results = [];
const CHUNK = 200;
for (let i = 0; i < cases.length; i += CHUNK) {
	const slice = cases.slice(i, i + CHUNK);
	results.push(...await page.evaluate((batch) => batch.map(c => ({
		expected: c.expected,
		got: window.__assistantTest.recognizeInkFormula(c.strokes.map(points => ({ points }))).source.replace(/\s+/g, "")
	})), slice));
}

const perSymbol = new Map();
for (const r of results) {
	const entry = perSymbol.get(r.expected) ?? { ok: 0, total: 0, wrong: new Map() };
	entry.total++;
	if (r.got === r.expected) entry.ok++;
	else entry.wrong.set(r.got, (entry.wrong.get(r.got) ?? 0) + 1);
	perSymbol.set(r.expected, entry);
}
const rows = [...perSymbol].sort((a, b) => a[1].ok / a[1].total - b[1].ok / b[1].total);
for (const [symbol, entry] of rows) {
	const worst = [...entry.wrong].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, n]) => `${v || "∅"}×${n}`).join(" ");
	console.log(`${String(Math.round(entry.ok / entry.total * 100)).padStart(3)} %  ${symbol.padEnd(10)} ${entry.ok}/${entry.total}   ${worst}`);
}
const ok = results.filter(r => r.got === r.expected).length;
const unknown = results.filter(r => r.got === "?").length;
console.log(`\nACIERTO sobre escritura real no vista: ${ok}/${results.length} (${Math.round(ok / results.length * 100)} %)`);
console.log(`de los fallos, ${unknown} dicen "?" en vez de inventar (${Math.round(unknown / Math.max(1, results.length - ok) * 100)} %)`);
await browser.close();
