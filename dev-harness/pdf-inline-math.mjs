// PDF export of a sentence with maths inside it: "$\pi r^2$" typed in a
// text box must print typeset among the words, not as its source, while a
// box with no maths still exports as real (selectable) text. Writes the
// picture of the box and the PDF to shots53/.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots53");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
let failed = 0;
const check = (ok, label, detail = "") => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`); };

await page.evaluate(() => {
	const page = __view.data.activePageId;
	__view.data.texts.push(
		{ id: "t-math", pageId: page, x: 160, y: 200, text: "El área es $\\pi r^2$ y **crece** con ==el radio==", fontSize: 22, color: "#f8fafc", variant: "text", autoWidth: true, w: 520, h: 50 },
		{ id: "t-plain", pageId: page, x: 160, y: 320, text: "Texto normal sin formulas", fontSize: 22, color: "#f8fafc", variant: "text", autoWidth: true, w: 400, h: 50 }
	);
	__view.renderAll();
});
await sleep(1500);
const typeset = await page.evaluate(() => !!document.querySelector('[data-id="t-math"] mjx-container'));
check(typeset, "la fórmula está compuesta en la pizarra");

const images = await page.evaluate(async () => {
	const map = await __view.constructor.prototype.rasterizeFormulas.call(__view, __view.data);
	return Object.fromEntries([...map].map(([id, img]) => [id, { w: img.width, h: img.height, url: img.dataUrl }]));
});
check(!!images["t-math"] && !images["t-plain"], "la frase con $…$ se convierte en imagen y la otra no", Object.keys(images).join(","));
if (images["t-math"]) fs.writeFileSync(path.join(shots, "frase-con-formula.png"), Buffer.from(images["t-math"].url.split(",")[1], "base64"));

await page.evaluate(() => {
	__view.app.vault.createBinary = async (p, data) => { window.__pdf = Array.from(new Uint8Array(data)); return new window.__TFile(p); };
	__view.app.vault.getAbstractFileByPath = () => null;
});
await page.evaluate(() => __view.exportA4Pdf());
await sleep(1500);
const bytes = Buffer.from(await page.evaluate(() => window.__pdf ?? []));
check(bytes.length > 0, "el PDF se genera");
fs.writeFileSync(path.join(shots, "frase-con-formula.pdf"), bytes);
// Page content streams are deflated: read them as the viewer will.
const raw = bytes.toString("latin1");
const text = raw + [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map(m => {
	try { return zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { return ""; }
}).join("\n");
check(!/\\pi r\^2|\$\\pi/.test(text), "el código de la fórmula no aparece como texto");
check(/Texto normal/.test(text), "el cuadro sin fórmulas sigue siendo texto");
check((text.match(/\/Subtype ?\/Image/g) || []).length >= 1, "la frase entra como imagen");
console.log("errores de página:", errors.length ? errors.slice(0, 3) : "(ninguno)");
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;
console.log(failed ? `${failed} fallo(s)` : "todo correcto");
