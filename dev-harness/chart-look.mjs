// Photographs one chart of each kind on the board.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
await page.setViewport({ width: 1500, height: 950 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.evaluate(() => {
	const v = window.__view;
	v.data.embeds.length = 0;
	const base = { showLegend: true, showGrid: true, xMin: -6.3, xMax: 6.3 };
	const specs = [
		{ type: "bar", title: "Notas por trimestre", data: "# Mates; Física\nT1; 6.5; 5\nT2; 7.5; 6.5\nT3; 8; 7.2\nT4; 9; 8.4" },
		{ type: "line", title: "Horas de estudio", data: "# Esta semana; La anterior\nL; 2; 1\nM; 3.5; 2\nX; 3; 2.5\nJ; 5; 3\nV; 4; 3.5" },
		{ type: "area", title: "Tareas entregadas", data: "Sep; 4\nOct; 9\nNov; 7\nDic; 14\nEne; 12" },
		{ type: "pie", title: "Dónde se va el tiempo", data: "Clase; 30\nEstudio; 22\nDeporte; 8\nOcio; 12\nSueño; 40" },
		{ type: "scatter", title: "Horas de estudio y nota", data: "1; 4\n2; 5\n3; 5.5\n4; 6.8\n5; 7\n6; 8.1\n7; 8.4\n8; 9" },
		{ type: "function", title: "Ondas", data: "", functions: "sin(x)\ncos(x)/2 + 0.3" }
	];
	specs.forEach((s, i) => v.data.embeds.push({ id: "c" + i, pageId: v.data.activePageId, kind: "chart", src: "", x: 40 + (i % 3) * 480, y: 130 + Math.floor(i / 3) * 400, w: 450, h: 370, chart: { ...base, ...s } }));
	v.renderAll();
});
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: path.join(here, "shots-charts-board.png") });
await browser.close();
