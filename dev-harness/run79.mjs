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
  for (const [width, height] of [[390, 844], [844, 390], [320, 568]]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => {
      window.__presetPlatform = { isMobile: true, isDesktop: false, isPhone: true, isIosApp: true };
      window.__presetSettings = { showAssistantPet: false };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/dev-harness/index.html`);
    await page.waitForFunction(() => window.__ready || window.__bootError);
    await page.evaluate(() => {
      const shell = document.querySelector(".view-container");
      shell.style.top = "60px";
      shell.style.bottom = "20px";
      window.__view.handleResize();
    });
    await page.click(".notelens-settings-btn");
    for (const selector of [".notelens-settings-panel", ".notelens-shortcuts"]) {
      if (selector === ".notelens-shortcuts") await page.evaluate(() => document.querySelector(".notelens-nav-help").click());
      const bounds = await page.evaluate(selector => {
        const p = document.querySelector(selector), r = p.getBoundingClientRect(), b = window.__view.workspaceEl.getBoundingClientRect();
        p.scrollTop = p.scrollHeight;
        const close = p.querySelector(".notelens-embed-close"), c = close.getBoundingClientRect();
        return { fits: r.top >= b.top && r.bottom <= b.bottom && r.left >= b.left && r.right <= b.right, scrollable: p.scrollHeight <= p.clientHeight || p.scrollTop > 0, closeVisible: c.top >= r.top && c.bottom <= r.bottom && close.contains(document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2)), noHorizontalClip: p.scrollWidth <= p.clientWidth + 1 };
      }, selector);
      if (!bounds.closeVisible) await page.screenshot({ path: path.join(root, "dev-harness", "panel-debug.png") });
      assert.ok(bounds.fits && bounds.scrollable && bounds.closeVisible && bounds.noHorizontalClip, `${width}x${height} ${selector}: ${JSON.stringify(bounds)}`);
      await page.click(selector + " .notelens-embed-close");
      assert.ok(await page.evaluate(selector => document.querySelector(selector).classList.contains("hidden"), selector), "close button hides panel");
    }
    if (width <= 700) {
      const gap = await page.evaluate(() => {
        const d = document.querySelector(".notelens-document-dock").getBoundingClientRect(), n = document.querySelector(".notelens-navigation-controls").getBoundingClientRect();
        return Math.max(d.top - n.bottom, n.top - d.bottom, d.left - n.right, n.left - d.right);
      });
      assert.ok(gap >= 6, "navigation needs a visible gap above document dock: " + gap);
    }
    fs.mkdirSync(path.join(root, "dev-harness", "shots79"), { recursive: true });
    await page.click(".notelens-settings-btn");
    await page.screenshot({ path: path.join(root, "dev-harness", "shots79", `${width}-${height}.png`) });
    console.log(`PASS ${width}x${height}: panels fit, scroll and close; navigation separated`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
