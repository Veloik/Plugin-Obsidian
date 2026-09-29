// Photographs the side tools and media frames, in a dark and a light board.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const tone = process.argv[2] === "light" ? "light" : "dark";
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
await page.setViewport({ width: 1500, height: 950 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.evaluate((t) => {
	const v = window.__view;
	if (t === "light") { v.data.backgroundColor = "#ffffff"; v.data.lineColor = "#e5e7eb"; v.updateBackground(); }
	v.data.embeds.length = 0;
	v.data.embeds.push({ id: "yt", pageId: v.data.activePageId, kind: "youtube", src: "https://www.youtube.com/embed/dQw4w9WgXcQ", originalUrl: "https://youtu.be/dQw4w9WgXcQ", provider: "youtube", x: 620, y: 120, w: 420, h: 250 });
	v.data.embeds.push({ id: "au", pageId: v.data.activePageId, kind: "audio", src: "Grabaciones/clase.mp3", x: 620, y: 420, w: 430, h: 130 });
	v.data.embeds.push({ id: "vd", pageId: v.data.activePageId, kind: "video", src: "Videos/tema3.mp4", x: 620, y: 600, w: 420, h: 236 });
	v.renderAll();
	v.toggleRecorder();
	v.toggleCalculator();
	v.toggleRuler();
}, tone);
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: path.join(here, `shots-panels-${tone}-1.png`) });
await page.evaluate(() => { const v = window.__view; v.toggleRecorder(); v.toggleCalculator(); v.translateText(); v.toggleNavigator(); });
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: path.join(here, `shots-panels-${tone}-2.png`) });
await browser.close();
