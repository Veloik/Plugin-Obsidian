// Zooming a board on a phone: the elements have to stay exactly where the
// board puts them, at any scale.
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = http.createServer((req, res) => {
  const file = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => {
  window.__presetPlatform = { isMobile: true, isDesktop: false, isPhone: true, isIosApp: true };
  window.__presetSettings = { showAssistantPet: false };
});
await page.goto(`http://127.0.0.1:${server.address().port}/dev-harness/index.html`);
await page.waitForFunction(() => window.__ready || window.__bootError);
await page.evaluate(() => {
  const v = window.__view;
  v.data.texts.push({ id: "t1", x: 60, y: 300, w: 220, h: 48, text: "Hola mundo", variant: "text", color: "#ffffff", fontSize: 20 });
  v.data.strokes.push({ id: "s1", points: [[60, 380], [280, 380], [280, 470], [60, 470], [60, 380]].map(([x, y]) => ({ x, y, p: 0.5 })), color: "#38bdf8", width: 3, tool: "pen" });
  v.data.tables.push({ id: "tb1", x: 60, y: 500, w: 240, h: 120, rows: 2, cols: 2, cells: [["a", "b"], ["c", "d"]] });
  v.data.embeds.push({ id: "e1", kind: "image", x: 60, y: 660, w: 200, h: 140, src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='140'%3E%3Crect width='200' height='140' fill='%2338bdf8'/%3E%3C/svg%3E" });
  v.renderAll();
});
const cdp = await page.createCDPSession();
const touch = async (type, points) => {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i, radiusX: 8, radiusY: 8, force: 1 })) });
};
const state = async label => page.evaluate(l => {
  const v = window.__view, wr = v.workspaceEl.getBoundingClientRect();
  const el = v.domLayerEl.querySelector('[data-id="t1"]');
  const r = el.getBoundingClientRect();
  const vt = v.data.viewTransform, wr0 = v.workspaceEl.getBoundingClientRect();
  const drift = {};
  for (const [id, doc] of [["t1", [60, 300]], ["tb1", [60, 500]], ["e1", [60, 660]]]) {
    const node = v.domLayerEl.querySelector(`[data-id="${id}"]`);
    if (!node) { drift[id] = "ausente"; continue; }
    const box = node.getBoundingClientRect();
    drift[id] = [Math.round(box.left - (wr0.left + doc[0] * vt.scale + vt.x)), Math.round(box.top - (wr0.top + doc[1] * vt.scale + vt.y))];
  }
  const canvas = v.renderer.canvas.getBoundingClientRect();
  return { label: l, scale: +v.data.viewTransform.scale.toFixed(3), pan: [Math.round(v.data.viewTransform.x), Math.round(v.data.viewTransform.y)],
    box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    board: [Math.round(wr.left), Math.round(wr.top), Math.round(wr.width), Math.round(wr.height)],
    canvas: [Math.round(canvas.left), Math.round(canvas.top), Math.round(canvas.width), Math.round(canvas.height)],
    pageScale: visualViewport.scale, docScroll: [Math.round(scrollX), Math.round(scrollY)], drift };
}, label);
const before = await state("antes");
console.log(JSON.stringify(before));
assert.deepEqual(before.drift, { t1: [0, 0], tb1: [0, 0], e1: [0, 0] }, "elements start where the board puts them");
// Pinch out around the middle of the board.
await touch("touchStart", [[140, 500], [250, 560]]);
for (let step = 1; step <= 8; step++) {
  const spread = 1 + step * 0.35;
  await touch("touchMove", [[195 - 55 * spread, 530 - 30 * spread], [195 + 55 * spread, 530 + 30 * spread]]);
}
await touch("touchEnd", []);
await new Promise(r => setTimeout(r, 200));
const after = await state("tras pellizcar");
console.log(JSON.stringify(after));
assert.ok(after.scale > before.scale * 2, "the pinch has to zoom the board: " + after.scale);
assert.equal(after.pageScale, 1, "the pinch zooms the board, never the page around it");
assert.deepEqual(after.drift, { t1: [0, 0], tb1: [0, 0], e1: [0, 0] }, "a text box, a table and an image stay put at " + after.scale + "x");
assert.deepEqual(after.canvas, after.board, "the ink canvas still covers the board exactly");
console.log(`PASS 390x844: elements hold their place from ${before.scale}x to ${after.scale}x`);
fs.mkdirSync(path.join(root, "dev-harness", "shots82"), { recursive: true });
await page.screenshot({ path: path.join(root, "dev-harness", "shots82", "zoom-phone.png") });
await browser.close();
server.close();
