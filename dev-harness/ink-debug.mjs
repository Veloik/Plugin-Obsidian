// Why did one case fail? Prints how the strokes were grouped into glyphs and
// what each group was read as, which separates a grouping bug from a
// classification one.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CASES } from "./ink-corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2);
const cases = CASES.filter(c => !wanted.length || wanted.includes(c.label));

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

for (const c of cases) {
	const out = await page.evaluate((one) => {
		const result = window.__assistantTest.recognizeInkFormula(one.strokes);
		return {
			source: result.source,
			confidence: Math.round(result.confidence * 100) / 100,
			tokens: result.tokens.map(t => ({ value: t.value, conf: Math.round(t.confidence * 100) / 100, alt: t.alternatives.slice(0, 4) }))
		};
	}, c);
	console.log(`\n${c.label}  esperado ${JSON.stringify(c.expected)}  leído ${JSON.stringify(out.source)} (${out.confidence})`);
	console.log(`  trazos: ${c.strokes.length} · glifos: ${out.tokens.length}`);
	for (const t of out.tokens) console.log(`   ${JSON.stringify(t.value).padEnd(8)} conf ${String(t.conf).padEnd(5)} alt ${t.alt.join(" ")}`);
}
await browser.close();
