// Board-to-LaTeX uses existing notation exactly and a reachable region selector.
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
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", req => req.url().startsWith("http://127.0.0.1:") || req.url().startsWith("data:") ? req.continue() : req.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/dev-harness/index.html`);
  await page.waitForFunction(() => window.__ready || window.__bootError);

  const crossing = await page.evaluate(async () => {
    const v = window.__view;
    v.data.texts = [];
    v.data.strokes = [{ id: "cross", pageId: v.data.activePageId, type: "pen", width: 3, color: "#000", points: [{ x: -50, y: 50, p: .5 }, { x: 150, y: 50, p: .5 }] }];
    return v.readRegion({ x: 0, y: 0, w: 100, h: 100 }, "__formula__", () => {});
  });
  assert.equal(crossing, "-", "a crossing stroke is included even with no sampled points inside");
  await page.evaluate(() => window.__view.insertMathBlock());
  const r = await page.$eval('.notelens-ink-board canvas', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  const line = async (x1,y1,x2,y2) => {
    await page.mouse.move(r.x+x1,r.y+y1); await page.mouse.down();
    await page.mouse.move(r.x+x2,r.y+y2,{steps: 8}); await page.mouse.up();
  };
  const clickTool = async text => page.evaluate(text => [...document.querySelectorAll('.notelens-ink-tool')].find(b => b.textContent.trim() === text).click(), text);
  const bitmap = () => page.$eval('.notelens-ink-board canvas', el => el.toDataURL());
  await line(80,100,180,100); await line(130,50,130,150);
  await page.waitForFunction(() => document.querySelector('.notelens-ink-source').value === '+');
  const complete = await bitmap();
  await clickTool('Borrar');
  await page.mouse.click(r.x+95,r.y+100);
  const erased = await bitmap();
  assert.notEqual(erased,complete);
  await clickTool('Deshacer'); assert.equal(await bitmap(),complete,'undo restores erased strokes');
  await clickTool('Rehacer'); assert.equal(await bitmap(),erased,'redo reapplies erasing');
  await clickTool('Eliminar');
  assert.equal(await page.$eval('.notelens-ink-source',el=>el.value),'');
  await clickTool('Deshacer'); assert.equal(await bitmap(),erased,'clear is undoable');
  await clickTool('Rehacer');
  await page.waitForFunction(() => document.querySelector('.notelens-ink-source').value === '');
  await page.click('.notelens-ink-footer button:last-child');
  const canceled = await page.evaluate(() => {
    const v = window.__view;
    const event = { stopPropagation() {}, preventDefault() {}, clientX: 10, clientY: 10, pointerType: 'touch', target: document.body };
    v.startRulerDrag(event);
    window.dispatchEvent(new PointerEvent('pointermove', {clientX: 30, clientY: 30}));
    window.dispatchEvent(new PointerEvent('pointercancel'));
    const before = JSON.stringify(v.rulerState);
    window.dispatchEvent(new PointerEvent('pointermove', {clientX: 300, clientY: 300}));
    return before === JSON.stringify(v.rulerState);
  });
  assert.equal(canceled, true, 'cancelled ruler drag releases the pointer');
  console.log('PASS: crossing-region ink, live plus recognition, erasing, undo, redo, clear and stale-result cleanup');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
