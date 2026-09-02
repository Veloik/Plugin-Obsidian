// Rotation of selections, table rename, tag chip hover looks.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots24"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
const drag = async (pts, steps = 3) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps }); await page.mouse.up(); };

// content: a stroke, a rectangle shape, a text box and a table
await page.evaluate(() => { __view.setTool("select"); __view.setPenColor("#e2e8f0"); __view.setStrokeWidth(4); });
await tool("pen"); await drag([[260, 300], [420, 260], [560, 320]]);
await page.evaluate(() => { __view.setTool("shape"); __view.setShapeKind("rectangle"); });
await drag([[280, 380], [520, 480]]);
await page.evaluate(() => { __view.setTool("text"); __view.createTextBoxAt(300, 520, undefined, "text"); const ed = __view.activeTextEditor; if (ed) ed.value = "Girar esto"; __view.commitTextEditor(); __view.insertTableAt(600, 380); __view.setTool("select"); });
await page.mouse.click(1100, 800); await sleep(80);
await tool("select");
await drag([[200, 220], [1200, 720]]); await sleep(100);
console.log("selected:", await page.evaluate(() => [__view.selStrokes.size, __view.selShapes.size, __view.selTexts.size, __view.selTables.size]));
await shot(page, "01-selection-with-rotate-handle");
// free rotation via the handle: drag around the centre by ~30°
const handle = await page.$(".notelens-selection-rotate");
const hb = await handle.boundingBox();
const box = await (await page.$(".onenote-selection-box")).boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const r = Math.hypot(hb.x + hb.width / 2 - cx, hb.y + hb.height / 2 - cy);
const a0 = Math.atan2(hb.y + hb.height / 2 - cy, hb.x + hb.width / 2 - cx);
const pts = [[hb.x + hb.width / 2, hb.y + hb.height / 2]];
for (let k = 1; k <= 10; k++) { const a = a0 + (k / 10) * (30 * Math.PI / 180); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
await drag(pts, 1); await sleep(120);
console.log("rotations:", JSON.stringify(await page.evaluate(() => ({ shape: __view.data.shapes[0].rotation, text: __view.data.texts[0].rotation, table: __view.data.tables[0].rotation, strokeFirst: __view.data.strokes[0].points[0] }))));
await shot(page, "02-rotated-30");
// 90° button
await page.click(".notelens-selection-action[title='Girar 90° a la derecha']"); await sleep(120);
console.log("after +90:", JSON.stringify(await page.evaluate(() => ({ shape: __view.data.shapes[0].rotation, text: __view.data.texts[0].rotation, table: __view.data.tables[0].rotation }))));
await shot(page, "03-rotated-plus-90");
// undo brings everything back
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await sleep(80);
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await sleep(120);
console.log("after undo x2:", JSON.stringify(await page.evaluate(() => ({ shape: __view.data.shapes[0].rotation, table: __view.data.tables[0].rotation }))));
await page.mouse.click(1100, 800); await sleep(80);

// table rename by double click on the title
await page.evaluate(() => { __view.renderAll(); });
const title = await page.$(".notelens-table-title");
const tb = await title.boundingBox();
await page.mouse.click(tb.x + 10, tb.y + tb.height / 2, { clickCount: 2 }); await sleep(100);
console.log("rename input focused:", await page.evaluate(() => document.activeElement?.classList.contains("notelens-table-rename")));
await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
await page.keyboard.type("Horas por asignatura"); await page.keyboard.press("Enter"); await sleep(100);
console.log("table title:", await page.evaluate(() => [__view.data.tables[0].title, document.querySelector(".notelens-table-title").textContent]));
await shot(page, "04-table-renamed", { x: 560, y: 340, width: 600, height: 300 });

// tag chip hovers
const chips = await page.$$(".onenote-quick-tags .onenote-tag-chip[data-tag]");
for (let i = 0; i < chips.length; i++) {
	const b = await chips[i].boundingBox();
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await sleep(650);
	await shot(page, `05-tag-hover-${i}`, { x: 400, y: 112, width: 600, height: 48 });
}
console.log("chip titles:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".onenote-tag-chip[data-tag]")].map(c => c.title))));
console.log("console issues:\n" + (errors.length ? errors.slice(0, 8).join("\n") : "(none)"));
await browser.close();
