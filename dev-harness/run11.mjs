import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots11");
fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + ".png") }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
	defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));

await page.evaluate(() => {
	window.__binaries = [];
	const original = __view.app.vault.createBinary;
	__view.app.vault.createBinary = async (p, buf) => { window.__binaries.push({ path: p, bytes: buf.byteLength, head: Array.from(new Uint8Array(buf).slice(0, 3)) }); return original(p, buf); };
});

await page.click(".notelens-insert-dock button[title^='Grabar audio']");
await sleep(100);
console.log("recorder open:", await page.evaluate(() => !document.querySelector(".notelens-recorder").classList.contains("hidden")));
await page.click(".notelens-recorder-record");
await sleep(1800);
console.log("state while recording:", await page.evaluate(() => [document.querySelector(".notelens-recorder").getAttribute("data-state"), document.querySelector(".notelens-recorder-clock").textContent, document.querySelector(".notelens-recorder-meter-fill").style.width]));
await shot(page, "01-recording");
await page.click(".notelens-recorder-stop");
await page.waitForFunction(() => document.querySelector(".notelens-recorder").getAttribute("data-state") === "idle", { timeout: 30000 });
await sleep(200);
console.log("status:", await page.evaluate(() => document.querySelector(".notelens-recorder-status").textContent));
console.log("binaries:", JSON.stringify(await page.evaluate(() => window.__binaries)));
console.log("embeds:", JSON.stringify(await page.evaluate(() => __view.data.embeds.map(e => [e.kind, e.src]))), "audio element:", await page.evaluate(() => !!document.querySelector("audio.notelens-audio-player")));
await shot(page, "02-saved");
console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
