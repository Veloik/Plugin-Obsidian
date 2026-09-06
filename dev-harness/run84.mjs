// The plugin's fullscreen on a phone with a notch: no control may end up under
// the clock at the top or the home bar at the bottom.
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
  for (const [width, height, top, bottom] of [[390, 844, 47, 34], [844, 390, 0, 21], [360, 740, 24, 16]]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(([top, bottom]) => {
      window.__presetPlatform = { isMobile: true, isDesktop: false, isPhone: true, isIosApp: true };
      window.__presetSettings = { showAssistantPet: false };
      // What the phone keeps for itself, the way Obsidian publishes it.
      addEventListener("DOMContentLoaded", () => {
        document.body.style.setProperty("--safe-area-inset-top", `${top}px`);
        document.body.style.setProperty("--safe-area-inset-bottom", `${bottom}px`);
      });
    }, [top, bottom]);
    await page.goto(`http://127.0.0.1:${server.address().port}/dev-harness/index.html`);
    await page.waitForFunction(() => window.__ready || window.__bootError);
    // A leaf that does not own the whole screen, the way a phone shows a note.
    await page.evaluate(() => {
      const shell = document.querySelector(".view-container");
      shell.style.top = "56px";
      shell.style.bottom = "44px";
      window.__view.handleResize();
    });
    await page.evaluate(() => window.__view.toggleFullscreen());
    await new Promise(resolve => setTimeout(resolve, 350));

    const report = await page.evaluate(([top, bottom]) => {
      const v = window.__view, wr = v.workspaceEl.getBoundingClientRect();
      const outside = [];
      for (const el of v.workspaceEl.querySelectorAll(".onenote-ribbon-dock, .notelens-insert-dock, .onenote-quick-tags, .notelens-document-dock, .notelens-navigation-controls, .notelens-bookmarks-dock, .notelens-pages-dock, .notelens-settings-btn, .notelens-focus-toggle")) {
        if (getComputedStyle(el).display === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.top < top - 0.5 || r.bottom > innerHeight - bottom + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5) {
          outside.push(`${el.className.split(" ")[0]} (${Math.round(r.top)}..${Math.round(r.bottom)})`);
        }
      }
      return { fullscreen: v.isFullscreen(), board: [Math.round(wr.top), Math.round(wr.bottom)], outside };
    }, [top, bottom]);
    assert.ok(report.fullscreen, `${width}x${height}: fullscreen must be on`);
    assert.ok(report.board[0] >= top - 0.5 && report.board[1] <= height - bottom + 0.5,
      `${width}x${height}: the board must keep the screen's own room: ${JSON.stringify(report.board)} against ${top}/${bottom}`);
    assert.deepEqual(report.outside, [], `${width}x${height}: controls under the clock or the home bar: ${report.outside.join(", ")}`);

    // Leaving fullscreen puts the board back inside its leaf.
    await page.evaluate(() => window.__view.toggleFullscreen());
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.ok(await page.evaluate(() => !window.__view.isFullscreen() && !document.querySelector(".notelens-mobile-viewport")),
      `${width}x${height}: leaving fullscreen restores the board`);

    fs.mkdirSync(path.join(root, "dev-harness", "shots84"), { recursive: true });
    await page.evaluate(() => window.__view.toggleFullscreen());
    await new Promise(resolve => setTimeout(resolve, 250));
    await page.screenshot({ path: path.join(root, "dev-harness", "shots84", `${width}-${height}.png`) });
    console.log(`PASS ${width}x${height} (notch ${top}px, home bar ${bottom}px): every control lands on usable screen`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
