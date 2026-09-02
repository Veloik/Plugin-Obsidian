// The interface in English, and Spanish left exactly as it was.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots48"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const url = pathToFileURL(path.join(here, "index.html")).href;
const errors = [];
let failures = 0;

const check = (label, actual, expected) => {
	const ok = actual === expected;
	if (!ok) failures++;
	console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (esperado ${JSON.stringify(expected)})`}`);
};

/** Boots the harness with a language preset and reads the visible interface back. */
async function boot(language) {
	const page = await browser.newPage();
	page.on("console", (m) => { if (m.type() === "error") errors.push(`[${language}] ${m.text()}`); });
	page.on("pageerror", (e) => errors.push(`[${language}] ${e.message}`));
	await page.evaluateOnNewDocument((lang) => { window.__presetSettings = { language: lang }; }, language);
	await page.goto(url, { waitUntil: "load" });
	await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
	const titleOf = (selector) => page.evaluate((s) => document.querySelector(s)?.getAttribute("title") ?? null, selector);
	const strings = {
		undo: await titleOf(".notelens-document-dock button[title], .onenote-dock-btn[title]"),
		pdf: await page.evaluate(() => [...document.querySelectorAll("button[title]")].map(b => b.title).find(t => /PDF/.test(t)) ?? null),
		calculator: await page.evaluate(() => [...document.querySelectorAll("button[title]")].map(b => b.title).find(t => /Calc/i.test(t)) ?? null),
		tags: await page.evaluate(() => [...document.querySelectorAll(".onenote-tag-chip")].map(c => c.getAttribute("title")).filter(Boolean).slice(0, 2))
	};
	await page.screenshot({ path: path.join(shots, `01-${language}.png`), clip: { x: 0, y: 0, width: 1400, height: 200 } });
	// The settings tab is where most of the translated copy lives.
	const settings = await page.evaluate(() => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const tab = window.__settingTab;
		if (!tab) return null;
		tab.containerEl = host;
		tab.display();
		const names = [...host.querySelectorAll(".setting-item-name")].map(n => n.textContent);
		const out = { first: names.slice(0, 4), count: names.length };
		host.remove();
		return out;
	});
	await page.close();
	return { strings, settings };
}

const es = await boot("es");
const en = await boot("en");

console.log("\n--- español (no debe cambiar) ---");
check("PDF", es.strings.pdf, "Insertar PDF de la bóveda");
check("calculadora", es.strings.calculator, "Calculadora científica");
check("etiqueta 1", es.strings.tags[0], "Importante: márcalo para encontrarlo al repasar");
console.log("ajustes:", JSON.stringify(es.settings?.first), "de", es.settings?.count, "filas");

console.log("\n--- English ---");
check("PDF", en.strings.pdf, "Insert a PDF from the vault");
check("calculator", en.strings.calculator, "Scientific calculator");
console.log("tag titles:", JSON.stringify(en.strings.tags));
console.log("settings:", JSON.stringify(en.settings?.first), "of", en.settings?.count, "rows");

const stillSpanish = (en.settings?.first ?? []).filter(n => /[áéíóúñ¿]|Pizarra|Idioma/.test(n ?? ""));
console.log("\nfilas de ajustes aún en español:", JSON.stringify(stillSpanish));

console.log("\nconsole issues:", errors.length ? errors.slice(0, 5).join(" | ") : "(none)");
console.log(failures ? `FALLOS: ${failures}` : "todas las comprobaciones pasan");
await browser.close();
process.exit(failures ? 1 : 0);
