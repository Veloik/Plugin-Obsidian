// What the dialog shows when it cannot read what you drew: a "?" in the
// notation, a plain message, and the nearest guesses to pick from.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots61");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 980 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.click(".notelens-insert-dock button[title^='Insertar ecuación']");
await sleep(300);
const box = await page.evaluate(() => { const r = document.querySelector(".notelens-ink-board canvas").getBoundingClientRect(); return [r.left, r.top]; });
// a spiral: nothing in the library looks like it
await page.mouse.move(box[0] + 120, box[1] + 100);
await page.mouse.down();
for (let i = 0; i < 70; i++) { const t = i / 9, r = 6 + t * 7; await page.mouse.move(box[0] + 120 + r * Math.cos(t), box[1] + 100 + r * Math.sin(t), { steps: 1 }); }
await page.mouse.up();
await sleep(1200);
console.log("estado inmediato:", JSON.stringify(await page.evaluate(() => document.querySelector('.notelens-ink-status').textContent)));
await sleep(9000);
console.log("notación:", JSON.stringify(await page.evaluate(() => document.querySelector(".notelens-ink-source").value)));
console.log("estado:  ", JSON.stringify(await page.evaluate(() => document.querySelector(".notelens-ink-status").textContent)));
console.log("revisar: ", JSON.stringify(await page.evaluate(() => {
  const row = document.querySelector(".notelens-ink-candidates");
  return { hidden: row.classList.contains("hidden"), options: [...row.querySelectorAll("option")].map(o => o.value).slice(0, 6) };
})));
await page.screenshot({ path: path.join(shots, "01-unknown.png") });
console.log("page errors:", errors.length ? errors.slice(0, 2) : "(none)");
await browser.close();
