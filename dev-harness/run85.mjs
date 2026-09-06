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
  for (const source of [String.raw`\sqrt{x}+\pi`, String.raw`\int_0^1 x^2\,dx`, String.raw`\sum_{n=1}^{\infty}\frac{1}{n^2}`, String.raw`\begin{aligned}x&=1\\y&=2\end{aligned}`, "O + I", "x_{12}+y^{34}"]) {
    const actual = await page.evaluate(source => window.__assistantTest.tidyFormulaText(source), source);
    assert.equal(actual, source, "preserve valid notation: " + source);
    assert.equal(await page.evaluate(source => window.__assistantTest.tidyFormulaText(source), actual), source, "normalization is idempotent");
  }
  assert.equal(await page.evaluate(() => window.__assistantTest.tidyFormulaText("$$\\sqrt{x}+\\pi$$")), String.raw`\sqrt{x}+\pi`);
  const source = String.raw`\int_0^1\sqrt{x}\,dx=\frac{2}{3}`;
  await page.evaluate(source => {
    const v = window.__view;
    v.data.texts = [{ id: "formula", pageId: v.data.activePageId, x: 170, y: 260, w: 280, h: 60, text: source, fontSize: 22, color: "#fff", variant: "math" }];
    v.data.strokes = [];
    v.renderAll();
    v.openFormulaReader();
  }, source);
  assert.ok(await page.$(".notelens-capture-overlay"), "board action starts with region selection");
  assert.equal(await page.$(".notelens-ink-equation"), null, "no modal covers selection");
  const selectRegion = async () => {
    const rect = await page.$eval(".onenote-workspace", el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await page.mouse.move(rect.x + 150, rect.y + 240);
    await page.mouse.down();
    await page.mouse.move(rect.x + 480, rect.y + 340, { steps: 8 });
    await page.mouse.up();
  };
  await selectRegion();
  await page.waitForSelector(".notelens-ink-source");
  assert.equal(await page.$eval(".notelens-ink-source", el => el.value), source, "captured formula reaches editable preview unchanged");
  await page.click(".notelens-ink-mode");
  await page.click('.notelens-ink-tool:last-child');
  assert.ok(await page.$eval(".notelens-capture-overlay", el => {
    const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + 160, r.top + 240));
  }), "modal backdrop does not block selection");
  await page.click(".notelens-capture-overlay button");
  assert.equal(await page.$eval(".notelens-ink-source", el => el.value), source, "cancel preserves notation");
  await page.click('.notelens-ink-tool:last-child');
  await selectRegion();
  await page.waitForFunction(() => document.querySelector(".modal-container").style.display !== "none");
  assert.equal(await page.$eval(".notelens-ink-source", el => el.value), source);
  await page.click(".notelens-ink-footer .mod-cta");
  assert.equal(await page.evaluate(() => window.__view.data.texts.at(-1).text), source, "insertion preserves the reviewed source");
  const offline = await page.evaluate(async () => {
    const v = window.__view;
    const points = Array.from({ length: 80 }, (_, i) => ({ x: 100 + Math.cos(i * .3) * i, y: 100 + Math.sin(i * .3) * i, p: .5 }));
    v.data.texts = [];
    v.data.strokes = [{ id: "uncertain", pageId: v.data.activePageId, type: "pen", width: 3, color: "#fff", points }];
    const vector = window.__assistantTest.recognizeInkFormula([{ points }]);
    const read = await v.readRegion({ x: 0, y: 0, w: 250, h: 250 }, "__formula__", () => {});
    return { read, expected: vector.source };
  });
  assert.equal(offline.read, offline.expected, "offline OCR failure retains ink reading");
  console.log("PASS: LaTeX preservation, idempotence, region selection, modal visibility, cancellation, insertion and offline ink fallback");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
