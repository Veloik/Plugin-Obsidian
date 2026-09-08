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
// Manually traced from the user's screenshot, not original stylus samples.
const screenshotEquation = [
    [[146,320],[154,316],[168,312],[188,308],[196,308],[200,315],[201,337],[196,348],[185,363],[169,375],[147,380],[128,383],[162,377],[203,373],[245,372]],
    [[113,426],[153,421],[202,419],[323,420]],
    [[224,456],[239,455],[264,455],[275,458],[280,463],[280,471],[273,481],[260,491],[238,501],[212,507],[243,505],[265,514],[249,526],[229,539],[210,548],[210,544]],
    [[355,403],[375,400],[411,397]],
    [[500,354],[440,354],[437,362],[434,380],[434,392],[445,394],[465,396],[480,404],[491,412],[494,418],[494,426],[484,433],[461,435],[441,436],[440,429]],
].map(points => ({ points: points.map(([x, y]) => ({ x, y })) }));

  await page.evaluate(() => window.__view.insertMathBlock());
  const rect = await page.$eval('.notelens-ink-board canvas', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  for (const stroke of screenshotEquation) {
    const points = stroke.points.map(p => ({x: rect.x + (p.x - 61) * rect.w / 526, y: rect.y + (p.y - 284) * rect.h / 301}));
    await page.mouse.move(points[0].x,points[0].y); await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(p.x,p.y);
    await page.mouse.up();
  }
  await page.waitForFunction(() => document.querySelector('.notelens-ink-source').value === String.raw`\frac{2}{3} - 5`, {timeout:10000}).catch(async error => { console.log(await page.$eval('.notelens-ink-source', el => el.value)); console.log(await page.evaluate(strokes => window.__assistantTest.recognizeInkFormula(strokes), screenshotEquation)); throw error; });
  await page.click('.notelens-ink-footer .mod-cta');
  assert.equal(await page.evaluate(() => window.__view.data.texts.at(-1).text), String.raw`\frac{2}{3} - 5`);
  console.log('PASS: screenshot reconstruction drawn through mouse events reads and inserts two thirds minus five');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
