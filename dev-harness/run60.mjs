// Leen is held back: no pet on the board, no chat, and the local model
// settings still there because the translator needs the same server.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots60");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
console.log("pizarra:", JSON.stringify(await page.evaluate(() => ({
  pet: document.querySelectorAll(".notelens-pet").length,
  chat: document.querySelectorAll(".notelens-assistant").length,
  bubble: document.querySelectorAll(".notelens-pet-bubble").length
}))));
await page.screenshot({ path: path.join(shots, "01-board-no-pet.png") });
await page.evaluate(() => {
  const host = document.createElement("div");
  host.id = "settings-host";
  document.body.appendChild(host);
  window.__settingTab.containerEl = host;
  window.__settingTab.display();
});
await sleep(300);
console.log("ajustes:", JSON.stringify(await page.evaluate(() => {
  const names = [...document.querySelectorAll("#settings-host .setting-item-name")].map(n => n.textContent);
  return {
    leen: names.filter(n => /Leen/.test(n)),
    modeloLocal: names.includes("Servidor") && names.includes("Modelo preferido"),
    estado: document.querySelector("#settings-host .notelens-settings-status")?.textContent?.slice(0, 60)
  };
})));
await page.screenshot({ path: path.join(shots, "02-settings.png"), fullPage: true });
console.log("page errors:", errors.length ? errors.slice(0, 2) : "(none)");
await browser.close();
