// The native webview can resize synchronously during focus, before focus() returns.
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
  for (const clipped of [false, true]) for (const variant of ["text", "code", "math"]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(clipped => {
      window.__presetPlatform = { isMobile: true, isDesktop: false, isPhone: true, isIosApp: true };
      window.__presetSettings = { showAssistantPet: false };
      const viewport = new EventTarget();
      Object.assign(viewport, { height: innerHeight, width: innerWidth, offsetTop: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", { value: viewport });
      const fullHeight = innerHeight;
      window.__restoreKeyboard = () => {
        Object.defineProperty(window, "innerHeight", { configurable: true, value: fullHeight });
        viewport.height = fullHeight;
        document.querySelector(".view-container").style.height = "";
        document.querySelector(".view-container").style.maxHeight = "";
        document.getElementById("native-keyboard-clip")?.remove();
        viewport.dispatchEvent(new Event("resize"));
      };
      document.addEventListener("focus", event => {
        if (!event.target.matches(".notelens-text-editor")) return;
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 422 });
        viewport.height = 422;
        document.querySelector(".view-container").style.height = "88px";
        if (clipped) {
          const css = document.createElement("style");
          css.id = "native-keyboard-clip";
          css.textContent = ".view-container { height:88px!important; min-height:0!important; max-height:88px!important; overflow:hidden!important; }";
          document.head.appendChild(css);
        }
        viewport.dispatchEvent(new Event("resize"));
      }, true);
    }, clipped);
    await page.goto(`http://127.0.0.1:${server.address().port}/dev-harness/index.html`);
    await page.waitForFunction(() => window.__ready || window.__bootError);
    // Both controls must be visible, unobscured and operable on a phone.
    for (const width of [320, 390]) {
      await page.setViewport({ width, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      await page.waitForFunction(() => {
        return [".notelens-nav-map", ".notelens-nav-fullscreen"].every(selector => {
          const el = document.querySelector(selector), r = el.getBoundingClientRect();
          return r.width > 0 && r.left >= 0 && r.right <= innerWidth && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        });
      });
      await page.click(".notelens-nav-map");
      assert.ok(await page.evaluate(() => window.__view.getMiniMapVisible()), "map button opens minimap");
      await page.click(".notelens-nav-map");
      await page.click(".notelens-nav-fullscreen");
      assert.ok(await page.evaluate(() => window.__view.isFullscreen() && window.__view.workspaceEl.parentElement.parentElement === document.body), "mobile fullscreen bypasses native Fullscreen API");
      await page.click(".notelens-nav-fullscreen");
      assert.ok(await page.evaluate(() => !window.__view.isFullscreen() && !document.querySelector(".notelens-mobile-viewport")), "fullscreen exit restores board");
    }
    await page.evaluate(variant => {
      const v = window.__view;
      v.data.viewTransform = { x: 10, y: 20, scale: .65 };
      v.data.texts.push({ id: "focus-test", x: 60, y: 800, w: 280, h: 48, text: "Notas", variant, color: "#ffffff", fontSize: 20 });
      v.renderAll();
      v.beginTextEdit(v.data.texts.at(-1), v.domLayerEl.querySelector('[data-id="focus-test"]'));
    }, variant);
    await new Promise(resolve => setTimeout(resolve, 450));
    await page.keyboard.type(" prueba");
    const state = await page.evaluate(() => {
      const v = window.__view, box = v.workspaceEl.getBoundingClientRect(), edit = v.activeTextEditor.getBoundingClientRect();
      return { height: box.height, bottom: box.bottom, editorBottom: edit.bottom, focused: document.activeElement === v.activeTextEditor, y: v.data.viewTransform.y, canvasHeight: v.renderer.canvas.getBoundingClientRect().height };
    });
    assert.ok(state.height > 250 && state.bottom <= 424, variant + " recovers board when focus synchronously shrinks both viewports: " + JSON.stringify(state));
    assert.ok(state.editorBottom <= 424 && state.focused, variant + " keeps typing visible and focused");
    assert.equal(state.y, 20, "keyboard does not move document coordinates");
    assert.ok(Math.abs(state.canvasHeight - state.height) < 2, "canvas covers recovered board");
    await page.evaluate(() => { window.__view.commitTextEditor(); window.__restoreKeyboard(); });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(await page.evaluate(() => window.__view.keyboardLift === 0 && !window.__view.workspaceEl.style.minHeight && !document.querySelector(".view-container").style.minHeight), "restores layout after editing");
    assert.ok(await page.evaluate(() => !document.querySelector(".notelens-mobile-viewport")), "editing restores board without orphan overlays");
    console.log("PASS mobile controls and keyboard focus: " + variant + ", clipped ancestor=" + clipped);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

