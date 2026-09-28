// Tables as a student fills them in: Tab walks the cells and adds a row at the
// end, numbers line up on the right, a long answer makes the row taller
// instead of being cut, and the palette recolours the table and its stripes.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1300, height: 900 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready);
let failed = 0;
const check = (ok, label, detail = "") => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`); };
await page.evaluate(() => {
	const v = window.__view;
	v.data.tables.push({ id: "t", pageId: v.data.activePageId, x: 200, y: 220, w: 420, h: 150, rows: 3, cols: 2, header: true, title: "Notas", cells: [["Asignatura", "Nota"], ["Física", ""], ["Química", ""]] });
	v.setTool("select");
	v.renderAll();
});
await sleep(300);
const cells = () => page.$$('[data-id="t"] .notelens-table-cell');
let list = await cells();
await list[3].click();
await page.keyboard.type("8,5");
await sleep(80);
check(await list[3].evaluate(el => el.classList.contains("is-number")), "un número se alinea a la derecha");
await page.keyboard.press("Tab");
await page.keyboard.type("Química");
check(await page.evaluate(() => window.__view.data.tables[0].cells[2][0]) === "Química", "Tab pasa a la celda siguiente");
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
await sleep(150);
const after = await page.evaluate(() => ({ rows: window.__view.data.tables[0].rows, focus: document.activeElement?.getAttribute("aria-label") }));
check(after.rows === 4 && after.focus === "Fila 4, columna 1", "Tab en la última celda añade una fila y salta a ella", JSON.stringify(after));
const before = await page.$eval('[data-id="t"]', el => el.offsetHeight);
await page.keyboard.type("Biología molecular y genética, con prácticas de laboratorio los jueves por la tarde");
await sleep(150);
const grown = await page.$eval('[data-id="t"]', el => el.offsetHeight);
check(grown > before + 10, "una respuesta larga hace la fila más alta en vez de cortarse", `${before} → ${grown}`);
await page.hover('[data-id="t"] .notelens-table-header');
await page.click('[data-id="t"] .notelens-table-control[title="Color de la tabla"]');
await sleep(150);
await page.click('[data-id="t"] .notelens-table-swatch[title="Verde"]');
await sleep(150);
const color = await page.evaluate(() => ({ saved: window.__view.data.tables[0].color, accent: window.__view.pageElement("t").style.getPropertyValue("--table-accent") }));
check(color.saved === "emerald" && color.accent === "#34d399", "la paleta cambia el color de la tabla", JSON.stringify(color));
await page.hover('[data-id="t"] .notelens-table-header');
await page.click('[data-id="t"] .notelens-table-control[title="Color de la tabla"]');
await sleep(150);
await page.click('[data-id="t"] .notelens-table-stripes');
await sleep(150);
check(await page.evaluate(() => window.__view.data.tables[0].striped === false && !window.__view.pageElement("t").classList.contains("is-striped")), "y las filas alternas se pueden quitar");
console.log("errores de página:", errors.length ? errors.slice(0, 3) : "(ninguno)");
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;
console.log(failed ? `${failed} fallo(s)` : "todo correcto");
