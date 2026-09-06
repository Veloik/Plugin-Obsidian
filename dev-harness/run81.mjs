// Writing on a phone: with the keyboard up, the box being edited has to stay
// visible and every formatting control has to be within a finger's reach.
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
  for (const [width, height] of [[390, 844], [320, 568]]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => {
      window.__presetPlatform = { isMobile: true, isDesktop: false, isPhone: true, isIosApp: true };
      window.__presetSettings = { showAssistantPet: false };
      const viewport = new EventTarget();
      Object.assign(viewport, { height: innerHeight, width: innerWidth, offsetTop: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", { value: viewport });
      const shrunk = Math.round(innerHeight / 2);
      document.addEventListener("focus", event => {
        if (!event.target.matches(".notelens-text-editor")) return;
        Object.defineProperty(window, "innerHeight", { configurable: true, value: shrunk });
        viewport.height = shrunk;
        document.querySelector(".view-container").style.height = "88px";
        viewport.dispatchEvent(new Event("resize"));
      }, true);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/dev-harness/index.html`);
    await page.waitForFunction(() => window.__ready || window.__bootError);
    await page.evaluate(() => {
      const v = window.__view;
      v.data.texts.push({ id: "t1", x: 40, y: 120, w: 240, h: 48, text: "Hola mundo", variant: "text", color: "#ffffff", fontSize: 20 });
      v.renderAll();
      v.beginTextEdit(v.data.texts.at(-1), v.domLayerEl.querySelector('[data-id="t1"]'));
    });
    await new Promise(resolve => setTimeout(resolve, 450));

    const layout = await page.evaluate(() => {
      const v = window.__view, bar = document.querySelector(".notelens-format-bar");
      const wr = v.workspaceEl.getBoundingClientRect(), br = bar.getBoundingClientRect();
      const editor = v.activeTextEditor.getBoundingClientRect();
      const rails = [".onenote-ribbon-dock", ".notelens-insert-dock", ".onenote-quick-tags", ".notelens-navigation-controls"]
        .filter(selector => { const el = document.querySelector(selector); return el && getComputedStyle(el).display !== "none"; });
      return {
        boardHeight: wr.height,
        barHeight: br.height,
        barOnBottomEdge: Math.abs(br.bottom - wr.bottom) <= 1 && Math.abs(br.left - wr.left) <= 1 && Math.abs(br.right - wr.right) <= 1,
        scrolls: bar.scrollWidth > bar.clientWidth,
        editorVisible: editor.top >= wr.top - 0.5 && editor.bottom <= br.top + 0.5,
        rails
      };
    });
    assert.ok(layout.barOnBottomEdge, `${width}x${height}: the bar must dock to the bottom edge of the board`);
    assert.ok(layout.barHeight <= layout.boardHeight * 0.25, `${width}x${height}: the bar takes ${Math.round(100 * layout.barHeight / layout.boardHeight)}% of the board`);
    assert.deepEqual(layout.rails, [], `${width}x${height}: the drawing rails must stand down while a box is being edited`);
    assert.ok(layout.editorVisible, `${width}x${height}: the box being edited must sit above the bar, not under it`);

    // Every control reachable: on screen already, or after scrolling the row to it.
    const unreachable = await page.evaluate(() => {
      const bar = document.querySelector(".notelens-format-bar");
      const out = [];
      for (const el of bar.querySelectorAll("button, select, .notelens-format-color")) {
        // Centre it the way a thumb would, clear of the pinned close button.
        el.scrollIntoView({ block: "nearest", inline: "center" });
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (r.height < 24 || !hit || !(el === hit || el.contains(hit))) out.push(el.title || el.className);
      }
      return out;
    });
    assert.deepEqual(unreachable, [], `${width}x${height}: controls a finger cannot reach: ${unreachable.join(", ")}`);

    // The buttons reach the words: select everything and underline it with a tap.
    await page.evaluate(() => {
      const editor = window.__view.activeTextEditor;
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const underline = await page.evaluateHandle(() => {
      const button = [...document.querySelectorAll(".notelens-format-bar button")].find(b => b.title.includes("Subrayado"));
      button.scrollIntoView({ block: "nearest", inline: "center" });
      return button;
    });
    await underline.asElement().tap();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(
      await page.evaluate(() => window.__view.data.texts.find(t => t.id === "t1").runs),
      [{ underline: true, text: "Hola mundo" }],
      `${width}x${height}: a tap on underline must underline the selection`
    );

    // Finishing puts the board back the way it was.
    await page.evaluate(() => window.__view.commitTextEditor());
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(await page.evaluate(() => !document.querySelector(".notelens-format-bar")
      && !window.__view.workspaceEl.classList.contains("is-editing-text")
      && getComputedStyle(document.querySelector(".onenote-ribbon-dock")).display !== "none"),
      `${width}x${height}: the rails come back when the box is done`);

    // And the box opens again for a second edit, with one tap of the text tool.
    await page.evaluate(() => window.__view.setTool("text"));
    await (await page.$('[data-id="t1"]')).tap();
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.ok(await page.evaluate(() => !!window.__view.activeTextEditor && !!document.querySelector(".notelens-format-bar")),
      `${width}x${height}: a written box opens again for editing`);

    fs.mkdirSync(path.join(root, "dev-harness", "shots81"), { recursive: true });
    await page.screenshot({ path: path.join(root, "dev-harness", "shots81", `${width}-${height}.png`) });
    console.log(`PASS ${width}x${height}: the box stays visible, the bar docks in one ${Math.round(layout.barHeight)}px row and every control is reachable`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
