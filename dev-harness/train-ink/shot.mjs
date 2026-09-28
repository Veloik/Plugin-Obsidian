// Screenshots a local HTML file: node shot.mjs <file.html> <out.png> [width] [height]
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "node:url";

const [, , file, out, w = "1400", h = "900"] = process.argv;
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	defaultViewport: { width: Number(w), height: Number(h) }
});
const page = await browser.newPage();
await page.goto(pathToFileURL(file).href);
await page.screenshot({ path: out, fullPage: process.env.FULL === "1" });
await browser.close();
