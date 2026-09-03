// Lists every Spanish string literal in src/ that never passes through tr(),
// so the English interface cannot be finished by staring at screenshots.
import fs from "node:fs";
import path from "node:path";

const SRC = "src";
const SPANISH = /[áéíóúñ¿¡]|\b(el|la|los|las|una|uno|del|con|para|por|que|sin|más|como|desde|hasta|entre|cada|texto|pizarra|fondo|nueva|nuevo|abrir|cerrar|escribe|elige|pulsa|arrastra|toca|guardar|borrar|copiar|pegar|deshacer|rehacer|seleccion|memoria|resumen|apuntes|tarea|nota|hoja|linea|grosor|punta|goma|regla|pagina)\b/i;

const files = fs.readdirSync(SRC).filter(f => f.endsWith(".ts"));
let total = 0;
for (const file of files) {
	const source = fs.readFileSync(path.join(SRC, file), "utf8");
	const lines = source.split("\n");
	const hits = [];
	lines.forEach((line, i) => {
		if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
		// every quoted literal on the line, with what precedes it
		for (const m of line.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
			const text = m[2];
			if (text.length < 3 || !SPANISH.test(text)) continue;
			const before = line.slice(0, m.index);
			// already translated, or a key in the catalogue itself
			if (/tr\(\s*$/.test(before) || /tr\(\s*["'`][^)]*$/.test(before)) continue;
			if (/^\s*["'`]/.test(line) && file.includes("locales")) continue;
			// message ids inside a tr(...) call spanning the line
			const upToHere = line.slice(0, m.index + m[0].length);
			const opens = (upToHere.match(/\btr\(/g) || []).length;
			const closes = (upToHere.match(/\)/g) || []).length;
			if (opens > 0 && opens > closes) continue;
			hits.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
			break; // one report per line is enough to find it
		}
	});
	if (hits.length) {
		console.log(`\n=== ${file} (${hits.length}) ===`);
		for (const h of hits) console.log("  " + h);
		total += hits.length;
	}
}
console.log(`\nTOTAL: ${total} líneas con texto en español fuera de tr()`);
