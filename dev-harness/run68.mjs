// The translator: free services first, and how long they take.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots68"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
const calls = [];
page.on("request", (r) => { if (/googleapis|clients5|mymemory|11434/.test(r.url())) calls.push(r.url().slice(0, 70)); });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

await page.click(".notelens-document-dock button[title*='Traductor'], .notelens-document-dock button[aria-label*='Traductor']").catch(() => {});
await sleep(200);
const open = await page.evaluate(() => !!document.querySelector(".notelens-translator:not(.hidden)"));
if (!open) await page.evaluate(() => __view.translateText());
await sleep(300);
await page.evaluate(() => {
	const panel = document.querySelector(".notelens-translator");
	panel.querySelector("select").value = "es";
	panel.querySelectorAll("select")[1].value = "en";
	const ta = panel.querySelector("textarea.notelens-translator-text");
	ta.value = "La entropía mide el desorden de un sistema. Cuanto mayor es, menos información tenemos sobre su estado.";
	ta.dispatchEvent(new Event("input"));
});
const t0 = Date.now();
await page.click(".notelens-translator button.notelens-translator-run, .notelens-translator .notelens-translator-actions button");
await page.waitForFunction(() => {
	const out = document.querySelectorAll(".notelens-translator textarea")[1];
	return out && out.value.trim().length > 0;
}, { timeout: 20000 }).catch(() => {});
console.log("tardó:", Date.now() - t0, "ms");
console.log("resultado:", JSON.stringify(await page.evaluate(() => document.querySelectorAll(".notelens-translator textarea")[1]?.value)));
console.log("estado:", JSON.stringify(await page.evaluate(() => document.querySelector(".notelens-translator .notelens-translator-status")?.textContent)));
console.log("llamadas:", calls);
await page.screenshot({ path: path.join(shots, "01-translator.png") });
console.log("page errors:", errors.length ? errors.slice(0, 3) : "(none)");
await browser.close();
