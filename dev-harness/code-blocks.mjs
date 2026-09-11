// The code block: a language read off the code itself, long lines that fold,
// and a line singled out by pressing its number.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };

const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 1280, height: 900 });
await page.evaluateOnNewDocument(() => {
	try { localStorage.clear(); } catch { /* a private window simply forgets */ }
	window.__presetSettings = { showAssistantPet: false };
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

/** Writes source into a fresh code block and commits it, the way a paste does. */
const write = async (source) => page.evaluate((code) => {
	const v = window.__view;
	v.commitTextEditor();
	// Clearing the model is not enough: the block already drawn has to go too,
	// or the next query finds the previous one still sitting on the board.
	v.data.texts.length = 0;
	v.renderAll();
	v.setTool("text");
	v.insertCodeBlock();
	const tb = v.data.texts.at(-1);
	const el = v.pageElement(tb.id);
	v.beginTextEdit(tb, el);
	const editor = v.activeTextEditor;
	editor.value = code;
	v.commitTextEditor();
	return { id: tb.id, language: tb.language, pinned: !!tb.languagePinned };
}, source);

const read = () => page.evaluate(() => {
	const el = document.querySelector(".notelens-code-block");
	const lines = Array.from(el.querySelectorAll(".notelens-code-line"));
	return {
		language: el.getAttribute("data-language"),
		header: el.querySelector(".notelens-code-lang")?.textContent ?? "",
		guessed: !!el.querySelector(".notelens-code-guess"),
		lines: lines.length,
		numbers: lines.map(l => l.querySelector(".notelens-code-num")?.textContent),
		tokens: el.querySelectorAll(".notelens-code-source .token").length,
		wrapped: el.classList.contains("is-wrapped"),
		wrapStyle: lines.length ? getComputedStyle(lines[0].querySelector(".notelens-code-source")).whiteSpace : "",
		marked: lines.map((l, i) => l.classList.contains("is-marked") ? i + 1 : 0).filter(Boolean)
	};
});

// --- the language is read off the code -------------------------------------
const cases = [
	["python", "def fibonacci(n):\n    if n < 2:\n        return n\n    return fibonacci(n - 1) + fibonacci(n - 2)\n\nprint(fibonacci(10))"],
	["javascript", "const items = [1, 2, 3];\nfunction total(list) {\n  return list.reduce((a, b) => a + b, 0);\n}\nconsole.log(total(items));"],
	["typescript", "interface Alumno {\n  nombre: string;\n  nota: number;\n}\n\nexport type Curso = Alumno[];\nconst aprobados = (c: Curso) => c.filter(a => a.nota >= 5);"],
	["sql", "SELECT nombre, AVG(nota) AS media\nFROM alumnos\nINNER JOIN notas ON notas.alumno_id = alumnos.id\nGROUP BY nombre\nORDER BY media DESC;"],
	["java", "public class Main {\n    public static void main(String[] args) {\n        System.out.println(\"Hola\");\n    }\n}"],
	["json", '{\n  "nombre": "NoteLens",\n  "version": 3,\n  "etiquetas": ["pizarra", "obsidian"]\n}'],
	["bash", "#!/bin/bash\nfor f in *.md; do\n  echo \"$f\"\n  grep -c TODO \"$f\"\ndone"],
	["css", ".tarjeta {\n  display: flex;\n  padding: 12px;\n  background: #0f172a;\n}"]
];
for (const [expected, source] of cases) {
	const box = await write(source);
	ok(`reconoce ${expected}`, box.language === expected && !box.pinned, box.language);
}

// Prose is not code in disguise: nothing is claimed when nothing fits.
const prose = await write("Esto es una nota cualquiera sobre la clase de hoy.\nNo es código de ningún lenguaje.");
ok("un texto normal se queda en texto plano", prose.language === "plaintext", prose.language);

// A fence names it outright, and that choice is never guessed over.
const fenced = await write("```ruby\nputs 'hola'\nend\n```");
ok("una valla fija el lenguaje", fenced.language === "ruby" && fenced.pinned, `${fenced.language} pinned:${fenced.pinned}`);

// --- what the block draws ---------------------------------------------------
await write("def suma(a, b):\n    total = a + b\n    return total\n\nprint(suma(2, 3))");
const drawn = await read();
ok("cada línea lleva su número, en orden", drawn.lines === 5 && drawn.numbers.join(",") === "1,2,3,4,5", drawn.numbers.join(","));
ok("el código sale coloreado", drawn.tokens > 4, `${drawn.tokens} tokens`);
ok("la cabecera dice el lenguaje y que lo dedujo", drawn.header.toLowerCase() === "python" && drawn.guessed, `${drawn.header} auto:${drawn.guessed}`);

// One cross, not two: deleting is the corner button every box already has.
const crosses = await page.evaluate(() => {
	const el = document.querySelector(".notelens-code-block");
	return {
		header: el.querySelectorAll(".notelens-code-actions .svg-icon.lucide-x").length,
		corner: el.querySelectorAll(".notelens-box-close").length
	};
});
ok("el bloque lleva una sola X, la de la esquina", crosses.header === 0 && crosses.corner === 1, JSON.stringify(crosses));

// --- long lines fold on demand ---------------------------------------------
const wrapped = await page.evaluate(() => {
	document.querySelector(".notelens-code-block .notelens-code-actions button").click();
	const el = document.querySelector(".notelens-code-block");
	const tb = window.__view.data.texts.at(-1);
	return { cls: el.classList.contains("is-wrapped"), stored: tb.codeWrap === true, style: getComputedStyle(el.querySelector(".notelens-code-source")).whiteSpace };
});
ok("el botón pliega las líneas largas", wrapped.cls && wrapped.stored && wrapped.style === "pre-wrap", JSON.stringify(wrapped));
const unwrapped = await page.evaluate(() => {
	document.querySelector(".notelens-code-block .notelens-code-actions button").click();
	const el = document.querySelector(".notelens-code-block");
	return { cls: el.classList.contains("is-wrapped"), stored: window.__view.data.texts.at(-1).codeWrap, style: getComputedStyle(el.querySelector(".notelens-code-source")).whiteSpace };
});
ok("y vuelve a dejarlas correr", !unwrapped.cls && unwrapped.stored === undefined && unwrapped.style === "pre", JSON.stringify(unwrapped));

// --- a line singled out -----------------------------------------------------
const marked = await page.evaluate(() => {
	const numbers = document.querySelectorAll(".notelens-code-line .notelens-code-num");
	numbers[1].click();
	numbers[3].click();
	const tb = window.__view.data.texts.at(-1);
	return { stored: tb.codeMarks, shown: Array.from(document.querySelectorAll(".notelens-code-line")).map((l, i) => l.classList.contains("is-marked") ? i + 1 : 0).filter(Boolean) };
});
ok("pulsar el número marca la línea", JSON.stringify(marked.stored) === "[2,4]" && JSON.stringify(marked.shown) === "[2,4]", JSON.stringify(marked));
const unmarked = await page.evaluate(() => {
	document.querySelectorAll(".notelens-code-line .notelens-code-num")[1].click();
	return window.__view.data.texts.at(-1).codeMarks;
});
ok("y volver a pulsarlo la quita", JSON.stringify(unmarked) === "[4]", JSON.stringify(unmarked));

// Everything the block remembers has to come back off the disk: the marks, the
// folding, and the fact that a language was chosen rather than guessed.
const reloaded = await page.evaluate(async () => {
	const v = window.__view;
	const tb = v.data.texts.at(-1);
	tb.codeWrap = true;
	tb.languagePinned = true;
	await v.saver.flush(v.data);
	const written = window.__saved;
	v.app.vault.read = async () => written;
	await v.onLoadFile(v.file);
	const back = v.data.texts.at(-1);
	return { marks: back.codeMarks, wrap: back.codeWrap, pinned: back.languagePinned, language: back.language, lines: document.querySelectorAll(".notelens-code-line").length };
});
ok("el bloque vuelve del disco tal cual", JSON.stringify(reloaded.marks) === "[4]" && reloaded.wrap === true && reloaded.pinned === true && reloaded.language === "python" && reloaded.lines === 5, JSON.stringify(reloaded));

if (!process.exitCode) console.log("todo correcto");
await browser.close();
