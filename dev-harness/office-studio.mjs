// What a student does with the editor: start class notes from a template, undo a
// mistake, add a table and a picture, find a word; build a deck from a theme, add
// slides on a layout, move and resize what is on a slide, and open it all in a tab.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { unzipSync } from "fflate";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };
const tick = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});
const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 1500, height: 1000 });
await page.evaluateOnNewDocument(() => {
	try { localStorage.clear(); } catch { /* a private window simply forgets */ }
	window.__presetSettings = { showAssistantPet: false };
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

await page.evaluate(() => {
	const v = window.__view;
	const store = {};
	window.__store = store;
	window.__written = {};
	v.app.vault.getFileByPath = (p) => store[p]?.file ?? null;
	v.app.vault.getAbstractFileByPath = (p) => store[p]?.file ?? null;
	v.app.vault.readBinary = async (f) => store[f.path].data.buffer.slice(0);
	v.app.vault.modifyBinary = async (f, buf) => { window.__written[f.path] = Array.from(new Uint8Array(buf)); f.stat.mtime += 1; };
	v.app.vault.getFolderByPath = () => ({});
	v.app.fileManager = { getAvailablePathForAttachment: async (p) => p };
	v.app.vault.createBinary = async (p, data) => {
		const file = new window.__TFile(p);
		file.stat = { mtime: 1, ctime: 1, size: 1 };
		store[p] = { data: new Uint8Array(data), file };
		return file;
	};
});
const fresh = async (kind, variant) => {
	await page.evaluate(() => { window.__view.data.embeds.length = 0; window.__view.renderAll(); });
	await page.evaluate((k, v) => window.__view.insertNewOffice(k, v), kind, variant);
	await page.waitForSelector(kind === "docx" ? ".notelens-office-para" : ".notelens-office-page .notelens-slide", { timeout: 8000 });
	await tick(300);
};
const pick = (title) => page.evaluate((t) => {
	const item = [...document.querySelectorAll(".menu .menu-item")].find(i => i.textContent.trim() === t);
	if (!item) return false;
	item.click();
	document.querySelectorAll(".menu").forEach(m => m.remove());
	return true;
}, title);
const ribbon = (title) => page.evaluate((t) => { const b = document.querySelector(`.notelens-office-ribbon [title="${t}"]`); if (!b) return false; b.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; }, title);
const savedFile = async (name) => { await page.waitForFunction((n) => window.__written[n], { timeout: 9000 }, name); await tick(2300); return unzipSync(Uint8Array.from(await page.evaluate((n) => window.__written[n], name))); };
const text = (bytes) => new TextDecoder().decode(bytes);
const png = () => page.evaluate(async () => {
	const c = document.createElement("canvas"); c.width = 160; c.height = 90;
	const g = c.getContext("2d"); g.fillStyle = "#2f6fb5"; g.fillRect(0, 0, 160, 90); g.fillStyle = "#fff"; g.fillRect(20, 20, 60, 30);
	const blob = await new Promise(r => c.toBlob(r, "image/png"));
	window.__png = new File([blob], "grafico.png", { type: "image/png" });
});
const pastePng = (selector) => page.evaluate((sel) => {
	const dt = new DataTransfer();
	dt.items.add(window.__png);
	document.querySelector(sel).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, selector);

// ============ Class notes in Word ============
await fresh("docx", "notes");
const notes = await page.evaluate(() => ({
	paras: [...document.querySelectorAll("p.notelens-office-para")].map(p => p.textContent),
	outline: [...document.querySelectorAll(".notelens-office-outline-item")].map(i => i.textContent),
	stats: document.querySelector(".notelens-office-stats")?.textContent,
	markers: document.querySelectorAll("p[data-marker]").length
}));
ok("la plantilla de apuntes trae sus secciones", ["Ideas clave", "Desarrollo", "Dudas para preguntar", "Resumen"].every(h => notes.paras.includes(h)), notes.paras.slice(0, 6).join(" | "));
ok("el esquema lateral lista los títulos", notes.outline.includes("Ideas clave") && notes.outline.length >= 6, notes.outline.join(" | "));
ok("las listas de viñetas están hechas", notes.markers >= 5, String(notes.markers));
ok("la barra inferior cuenta palabras y páginas", /palabras/.test(notes.stats ?? "") && /págs/.test(notes.stats ?? ""), notes.stats);

// Type in the subject line, then undo and redo it.
const typeInto = (index, extra) => page.evaluate((i, add) => {
	const ed = document.querySelectorAll("p.notelens-office-para")[i];
	ed.focus();
	ed.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: add }));
	ed.appendChild(document.createTextNode(add));
	ed.dispatchEvent(new Event("input", { bubbles: true }));
}, index, extra);
const subjectIndex = notes.paras.findIndex(p => p.startsWith("Asignatura:"));
await typeInto(subjectIndex, "Física");
await tick(200);
await ribbon("Deshacer (Ctrl+Z)");
await tick(300);
const undone = await page.evaluate((i) => document.querySelectorAll("p.notelens-office-para")[i].textContent, subjectIndex);
ok("deshacer quita lo escrito", !undone.includes("Física"), undone);
await ribbon("Rehacer (Ctrl+Y)");
await tick(300);
const redone = await page.evaluate((i) => document.querySelectorAll("p.notelens-office-para")[i].textContent, subjectIndex);
ok("rehacer lo devuelve", redone.includes("Física"), redone);

// Enter, then undo the split.
const before = await page.evaluate(() => document.querySelectorAll("p.notelens-office-para").length);
await page.evaluate((i) => {
	const ed = document.querySelectorAll("p.notelens-office-para")[i];
	ed.focus();
	const range = document.createRange();
	range.selectNodeContents(ed);
	range.collapse(false);
	getSelection().removeAllRanges();
	getSelection().addRange(range);
}, subjectIndex);
await page.keyboard.press("Enter");
await tick(300);
const split = await page.evaluate(() => document.querySelectorAll("p.notelens-office-para").length);
await page.keyboard.down("Control");
await page.keyboard.press("KeyZ");
await page.keyboard.up("Control");
await tick(300);
const unsplit = await page.evaluate(() => document.querySelectorAll("p.notelens-office-para").length);
ok("Ctrl+Z deshace un Enter", split === before + 1 && unsplit === before, `${before} → ${split} → ${unsplit}`);

// Font and highlight on a selection.
await page.evaluate((i) => {
	const ed = document.querySelectorAll("p.notelens-office-para")[i];
	ed.focus();
	const range = document.createRange();
	range.selectNodeContents(ed);
	getSelection().removeAllRanges();
	getSelection().addRange(range);
}, subjectIndex);
await page.evaluate(() => { const s = document.querySelector(".notelens-office-font"); s.value = "Georgia"; s.dispatchEvent(new Event("change", { bubbles: true })); });
await ribbon("Resaltar texto");
await page.evaluate(() => document.querySelector(".notelens-office-palette:not(.hidden) .notelens-office-dot").dispatchEvent(new MouseEvent("click", { bubbles: true })));
const styled = await page.evaluate((i) => document.querySelectorAll("p.notelens-office-para")[i].innerHTML, subjectIndex);
ok("la fuente y el resaltado se aplican a la selección", /data-font="Georgia"/.test(styled) && /data-hl="FFF176"/.test(styled), styled.slice(0, 200));

// A table, with a row added.
await page.evaluate(() => { const ed = document.querySelectorAll("p.notelens-office-para")[1]; ed.focus(); });
await ribbon("Tabla");
await pick("Insertar tabla 3×3");
await tick(400);
const table = await page.evaluate(() => ({ cells: document.querySelectorAll(".notelens-office-table td").length, focused: !!document.activeElement.closest("td") }));
ok("se inserta una tabla 3×3 y el cursor queda en ella", table.cells === 9 && table.focused, JSON.stringify(table));
await ribbon("Tabla");
await pick("Añadir fila debajo");
await tick(400);
const rows = await page.evaluate(() => document.querySelectorAll(".notelens-office-table tr").length);
ok("se añade una fila a la tabla", rows === 4, String(rows));

// A picture pasted from the clipboard.
await png();
await page.evaluate(() => { document.querySelectorAll("p.notelens-office-para")[1].focus(); });
await pastePng(".notelens-office-page");
await page.waitForFunction(() => document.querySelector("img.notelens-office-image"), { timeout: 6000 });
ok("pegar una imagen la coloca en el documento", true);

// Bullets and indent on a paragraph.
await page.evaluate(() => { const ps = [...document.querySelectorAll("p.notelens-office-para")]; const p = ps.find(x => x.textContent === "" && !x.closest("td") && !x.dataset.marker); p.focus(); });
await ribbon("Lista numerada");
await tick(300);
await ribbon("Aumentar sangría");
await tick(300);

// Find.
await page.evaluate(() => document.querySelector(".notelens-office-app").dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true })));
await page.evaluate(() => { const i = document.querySelector(".notelens-office-find-input"); i.value = "Resumen"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
const found = await page.evaluate(() => getSelection().toString());
ok("buscar selecciona el texto encontrado", found === "Resumen", found);

const files = await savedFile("Apuntes de clase.docx");
const docXml = text(files["word/document.xml"]);
ok("la fuente y el resaltado llegan al .docx", docXml.includes('w:ascii="Georgia"') && docXml.includes('w:fill="FFF176"'));
ok("la tabla llega al .docx con sus 4 filas", (docXml.match(/<w:tr>/g) ?? []).length === 4);
ok("la imagen se guarda dentro del paquete", !!files["word/media/image1.png"] && docXml.includes("<w:drawing>") && text(files["word/_rels/document.xml.rels"]).includes("media/image1.png") && text(files["[Content_Types].xml"]).includes('Extension="png"'));
ok("la lista numerada y la sangría se guardan", docXml.includes('<w:numId w:val="2"/>') && docXml.includes('w:left="360"'));
await page.screenshot({ path: path.join(here, "shots-office-notes.png") });

// ============ Cornell ============
await fresh("docx", "cornell");
const cornell = await page.evaluate(() => ({ cells: document.querySelectorAll(".notelens-office-table td").length, tall: [...document.querySelectorAll(".notelens-office-table tr")].some(r => r.getBoundingClientRect().height > 300) }));
ok("la plantilla Cornell dibuja su tabla de dos columnas", cornell.cells === 6 && cornell.tall, JSON.stringify(cornell));

// ============ A deck ============
await fresh("pptx", "dark");
const dark = await page.evaluate(() => {
	const stage = document.querySelector(".notelens-office-page .notelens-slide");
	return { bg: getComputedStyle(stage).backgroundColor, decor: stage.querySelectorAll(".is-decor").length, font: getComputedStyle(stage).fontFamily };
});
ok("el tema oscuro pinta su fondo y la banda del máster", dark.bg === "rgb(18, 22, 28)" && dark.decor >= 1, JSON.stringify(dark));

await ribbon("Nueva diapositiva");
const layouts = await page.evaluate(() => [...document.querySelectorAll(".menu .menu-item")].map(i => i.textContent.trim()));
ok("el menú ofrece los diseños de la presentación", layouts.length === 6 && layouts.includes("Dos contenidos"), layouts.join(" | "));
await pick("Encabezado de sección");
await tick(400);
const afterLayout = await page.evaluate(() => ({ thumbs: document.querySelectorAll(".notelens-thumb").length, shapes: document.querySelectorAll(".notelens-office-page .notelens-slide-shape.is-object").length }));
ok("una diapositiva nueva sale con los marcadores de su diseño", afterLayout.thumbs === 2 && afterLayout.shapes === 2, JSON.stringify(afterLayout));
await ribbon("Duplicar diapositiva");
await tick(300);
ok("se duplica la diapositiva", (await page.evaluate(() => document.querySelectorAll(".notelens-thumb").length)) === 3);
await ribbon("Subir diapositiva");
await tick(300);
ok("se puede subir una diapositiva en el orden", (await page.evaluate(() => document.querySelector(".notelens-office-ribbon .notelens-epub-chapters").value)) === "1");
await ribbon("Fondo de la diapositiva");
await page.evaluate(() => document.querySelector(".notelens-office-palette:not(.hidden) .notelens-office-dot").dispatchEvent(new MouseEvent("click", { bubbles: true })));
await tick(300);
ok("el fondo de la diapositiva cambia de color", (await page.evaluate(() => getComputedStyle(document.querySelector(".notelens-office-page .notelens-slide")).backgroundColor)) === "rgb(255, 255, 255)");

// A text box you can move, resize and delete.
await ribbon("Añadir cuadro de texto");
await tick(400);
const boxRect = () => page.evaluate(() => {
	const box = [...document.querySelectorAll(".notelens-office-page .notelens-slide-shape.is-object")].find(s => s.textContent.includes("Escribe aquí"));
	const r = box.getBoundingClientRect();
	return { x: r.left, y: r.top, w: r.width, h: r.height, left: box.style.left, width: box.style.width };
});
const box0 = await boxRect();
await page.mouse.move(box0.x + 1, box0.y + 1);
await page.mouse.down();
await page.mouse.move(box0.x + 60, box0.y + 40, { steps: 5 });
await page.mouse.up();
await tick(200);
const box1 = await boxRect();
ok("un cuadro de texto se arrastra por su borde", box1.x - box0.x > 40 && box1.left !== box0.left, `${Math.round(box1.x - box0.x)}px`);
const handle = await page.evaluate(() => { const r = document.querySelector(".notelens-slide-handle.is-se").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.move(handle.x, handle.y);
await page.mouse.down();
await page.mouse.move(handle.x + 70, handle.y + 30, { steps: 5 });
await page.mouse.up();
await tick(200);
const box2 = await boxRect();
ok("y se redimensiona con las asas", box2.w - box1.w > 50, `${Math.round(box2.w - box1.w)}px`);

// A shape from the menu, filled with a colour.
await ribbon("Formas");
await pick("Triángulo");
await tick(400);
ok("se inserta una forma y queda seleccionada", (await page.evaluate(() => !!document.querySelector('.notelens-slide-shape[data-geo="triangle"]') && !!document.querySelector(".notelens-slide-selection"))));
await ribbon("Relleno de la forma");
await page.evaluate(() => document.querySelector(".notelens-office-palette:not(.hidden) .notelens-office-dot:nth-child(3)").dispatchEvent(new MouseEvent("click", { bubbles: true })));
await tick(300);
ok("el relleno de la forma cambia", (await page.evaluate(() => getComputedStyle(document.querySelector('.notelens-slide-shape[data-geo="triangle"]')).backgroundColor)) === "rgb(237, 125, 49)");

// Delete it with the keyboard, then undo.
await page.keyboard.press("Delete");
await tick(300);
const gone = await page.evaluate(() => !document.querySelector('.notelens-slide-shape[data-geo="triangle"]'));
await ribbon("Deshacer (Ctrl+Z)");
await tick(300);
const back = await page.evaluate(() => !!document.querySelector('.notelens-slide-shape[data-geo="triangle"]'));
ok("Supr borra el objeto y deshacer lo devuelve", gone && back, JSON.stringify({ gone, back }));

// A picture pasted onto the slide.
await png();
await pastePng(".notelens-office-page");
await page.waitForSelector(".notelens-slide-picture.is-object", { timeout: 6000 });
ok("pegar una imagen la pone en la diapositiva", true);

const deck = await savedFile("Presentación sin título.pptx");
const pres = text(deck["ppt/presentation.xml"]);
const slideParts = Object.keys(deck).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
const slidesXml = slideParts.map(n => text(deck[n])).join("\n");
ok("el archivo tiene las 3 diapositivas en su orden", (pres.match(/<p:sldId /g) ?? []).length === 3 && slideParts.length === 3, slideParts.join(","));
ok("las posiciones y el fondo se guardan", slidesXml.includes('<a:srgbClr val="FFFFFF"/>') && /<a:off x="\d+" y="\d+"\/>/.test(slidesXml) && slidesXml.includes('prst="triangle"'));
ok("la imagen de la diapositiva va en el paquete", Object.keys(deck).some(n => n.startsWith("ppt/media/")));
await page.screenshot({ path: path.join(here, "shots-office-deck.png") });

// ============ A tab of its own ============
const inTab = await page.evaluate(async () => {
	const factory = window.__plugin.views["notelens-office-view"];
	const file = window.__store["Apuntes de clase.docx"].file;
	const view = factory({ app: window.__app, view: null });
	document.body.appendChild(view.containerEl);
	await view.onOpen?.();
	await view.onLoadFile(file);
	await new Promise(r => setTimeout(r, 400));
	return {
		title: view.getDisplayText(),
		icon: view.getIcon(),
		mounted: !!view.contentEl.querySelector(".notelens-office-app .notelens-office-ribbon"),
		paras: view.contentEl.querySelectorAll("p.notelens-office-para").length,
		accepts: view.canAcceptExtension("docx") && view.canAcceptExtension("pptx") && !view.canAcceptExtension("md")
	};
});
ok("un .docx se abre en una pestaña propia con su editor", inTab.mounted && inTab.paras > 5 && inTab.title === "Apuntes de clase" && inTab.accepts, JSON.stringify(inTab));

if (!process.exitCode) console.log("todo correcto");
await browser.close();
