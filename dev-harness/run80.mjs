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
    await page.evaluate(() => { const s = document.querySelector(".view-container"); s.style.top = "60px"; s.style.bottom = "20px"; window.__view.handleResize(); });
    const rows = await page.evaluate(() => {
      const out = [];
      for (const bar of document.querySelectorAll(".onenote-ribbon-dock, .notelens-insert-dock, .notelens-document-dock, .notelens-navigation-controls, .onenote-quick-tags, .notelens-bookmarks-dock, .notelens-pages-dock")) {
        if (getComputedStyle(bar).display === "none") continue;
        for (const btn of bar.querySelectorAll("button")) {
          const svg = btn.querySelector("svg");
          if (!svg || !svg.getClientRects().length) continue;
          const b = btn.getBoundingClientRect(), s = svg.getBoundingClientRect();
          out.push({ bar: bar.className.split(" ")[0], label: btn.getAttribute("aria-label") || btn.className.split(" ")[0], bw: b.width, bh: b.height, w: s.width, h: s.height });
        }
      }
      return out;
    });
    fs.mkdirSync(path.join(root, "dev-harness", "shots80"), { recursive: true });
    await page.screenshot({ path: path.join(root, "dev-harness", "shots80", `${width}-${height}.png`) });
    // A rail out of room scrolls; a button squeezed under its own icon is the bug.
    for (const r of rows) {
      const floor = r.bar === "onenote-quick-tags" ? 16 : 18;
      assert.ok(r.w >= floor && r.h >= floor, `${width}x${height} ${r.bar} "${r.label}": icon ${r.w}x${r.h} under ${floor}px`);
      assert.ok(r.w <= r.bw - 2 && r.h <= r.bh - 2, `${width}x${height} ${r.bar} "${r.label}": icon ${r.w}x${r.h} overflows button ${r.bw}x${r.bh}`);
      assert.equal(Math.round(r.w), Math.round(r.h), `${width}x${height} ${r.bar} "${r.label}": icon squeezed to ${r.w}x${r.h}`);
    }
    console.log(`PASS ${width}x${height}: ${rows.length} toolbar icons keep their size inside their buttons`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
