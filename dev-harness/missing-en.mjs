// Message ids that reach tr() but have no English translation yet, plus the
// data-table labels that are now translated where they are painted.
import fs from "node:fs";
import path from "node:path";

const src = "src";
const ids = new Set();
const walk = (dir) => {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) { if (entry.name !== "locales") walk(full); continue; }
		if (!entry.name.endsWith(".ts")) continue;
		const text = fs.readFileSync(full, "utf8");
		for (const m of text.matchAll(/\btr\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g)) {
			ids.add(m[2].replace(/\\"/g, '"').replace(/\\'/g, "'"));
		}
	}
};
walk(src);

// tr(variable) sites: the tables they read from, so their entries count too
const TABLES = [
	// [file, regex capturing the literal, label]
	["src/ui.ts", /createPanelHeader\([^,]+,\s*"[^"]*",\s*"([^"]+)"\)/g],
	["src/ui.ts", /\{ id: "(?:small|medium|large)" as GridSize, label: "([^"]+)" \}/g],
	["src/view.ts", /\baction\("[^"]+",\s*"([^"]+)"/g],
	["src/view.ts", /\bcontrol\("[^"]+",\s*"([^"]+)"/g],
	["src/view.ts", /mkToggle\("[^"]+",\s*"[^"]+",\s*"([^"]+)"/g],
	["src/view.ts", /listButton\("[^"]+",\s*"([^"]+)"/g],
	["src/view.ts", /\["(?:sans|serif|rounded|mono)",\s*"([^"]+)"\]/g],
	["src/view.ts", /\["[^"]*",\s*"([^"]+)",\s*"[^"]*"\]/g],          // math palette keys
	["src/view.ts", /^\s*\["([^"]+)",\s*\[$/gm],                       // math palette groups
	["src/assistant.ts", /label: "([^"]+)", hint: "([^"]+)"/g],
	["src/assistant.ts", /note: "([^"]+)"/g],
];
for (const [file, re] of TABLES) {
	const text = fs.readFileSync(file, "utf8");
	for (const m of text.matchAll(re)) {
		for (const group of m.slice(1)) if (group) ids.add(group);
	}
}

const en = fs.readFileSync("src/locales/en.ts", "utf8");
const have = new Set();
for (const m of en.matchAll(/^\t"((?:\\.|[^"\\])*)":/gm)) have.add(m[1].replace(/\\"/g, '"'));

const missing = [...ids].filter(id => !have.has(id) && /[a-zA-Z]{2}/.test(id)).sort();
console.log(`ids: ${ids.size} · traducidos: ${have.size} · sin traducir: ${missing.length}\n`);
for (const id of missing) console.log(JSON.stringify(id));
fs.writeFileSync("dev-harness/missing-en.json", JSON.stringify(missing, null, 1));
