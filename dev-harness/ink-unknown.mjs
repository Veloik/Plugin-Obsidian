// The reader must say it does not know, instead of naming the least unlike
// letter. Draws things the library has never seen and checks each is reported.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { path as penPath, line, ring } from "./ink-corpus.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const strokes = (...ps) => ps.map(p => ({ points: p.map(([x, y]) => ({ x, y })) }));
const UNKNOWN = {
  "espiral": strokes(Array.from({ length: 60 }, (_, i) => { const t = i / 8, r = 3 + t * 3.4; return [32 + r * Math.cos(t), 34 + r * Math.sin(t)]; })),
  "garabato": strokes(penPath([[8, 40], [24, 12], [30, 52], [44, 16], [50, 56], [60, 26]])),
  "corazon": strokes(penPath([[32, 60], [8, 34], [16, 14], [32, 26], [48, 14], [56, 34], [32, 60]])),
  "casa": strokes(penPath([[10, 60], [10, 30], [32, 10], [54, 30], [54, 60], [10, 60]])),
  "estrella": strokes(penPath([[32, 6], [42, 38], [58, 38], [45, 50], [50, 62], [32, 46], [14, 62], [19, 50], [6, 38], [22, 38], [32, 6]])),
  "cara": strokes(ring(32, 34, 24, 26), line(24, 26, 24, 30), line(40, 26, 40, 30), penPath([[20, 44], [32, 52], [44, 44]]))
};
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security"], defaultViewport: { width: 900, height: 700 } });
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready);
// Symbols the library does know: they must be read, not rejected.
const KNOWN = {
  "aprox (~~)": ["~~", strokes(penPath([[10, 28], [20, 22], [30, 32], [40, 24]]), penPath([[10, 44], [20, 38], [30, 48], [40, 40]]))],
  "nabla (grad)": ["grad", strokes(line(10, 10, 54, 10), line(54, 10, 32, 60), line(32, 60, 10, 10))]
};
let honest = 0;
for (const [label, s] of Object.entries(UNKNOWN)) {
  const out = await page.evaluate(st => { const r = window.__assistantTest.recognizeInkFormula(st); return { src: r.source, unknown: r.unknown, detail: r.detail, alt: r.tokens.map(t => t.alternatives.slice(0, 3).join("")) }; }, s);
  const ok = out.unknown > 0;
  if (ok) honest++;
  console.log(`${ok ? "ok  " : "INVENTA"} ${label.padEnd(10)} → ${JSON.stringify(out.src).padEnd(10)} desconocidos:${out.unknown} · sugiere ${JSON.stringify(out.alt)}`);
}
console.log("");
let read = 0;
for (const [label, entry] of Object.entries(KNOWN)) {
  const [expected, sk] = entry;
  const out = await page.evaluate(st => window.__assistantTest.recognizeInkFormula(st).source, sk);
  const ok = out.replace(/\s+/g, "") === expected;
  if (ok) read++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(12)} -> ${JSON.stringify(out)} (esperado ${JSON.stringify(expected)})`);
}
console.log(`SIMBOLOS CONOCIDOS: ${read}/${Object.keys(KNOWN).length}`);
console.log(`\nHONESTIDAD: ${honest}/${Object.keys(UNKNOWN).length} dicen que no lo reconocen`);
console.log("detalle de ejemplo:", (await page.evaluate(s => window.__assistantTest.recognizeInkFormula(s).detail, UNKNOWN["corazon"])));
await browser.close();
