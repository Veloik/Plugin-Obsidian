// Does the equation model read a formula better than the prose one?
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security"], defaultViewport: { width: 1200, height: 800 } });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
console.log("running the equation model (first run downloads it)…");
const result = await page.evaluate(async () => {
	const make = (text) => {
		const c = document.createElement("canvas");
		c.width = 900; c.height = 200;
		const x = c.getContext("2d");
		x.fillStyle = "#ffffff"; x.fillRect(0, 0, c.width, c.height);
		x.fillStyle = "#111111";
		x.font = "72px Georgia, serif";
		x.fillText(text, 30, 130);
		return c;
	};
	const out = {};
	for (const sample of ["x^2 + 3x = 12", "(a+b)/2 = c"]) {
		const started = Date.now();
		try {
			out[sample] = { text: await window.__assistantTest.recognizeFormula(make(sample)), seconds: Math.round((Date.now() - started) / 1000) };
		} catch (e) {
			out[sample] = { error: String(e).slice(0, 120), seconds: Math.round((Date.now() - started) / 1000) };
		}
	}
	out.tidied = window.__assistantTest.tidyFormulaText("x²  +  √9  ≤  π\n×3");
	return out;
}).catch(e => ({ failed: String(e).slice(0, 200) }));
console.log(JSON.stringify(result, null, 1));
await browser.close();
