// Translation without quotas: the local model first, the web service only as a fallback.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots46"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
let localUp = true;
let webCalls = 0;
let localCalls = 0;
let webBody = { responseStatus: 200, responseData: { translatedText: "Buenos días (servicio web)" } };
await page.setRequestInterception(true);
page.on("request", (r) => {
	const u = r.url();
	if (u.includes("11434")) {
		if (!localUp) return void r.abort("connectionrefused");
		if (u.endsWith("/api/tags")) return void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }) });
		if (u.endsWith("/api/chat")) {
			localCalls++;
			const sent = JSON.parse(r.postData() || "{}");
			const system = sent.messages?.[0]?.content ?? "";
			return void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ message: { content: `Buenos días (modelo local, prompt: ${/catalán/.test(system) ? "ca" : "?"}→${/español/.test(system) ? "es" : "?"})` } }) });
		}
		return void r.respond({ status: 404, contentType: "application/json", body: "{}" });
	}
	if (u.includes("mymemory")) { webCalls++; return void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify(webBody) }); }
	r.continue();
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));

const translate = async (text, from, to) => {
	await clean();
	await page.evaluate((text, from, to) => {
		document.querySelector(".notelens-translator-text").value = text;
		const selects = document.querySelectorAll(".notelens-translator-languages select");
		selects[0].value = from; selects[1].value = to;
	}, text, from, to);
	await page.click(".notelens-translator-actions button");
	await sleep(900);
	return page.evaluate(() => ({
		result: document.querySelector(".notelens-translator-result").value,
		status: document.querySelector(".notelens-translator-status").textContent
	}));
};

await clean();
await page.evaluate(() => __view.translateText());
await sleep(300);

// ---- Catalan to Spanish, the pair that used to fail
console.log("ca → es:", JSON.stringify(await translate("Bon dia", "ca", "es")));
console.log("local calls:", localCalls, "· web calls:", webCalls);

// ---- with no local model it falls back, and a quota error reads clearly
localUp = false;
console.log("without a local model:", JSON.stringify(await translate("Bon dia", "ca", "es")));
console.log("web calls now:", webCalls);
webBody = { responseStatus: 403, responseDetails: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY" };
const quota = await translate("Bon dia", "ca", "es");
console.log("quota message:", JSON.stringify(quota.status));
await page.screenshot({ path: path.join(shots, "170-translator.png"), clip: { x: 0, y: 60, width: 420, height: 460 } });

// strict local mode must never touch the web service
await page.evaluate(() => { __view.plugin.settings.translationLocalOnly = true; });
const callsBefore = webCalls;
const strict = await translate("Bon dia", "ca", "es");
console.log("local-only with no model:", JSON.stringify(strict.status));
console.log("web service untouched:", webCalls === callsBefore);
console.log("console issues:", errors.length ? errors.slice(0, 4).join("\n") : "(none)");
await browser.close();
