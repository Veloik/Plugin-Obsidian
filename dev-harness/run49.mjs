// Changing the language from the settings, with the board already open.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots49"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

const board = () => page.evaluate(() => ({
	pdf: [...document.querySelectorAll("button[title]")].map(b => b.title).find(t => /PDF/.test(t)) ?? null,
	calc: [...document.querySelectorAll("button[title]")].map(b => b.title).find(t => /Calc/i.test(t)) ?? null,
	chip: document.querySelector(".onenote-tag-chip")?.getAttribute("title") ?? null
}));

let failures = 0;
const check = (label, actual, expected) => {
	const ok = actual === expected;
	if (!ok) failures++;
	console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (esperado ${JSON.stringify(expected)})`}`);
};

/** Flips the language dropdown the way a user does, from the settings tab. */
const switchTo = (value) => page.evaluate(async (v) => {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const tab = window.__settingTab;
	tab.containerEl = host;
	tab.display();
	const select = host.querySelector("select");
	select.value = v;
	select.dispatchEvent(new Event("change"));
	await new Promise(r => setTimeout(r, 200));
	const names = [...(tab.containerEl?.querySelectorAll(".setting-item-name") ?? [])].map(n => n.textContent);
	host.remove();
	return names[0];
}, value);

console.log("antes  :", JSON.stringify(await board()));

// Open the settings tab the way the real one is built, then flip the dropdown.
const after = await page.evaluate(async () => {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const tab = window.__settingTab;
	tab.containerEl = host;
	tab.display();
	const before = [...host.querySelectorAll(".setting-item-name")].map(n => n.textContent).slice(0, 3);
	const select = host.querySelector("select");
	if (!select) return { error: "no hay desplegable" };
	select.value = "en";
	select.dispatchEvent(new Event("change"));
	await new Promise(r => setTimeout(r, 150));
	const names = [...(tab.containerEl?.querySelectorAll(".setting-item-name") ?? [])].map(n => n.textContent).slice(0, 3);
	const out = { before, afterInTab: names, options: [...select.options].map(o => o.textContent) };
	host.remove();
	return out;
});
console.log("ajustes:", JSON.stringify(after));
await sleep(200);

// The board itself must follow, not only the settings tab: the controls are
// rebuilt in place, without reopening the board.
const en = await board();
console.log("\n--- tras cambiar a English ---");
check("ajustes", after.afterInTab?.[0], "Language");
check("barra PDF", en.pdf, "Insert a PDF from the vault");
check("calculadora", en.calc, "Scientific calculator");
check("etiqueta", en.chip, "Important: mark it to find it when you revise");
await page.screenshot({ path: path.join(shots, "01-after-switch.png"), clip: { x: 0, y: 0, width: 1400, height: 220 } });

const backName = await switchTo("es");
const es = await board();
console.log("\n--- de vuelta a Español ---");
check("ajustes", backName, "Idioma");
check("barra PDF", es.pdf, "Insertar PDF de la bóveda");
check("etiqueta", es.chip, "Importante: márcalo para encontrarlo al repasar");
await page.screenshot({ path: path.join(shots, "02-back-to-spanish.png"), clip: { x: 0, y: 0, width: 1400, height: 220 } });

// A rebuild that leaked would leave two copies of every control behind.
const chrome = await page.evaluate(() => {
	const kids = [...document.querySelector(".onenote-workspace").children].map(c => c.className.split(" ")[0]);
	const counts = {};
	for (const k of kids) counts[k] = (counts[k] ?? 0) + 1;
	return { total: kids.length, duplicated: Object.entries(counts).filter(([, n]) => n > 1) };
});
console.log("\ncontroles:", chrome.total, "· duplicados:", JSON.stringify(chrome.duplicated));
if (chrome.duplicated.length) failures++;

console.log("console issues:", errors.length ? errors.slice(0, 4).join(" | ") : "(none)");
console.log(failures ? `FALLOS: ${failures}` : "todas las comprobaciones pasan");
await browser.close();
process.exit(failures ? 1 : 0);
