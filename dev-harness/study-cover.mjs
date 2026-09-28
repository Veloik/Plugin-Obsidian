// Revision cover: a definition and a formula are covered from the selection
// bar, show "tap to see" blurred, uncover with a tap, cover back with the eye,
// and the board menu shows or covers them all. Screenshots in shots-showcase/.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots-showcase");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1300, height: 800 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready);
let failed = 0;
const check = (ok, label, detail = "") => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`); };

await page.evaluate(() => {
	const v = window.__view, pageId = v.data.activePageId;
	v.data.texts.push(
		{ id: "q", pageId, x: 120, y: 240, text: "**¿Qué dice la 2ª ley de Newton?**", fontSize: 20, color: "#f8fafc", variant: "text", autoWidth: true, w: 380, h: 40 },
		{ id: "a", pageId, x: 120, y: 300, text: "La fuerza neta es igual a la masa por la aceleración.", fontSize: 18, color: "#e5e7eb", variant: "text", w: 380, h: 60 },
		{ id: "f", pageId, x: 560, y: 290, text: "F = m a", fontSize: 24, color: "#f8fafc", variant: "math", autoWidth: true, w: 200, h: 70 }
	);
	v.setTool("select");
	v.renderAll();
	v.selTexts.add("a"); v.selTexts.add("f");
	v.renderSelectionBox();
});
await sleep(800);
const cover = await page.$(".notelens-selection-action[title='Tapar para repasar']");
check(!!cover, "la barra de selección ofrece tapar para repasar");
await cover?.click();
await sleep(300);
let state = await page.evaluate(() => ({
	covered: ["a", "f"].map(id => window.__view.pageElement(id)?.classList.contains("is-study-covered")),
	saved: window.__view.data.texts.filter(t => t.cover).map(t => t.id),
	blur: getComputedStyle(window.__view.pageElement("a").querySelector(".notelens-study-cover")).backdropFilter
}));
check(state.covered.every(Boolean) && state.saved.join() === "a,f" && state.blur.includes("blur"), "quedan tapadas y borrosas", JSON.stringify(state));
await page.evaluate(() => { window.__view.clearSelection(); });
await sleep(200);
await page.screenshot({ path: path.join(shots, "repaso-tapado.png"), clip: { x: 80, y: 200, width: 760, height: 220 } });

await page.click('[data-id="a"] .notelens-study-face');
await sleep(200);
state = await page.evaluate(() => ({ revealed: window.__view.pageElement("a").classList.contains("is-revealed"), other: window.__view.pageElement("f").classList.contains("is-revealed") }));
check(state.revealed && !state.other, "un toque destapa solo esa tarjeta", JSON.stringify(state));
await page.screenshot({ path: path.join(shots, "repaso-destapado.png"), clip: { x: 80, y: 200, width: 760, height: 220 } });
await page.click('[data-id="a"] .notelens-study-again');
await sleep(150);
check(!(await page.evaluate(() => window.__view.pageElement("a").classList.contains("is-revealed"))), "el ojo la vuelve a tapar");

await page.mouse.click(900, 600, { button: "right" });
await sleep(150);
const all = await page.evaluateHandle(() => [...document.querySelectorAll(".menu-item")].find(i => i.textContent.includes("Ver todas las tarjetas tapadas")));
check(await all.evaluate(i => !!i), "el menú de la pizarra puede destaparlas todas");
await all.evaluate(i => i?.click());
await sleep(150);
check(await page.evaluate(() => ["a", "f"].every(id => window.__view.pageElement(id).classList.contains("is-revealed"))), "y las destapa todas");

// Uncover from the selection bar for good.
await page.evaluate(() => { const v = window.__view; v.selTexts.add("a"); v.selTexts.add("f"); v.renderSelectionBox(); });
await sleep(150);
await page.click(".notelens-selection-action[title='Destapar']");
await sleep(200);
check(await page.evaluate(() => !window.__view.data.texts.some(t => t.cover) && !document.querySelector(".is-study-covered")), "Destapar las quita del modo repaso");
console.log("errores de página:", errors.length ? errors.slice(0, 3) : "(ninguno)");
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;
console.log(failed ? `${failed} fallo(s)` : "todo correcto");
