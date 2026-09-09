import puppeteer from "puppeteer-core";
import path from "node:path";
import { pathToFileURL } from "node:url";
const here = "C:/Users/jtiob/Desktop/Nueva carpeta/NoteLens/dev-harness";
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files","--disable-web-security","--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
await page.setViewport({ width: 1200, height: 900 });
await page.evaluateOnNewDocument(() => { window.__presetPlatform={isMobile:false,isDesktop:true,isPhone:false,isIosApp:false}; window.__presetSettings={showAssistantPet:false}; });
await page.goto(pathToFileURL(path.join(here,"index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };
const runs = () => page.evaluate(() => {
  const tb = window.__view.activeRichBox;
  return (tb?.runs ?? []).map(r => [r.text, r.bold ? "B" : "", r.italic ? "I" : "", r.underline ? "U" : "", r.strike ? "S" : "", r.mark ?? ""].filter(Boolean).join("|"));
});
const text = () => page.evaluate(() => (window.__view.activeRichBox?.runs ?? []).map(r => r.text).join(""));
const select = (from, to) => page.evaluate(([f, t]) => {
  const v = window.__view; v.activeTextEditor.focus();
  window.__selectOffsets(v.activeTextEditor, f, t);
}, [from, to]);

// expose the offset helper from the bundle for the test
await page.evaluate(() => {
  const editor = document.createElement("div");
  window.__selectOffsets = (root, from, to) => {
    // walk text nodes, same rule the plugin uses: every <br> counts as a newline
    const range = document.createRange();
    let seen = 0, startNode = null, startOff = 0, endNode = null, endOff = 0;
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          const len = child.data.length;
          if (startNode === null && seen + len >= from) { startNode = child; startOff = from - seen; }
          if (endNode === null && seen + len >= to) { endNode = child; endOff = to - seen; }
          seen += len;
        } else if (child.nodeName === "BR") { seen += 1; }
        else walk(child);
      }
    };
    walk(root);
    if (!startNode || !endNode) return;
    range.setStart(startNode, startOff); range.setEnd(endNode, endOff);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  };
  void editor;
});

// --- open a text box and type ------------------------------------------------
await page.evaluate(() => {
  const v = window.__view, el = document.querySelector(".onenote-workspace");
  v.setTool("text");
  const r = v.workspaceEl.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles:true, cancelable:true, clientX:r.left+300, clientY:r.top+300, pointerId:9, pointerType:"mouse", isPrimary:true, button:0, buttons:1 }));
});
await page.evaluate(() => window.__view.activeTextEditor?.focus());
await page.keyboard.type("hola mundo");
ok("escribir mete texto", (await text()).includes("hola mundo"), await text());

// --- bold over a selection ---------------------------------------------------
await select(5, 10);
await page.keyboard.down("Control"); await page.keyboard.press("b"); await page.keyboard.up("Control");
let r = await runs();
ok("Ctrl+B pone negrita solo en lo seleccionado", JSON.stringify(r) === JSON.stringify(["hola ", "mundo|B"]), JSON.stringify(r));

// --- undo / redo -------------------------------------------------------------
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
r = await runs();
ok("Ctrl+Z deshace la negrita", JSON.stringify(r) === JSON.stringify(["hola mundo"]), JSON.stringify(r));
await page.keyboard.down("Control"); await page.keyboard.press("y"); await page.keyboard.up("Control");
r = await runs();
ok("Ctrl+Y la rehace", JSON.stringify(r) === JSON.stringify(["hola ", "mundo|B"]), JSON.stringify(r));

// --- armed style with nothing selected --------------------------------------
await select(10, 10);
await page.keyboard.down("Control"); await page.keyboard.press("i"); await page.keyboard.up("Control");
await page.keyboard.type("!");
r = await runs();
ok("cursiva sin selección viste lo que se escribe después", r.some(x => x.startsWith("!") && x.includes("I")), JSON.stringify(r));

// --- Tab and Enter -----------------------------------------------------------
await page.keyboard.press("Tab");
ok("Tab mete un tabulador", (await text()).includes("\t"), JSON.stringify(await text()));
await page.keyboard.press("Enter");
await page.keyboard.type("• uno");
await page.keyboard.press("Enter");
const t = await text();
ok("Enter continúa la lista", t.split("\n").filter(l => l.startsWith("• ")).length >= 2, JSON.stringify(t));

// --- undo after typing -------------------------------------------------------
const before = await text();
await page.keyboard.type("ZZZ");
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
ok("Ctrl+Z deshace lo escrito", (await text()) === before, JSON.stringify(await text()) + " vs " + JSON.stringify(before));

// --- the marker and clearing formatting -------------------------------------
await select(0, 4);
await page.evaluate(() => {
  const v = window.__view;
  v.formatRich(v.activeRichBox, v.activeTextEditor, "hiliteColor", "rgb(255, 238, 136)");
});
r = await runs();
ok("el marcador tiñe solo lo seleccionado", r[0].includes("rgb(255, 238, 136)"), JSON.stringify(r.slice(0, 2)));
await select(0, 4);
await page.evaluate(() => {
  const v = window.__view;
  v.formatRich(v.activeRichBox, v.activeTextEditor, "hiliteColor", "transparent");
});
r = await runs();
ok("«sin resaltado» lo quita", !r.some(x => x.includes("rgb(255, 238, 136)")), JSON.stringify(r.slice(0, 2)));
await select(0, 10);
await page.evaluate(() => {
  const v = window.__view;
  v.formatRich(v.activeRichBox, v.activeTextEditor, "removeFormat");
});
r = await runs();
ok("limpiar formato desnuda lo seleccionado y respeta el resto",
	r[0] === "hola mundo" && r.slice(1).some(x => x.includes("|")), JSON.stringify(r));

const failed = process.exitCode === 1;
if (!failed) console.log("todo correcto");
await browser.close();
