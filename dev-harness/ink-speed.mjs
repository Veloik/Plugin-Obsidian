// How long one symbol takes to read, which decides how many prototypes fit.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CASES } from "./ink-corpus.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security"], defaultViewport: { width: 900, height: 700 } });
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready);
const single = CASES.filter(c => c.label.includes("#")).slice(0, 20);
const out = await page.evaluate((cases) => {
  const r = window.__assistantTest.recognizeInkFormula;
  r(cases[0].strokes); // warm up
  const t0 = performance.now();
  for (const c of cases) r(c.strokes);
  const per = (performance.now() - t0) / cases.length;
  return { perSymbol: Math.round(per), prototypes: window.__assistantTest.matchShape(cases[0].strokes.map(s => s.points)).length };
}, single);
console.log(`${out.perSymbol} ms por símbolo · ${out.prototypes} símbolos distintos en el resultado`);
console.log(out.perSymbol < 60 ? "rápido para una fórmula de 10 glifos" : "demasiado lento");
await browser.close();
