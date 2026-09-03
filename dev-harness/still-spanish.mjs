// Filters run57's raw list down to strings that are genuinely untranslated:
// "color" is the same word in both languages and language names keep their
// endonyms on purpose, so both would otherwise be reported forever.
import fs from "node:fs";

const ENDONYMS = /"(Español|Français|Português|Deutsch|Italiano|Nederlands|Polski)"/;
const SPANISH_ONLY = /[áéíóúñ¿¡]/i;
const SPANISH_WORDS = /\b(el|la|los|las|una|uno|con|para|por|del|que|se|tu|su|sin|como|desde|hasta|entre|cada|texto|pizarra|fondo|guardar|borrar|nueva|nuevo|abrir|cerrar|escribe|elige|pulsa|arrastra|toca|modelo|equipo)\b/i;

const lines = fs.readFileSync("dev-harness/shots57/spanish-in-english.txt", "utf8").split("\n");
const found = new Map();
for (const line of lines) {
	if (!line.trim() || ENDONYMS.test(line)) continue;
	const m = /"(.*)"$/.exec(line);
	if (!m) continue;
	const text = m[1];
	if (text === "sin") continue; // the trigonometric key, spelled the same in English
	if (!SPANISH_ONLY.test(text) && !SPANISH_WORDS.test(text)) continue;
	if (!found.has(text)) found.set(text, line.split("]")[0].replace(/^\[/, ""));
}
console.log(`sin traducir: ${found.size}`);
for (const [text, where] of found) console.log(`  ${where.padEnd(16)} ${JSON.stringify(text)}`);
