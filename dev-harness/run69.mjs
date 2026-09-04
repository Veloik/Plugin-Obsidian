// Fallbacks: when the first free service refuses, the next one answers.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = "C:/Users/jtiob/Desktop/Nueva carpeta/NoteLens/dev-harness";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.setRequestInterception(true);
const used = [];
page.on("request", (r) => {
	const url = r.url();
	if (url.includes("translate.googleapis.com")) { used.push("gtx(bloqueado)"); return r.respond({ status: 429, body: "too many" }); }
	if (url.includes("clients5.google.com")) used.push("clients5");
	if (url.includes("mymemory")) used.push("mymemory");
	r.continue();
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.evaluate(() => __view.translateText());
await sleep(300);
await page.evaluate(() => {
	const panel = document.querySelector(".notelens-translator");
	panel.querySelector("select").value = "es";
	panel.querySelectorAll("select")[1].value = "en";
	const ta = panel.querySelector("textarea.notelens-translator-text");
	ta.value = "Una frase corta para probar el segundo servicio.";
	ta.dispatchEvent(new Event("input"));
});
const t0 = Date.now();
await page.click(".notelens-translator .notelens-translator-actions button");
await page.waitForFunction(() => {
	const out = document.querySelectorAll(".notelens-translator textarea")[1];
	return out && out.value.trim().length > 0;
}, { timeout: 20000 }).catch(() => {});
console.log("tardó:", Date.now() - t0, "ms");
console.log("resultado:", JSON.stringify(await page.evaluate(() => document.querySelectorAll(".notelens-translator textarea")[1]?.value)));
console.log("servicios:", used);
console.log("page errors:", errors.length ? errors.slice(0, 2) : "(none)");

// Private mode: nothing leaves the computer, even if that means no translation.
const priv = await browser.newPage();
await priv.setRequestInterception(true);
const web = [];
priv.on("request", (r) => {
	const url = r.url();
	if (/googleapis|clients5|mymemory/.test(url)) { web.push(url.slice(0, 40)); return r.respond({ status: 200, body: "[]" }); }
	r.continue();
});
await priv.evaluateOnNewDocument(() => { window.__presetSettings = { translationPrivateOnly: true }; });
await priv.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await priv.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await priv.evaluate(() => __view.translateText());
await sleep(300);
await priv.evaluate(() => {
	const panel = document.querySelector(".notelens-translator");
	const ta = panel.querySelector("textarea.notelens-translator-text");
	ta.value = "Solo en mi ordenador.";
	ta.dispatchEvent(new Event("input"));
});
await priv.click(".notelens-translator .notelens-translator-actions button");
await sleep(2500);
console.log("privado · estado:", JSON.stringify(await priv.evaluate(() => document.querySelector(".notelens-translator .notelens-translator-status")?.textContent)));
console.log("privado · llamadas web:", web.length ? web : "(ninguna)");
await browser.close();
