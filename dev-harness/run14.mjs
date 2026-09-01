import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots14");
fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + ".png") }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));

const drag = async (pts) => {
	await page.mouse.move(pts[0][0], pts[0][1]);
	await page.mouse.down();
	for (const [x, y] of pts.slice(1)) { await page.mouse.move(x, y, { steps: 4 }); }
	await page.mouse.up();
};
const table = () => page.evaluate(() => { const t = __view.data.tables[0]; return { rows: t.rows, cols: t.cols, w: Math.round(t.w), h: Math.round(t.h), colWidths: t.colWidths?.map(Math.round), rowHeights: t.rowHeights?.map(Math.round), cells: t.cells }; });

// table: column border drag, row border drag, insert/delete anywhere
await page.click(".notelens-insert-dock button[title='Insertar tabla']");
await sleep(150);
await page.click('.onenote-ribbon-dock [data-tool="select"]'); await sleep(60);
console.log("table:", JSON.stringify(await table()));
const colHandle = await page.evaluate(() => { const h = document.querySelector(".notelens-table-col-handle"); const r = h.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 30]; });
await drag([colHandle, [colHandle[0] + 80, colHandle[1]]]);
await sleep(100);
console.log("after column drag:", JSON.stringify((await table()).colWidths));
const rowHandle = await page.evaluate(() => { const h = document.querySelector(".notelens-table-row-handle"); const r = h.getBoundingClientRect(); return [r.left + 100, r.top + r.height / 2]; });
await drag([rowHandle, [rowHandle[0], rowHandle[1] + 40]]);
await sleep(100);
console.log("after row drag:", JSON.stringify({ rowHeights: (await table()).rowHeights, h: (await table()).h }));
await page.evaluate(() => { const t = __view.data.tables[0]; __view.insertTableRow(t, 1); __view.insertTableColumn(t, 0); });
await sleep(100);
console.log("after insert row at 1 / col at 0:", JSON.stringify(await table()));
await page.evaluate(() => { const t = __view.data.tables[0]; __view.deleteTableColumn(t, 0); __view.deleteTableRow(t, 1); });
await sleep(100);
console.log("after delete:", JSON.stringify(await table()));
await shot(page, "01-table");

// charts: data chart, pie, function; edit via spec
await page.evaluate(() => { __view.placeChart({ type: "bar", title: "Horas de estudio", data: "# Teoría; Práctica\nLun; 2; 1\nMar; 3; 2\nMié; 1; 3\nJue; 4; 2\nVie; 2; 2", showLegend: true }); });
await page.evaluate(() => { __view.placeChart({ type: "pie", title: "Reparto", data: "Teoría; 40\nProblemas; 35\nRepaso; 25" }, { x: 620, y: 120 }); });
await page.evaluate(() => { __view.placeChart({ type: "function", title: "y = f(x)", data: "", functions: "sin(x)\nx^2/10 - 1\n1/x", xMin: -6, xMax: 6 }, { x: 620, y: 450 }); });
await sleep(300);
console.log("charts:", JSON.stringify(await page.evaluate(() => __view.data.embeds.map(e => [e.kind, e.chart?.type, e.chart?.title]))), "canvases:", await page.evaluate(() => [...document.querySelectorAll(".notelens-chart-canvas")].map(c => [c.width, c.height])));
await shot(page, "02-charts");

// chart from table
await page.evaluate(() => { const t = __view.data.tables[0]; t.cells = [["Mes", "Ventas"], ["Ene", "10"], ["Feb", "12"]]; });
await page.evaluate(() => { const t = __view.data.tables[0]; __view.chartFromTable(t); });
await sleep(200);
console.log("modal open:", await page.evaluate(() => !!document.querySelector(".notelens-chart-editor")), "preview:", await page.evaluate(() => { const c = document.querySelector(".notelens-chart-preview"); return c ? [c.width, c.height] : null; }), "data:", await page.evaluate(() => document.querySelector(".notelens-chart-data")?.value));
await shot(page, "03-chart-editor");
await page.evaluate(() => [...document.querySelectorAll(".modal button")].find(b => b.textContent === "Guardar en la pizarra").click());
await sleep(200);
console.log("embeds after save:", await page.evaluate(() => __view.data.embeds.length));

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
