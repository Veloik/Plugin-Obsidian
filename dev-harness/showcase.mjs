// A study board with one of everything — tables, sticky notes, text, code, a
// formula, tags, shapes and ink — photographed on the dark and the light
// paper, to judge the design as a student would see it. Screenshots in
// shots-showcase/. Pass --light or --dark to take only one.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots-showcase");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const only = process.argv.includes("--light") ? ["light"] : process.argv.includes("--dark") ? ["dark"] : ["dark", "light"];

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1500, height: 1000 }
});
for (const theme of only) {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", e => errors.push(e.message));
	await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
	await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
	await sleep(600);
	await page.screenshot({ path: path.join(shots, `vacia-${theme}.png`) });
	await page.evaluate((theme) => {
		const v = window.__view;
		const pageId = v.data.activePageId;
		if (theme === "light") { v.data.backgroundColor = "#fdfcf7"; v.data.background = "lines"; v.updateBackground(); }
		v.data.tables.push({
			id: "tab1", pageId, x: 60, y: 200, w: 460, h: 190, rows: 5, cols: 3, header: true, title: "Leyes de Newton",
			cells: [["Ley", "Enunciado", "Fórmula"], ["1ª", "Inercia", "ΣF = 0"], ["2ª", "Dinámica", "F = m·a"], ["3ª", "Acción-reacción", "F₁₂ = −F₂₁"], ["", "", ""]]
		});
		v.data.tables.push({
			id: "tab2", pageId, x: 60, y: 430, w: 300, h: 150, rows: 4, cols: 2, header: true, headerColumn: true, title: "Horario",
			cells: [["", "Lunes"], ["9:00", "Física"], ["10:00", "Cálculo"], ["11:00", "Química"]]
		});
		v.data.texts.push(
			{ id: "h1", pageId, x: 60, y: 150, text: "**Tema 3 · Dinámica**", fontSize: 28, color: theme === "light" ? "#111827" : "#f8fafc", variant: "text", autoWidth: true, w: 360, h: 44 },
			{ id: "p1", pageId, x: 580, y: 200, text: "La fuerza neta es igual a la masa por la ==aceleración==. Si $F = ma$, entonces $a = F/m$.\n- Unidades: newton (N)\n- 1 N = 1 kg·m/s²", fontSize: 18, color: theme === "light" ? "#1f2937" : "#e5e7eb", variant: "text", w: 380, h: 120 },
			{ id: "s1", pageId, x: 1010, y: 200, text: "Repasar ejercicios 4–9 antes del viernes", fontSize: 18, color: "#1f2937", variant: "text", stickyColor: "#fef08a", w: 200, h: 140 },
			{ id: "s2", pageId, x: 1240, y: 210, text: "Preguntar al profe por el rozamiento", fontSize: 18, color: "#1f2937", variant: "text", stickyColor: "#bbf7d0", w: 200, h: 140 },
			{ id: "m1", pageId, x: 600, y: 380, text: "x = (-b +- sqrt(b^2-4ac))/(2a)", fontSize: 22, color: theme === "light" ? "#111827" : "#f8fafc", variant: "math", autoWidth: true, w: 320, h: 70 },
			{ id: "c1", pageId, x: 1010, y: 400, text: "def fuerza(m, a):\n    return m * a\n\nprint(fuerza(2, 9.8))", fontSize: 15, color: "#e5e7eb", variant: "code", language: "python", w: 420, h: 150 }
		);
		v.data.badges.push(
			{ id: "b1", pageId, x: 420, y: 160, tagId: "important", label: "Importante", title: "Examen" },
			{ id: "b2", pageId, x: 980, y: 380, tagId: "question", label: "Duda", title: "¿Signo?" },
			{ id: "b3", pageId, x: 60, y: 620, tagId: "task", label: "Tarea", title: "Problemas", checklist: [{ id: "c1", text: "Ej. 4", done: true }, { id: "c2", text: "Ej. 5", done: false }] }
		);
		v.data.shapes.push(
			{ id: "sh1", pageId, kind: "rectangle", x: 600, y: 520, w: 180, h: 110, color: "#38bdf8", width: 3, fill: "#38bdf8", fillOpacity: 0.12 },
			{ id: "sh2", pageId, kind: "arrow", x: 790, y: 575, w: 140, h: 0, color: "#f472b6", width: 3 },
			{ id: "sh3", pageId, kind: "ellipse", x: 940, y: 530, w: 130, h: 90, color: "#a3e635", width: 3 }
		);
		const wave = Array.from({ length: 60 }, (_, i) => ({ x: 420 + i * 6, y: 700 + Math.sin(i / 5) * 25, p: 0.5 }));
		v.data.strokes.push({ id: "k1", pageId, type: "pen", color: theme === "light" ? "#1d4ed8" : "#93c5fd", width: 3, points: wave });
		v.data.strokes.push({ id: "k2", pageId, type: "highlighter", color: "rgba(250,204,21,0.5)", width: 22, points: [{ x: 580, y: 245, p: .5 }, { x: 760, y: 245, p: .5 }] });
		v.renderAll();
	}, theme);
	await sleep(1800);
	await page.screenshot({ path: path.join(shots, `board-${theme}.png`) });
	// Close-ups: the table, a sticky note, the tags.
	for (const [id, name] of [["tab1", "tabla"], ["s1", "posit"], ["c1", "codigo"]]) {
		const el = await page.evaluateHandle((id) => window.__view.pageElement(id), id);
		const box = await el.boundingBox?.();
		if (box) await page.screenshot({ path: path.join(shots, `${name}-${theme}.png`), clip: { x: Math.max(0, box.x - 30), y: Math.max(0, box.y - 50), width: box.width + 60, height: box.height + 80 } });
	}
	// The table while editing a cell.
	await page.evaluate(() => window.__view.pageElement("tab1")?.querySelectorAll("td, .notelens-table-cell")[4]?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
	await sleep(300);
	const t = await (await page.evaluateHandle(() => window.__view.pageElement("tab1"))).boundingBox();
	if (t) await page.screenshot({ path: path.join(shots, `tabla-editando-${theme}.png`), clip: { x: Math.max(0, t.x - 30), y: Math.max(0, t.y - 70), width: t.width + 60, height: t.height + 110 } });
	if (theme === "light") {
		await page.evaluate(() => {
			window.__view.app.vault.createBinary = async (p, data) => { window.__pdf = Array.from(new Uint8Array(data)); return new window.__TFile(p); };
			window.__view.app.vault.getAbstractFileByPath = () => null;
		});
		await page.evaluate(() => window.__view.exportA4Pdf());
		await sleep(1500);
		fs.writeFileSync(path.join(shots, "pizarra.pdf"), Buffer.from(await page.evaluate(() => window.__pdf ?? [])));
	}
	// The palette of the first table, open, over a table recoloured violet.
	await page.evaluate(() => { const t = window.__view.data.tables.find(x => x.id === "tab2"); t.color = "violet"; window.__view.renderAll(); });
	await sleep(200);
	await page.hover('[data-id="tab1"] .notelens-table-header');
	await page.click('[data-id="tab1"] .notelens-table-control[title="Color de la tabla"]');
	await sleep(250);
	await page.screenshot({ path: path.join(shots, `tablas-color-${theme}.png`), clip: { x: 30, y: 180, width: 560, height: 460 } });
	console.log(theme, "errores:", errors.length ? errors.slice(0, 3) : "(ninguno)");
	await page.close();
}
await browser.close();
