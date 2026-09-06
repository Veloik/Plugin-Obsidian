// Shift draws a straight line, whole, with the pen and with the marker.
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

  // A wandering drag, with Shift down from the start or pressed part way in.
  // Reports the stroke kept and what the board actually has ink on.
  const drag = (tool, pointerType, shiftFrom, release) => page.evaluate(({ tool, pointerType, shiftFrom, release }) => {
    const v = window.__view;
    v.setTool(tool);
    v.data.strokes = [];
    v.renderAll();
    const el = document.querySelector(".onenote-workspace");
    const r = el.getBoundingClientRect();
    const steps = 12, from = { x: 200, y: 300 };
    const to = { x: 200 + steps * 25, y: 300 + Math.sin(steps) * 60 };
    const ev = (type, x, y, shift, buttons = 1) => new PointerEvent(type, {
      pointerId: 7, pointerType, isPrimary: true, button: 0, buttons,
      clientX: r.left + x, clientY: r.top + y, shiftKey: shift, pressure: 0.6, bubbles: true, cancelable: true
    });
    el.dispatchEvent(ev("pointerdown", from.x, from.y, shiftFrom === 0));
    for (let i = 1; i <= steps; i++) window.dispatchEvent(ev("pointermove", 200 + i * 25, 300 + Math.sin(i) * 60, i >= shiftFrom));
    if (release) window.dispatchEvent(ev("pointerup", to.x, to.y, true, 0));

    const stroke = v.data.strokes.at(-1);
    const pts = stroke.points;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const strays = (p) => Math.abs((to.x - from.x) * (from.y - p.y) - (from.x - p.x) * (to.y - from.y)) / len;
    // Ink on the canvas: how far it strays from the line, and how much of the
    // line's length it covers — a line drawn half way answers 0.5 here.
    const c = v.renderer.canvas;
    const img = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const dpr = c.width / c.getBoundingClientRect().width;
    let worst = 0, reach = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (img[(y * c.width + x) * 4 + 3] < 40) continue;
      const p = { x: x / dpr, y: y / dpr };
      worst = Math.max(worst, strays(p));
      reach = Math.max(reach, ((to.x - from.x) * (p.x - from.x) + (to.y - from.y) * (p.y - from.y)) / (len * len));
    }
    return { points: pts.length, offLine: Math.max(...pts.map(strays)), inkOffLine: worst, inkReach: reach, width: stroke.width };
  }, { tool, pointerType, shiftFrom, release });

  for (const tool of ["pen", "highlighter"]) {
    for (const pointerType of ["mouse", "pen"]) {
      for (const shiftFrom of [0, 6]) {
        for (const release of [false, true]) {
          const what = `${tool}/${pointerType}/shift from move ${shiftFrom}/${release ? "after" : "during"}`;
          const got = await drag(tool, pointerType, shiftFrom, release);
          assert.equal(got.points, 2, `${what}: the stroke is kept as two points`);
          assert.ok(got.offLine < 0.01, `${what}: those points are the ends of the line`);
          assert.ok(got.inkOffLine <= got.width, `${what}: no ink strays off the line (${got.inkOffLine.toFixed(1)}px)`);
          assert.ok(got.inkReach > 0.98, `${what}: the ink reaches the far end (${(got.inkReach * 100).toFixed(0)}%)`);
        }
      }
    }
  }
  console.log("PASS: Shift + pen and Shift + marker draw the whole straight line, held or joined mid-stroke, live and once released");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
