/**
 * Small, deterministic study helpers. They run synchronously, need no account
 * or model, and are intentionally conservative: every result is derived from
 * text that is already on the selected board area or current page.
 */

export type LocalStudyTool = "summary" | "key-ideas" | "tasks" | "outline" | "flashcards" | "clean-notes";

export interface LocalStudyResult {
	title: string;
	content: string;
	items: string[];
	empty?: boolean;
}

const STOP_WORDS = new Set((
	"a al algo algunas algunos ante antes como con contra cual cuando de del desde donde dos el ella ellas ellos en entre era es esa esas ese eso esos esta estaba estas este esto estos fue ha hacia hay la las le les lo los mas me mi mis mucha muy no nos o para pero poco por porque que quien se ser si sin sobre son su sus te tiene todo tras tu tus un una unas uno unos y ya " +
	"the a an and are as at be by for from has have he her his i in is it its of on or our she that their they this to was were will with you your"
).split(/\s+/));

interface Sentence {
	text: string;
	index: number;
	tokens: string[];
	score: number;
}

const normalizeToken = (token: string): string => token
	.toLocaleLowerCase("es")
	.normalize("NFD")
	.replace(/[\u0300-\u036f]/g, "")
	.replace(/[^a-z0-9]/g, "");

function words(text: string): string[] {
	return text.split(/[^\p{L}\p{N}]+/u)
		.map(normalizeToken)
		.filter(token => token.length > 2 && !STOP_WORDS.has(token) && !/^\d+$/.test(token));
}

function stripMarkup(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, block => block.replace(/^```[^\n]*\n?|```$/g, ""))
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function sentenceList(text: string): Sentence[] {
	const clean = stripMarkup(text);
	const chunks = clean
		.split(/\n+|(?<=[.!?;])\s+(?=[\p{Lu}\d¿¡])/u)
		.map(line => line.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]\])\s*/, "").trim())
		.filter(line => line.length >= 8);
	return chunks.map((line, index) => ({ text: line, index, tokens: words(line), score: 0 }));
}

function frequencies(sentences: Sentence[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const sentence of sentences) for (const token of new Set(sentence.tokens)) counts.set(token, (counts.get(token) ?? 0) + 1);
	const maximum = Math.max(1, ...counts.values());
	for (const [token, count] of counts) counts.set(token, count / maximum);
	return counts;
}

function similarity(a: Sentence, b: Sentence): number {
	const left = new Set(a.tokens), right = new Set(b.tokens);
	if (!left.size || !right.size) return 0;
	let common = 0;
	for (const token of left) if (right.has(token)) common++;
	return common / (left.size + right.size - common);
}

function rankedSentences(text: string): Sentence[] {
	const sentences = sentenceList(text);
	const freq = frequencies(sentences);
	for (const sentence of sentences) {
		const lexical = sentence.tokens.reduce((sum, token) => sum + (freq.get(token) ?? 0), 0) / Math.sqrt(Math.max(5, sentence.tokens.length));
		const position = sentence.index === 0 ? 0.32 : sentence.index < 3 ? 0.16 : 0;
		const definition = /\b(es|son|significa|define|consiste|permite|sirve|causa|produce)\b/i.test(sentence.text) ? 0.28 : 0;
		const heading = sentence.text.length < 70 && /:$/.test(sentence.text) ? 0.2 : 0;
		sentence.score = lexical + position + definition + heading;
	}
	return sentences.sort((a, b) => b.score - a.score || a.index - b.index);
}

function selectDistinct(text: string, maximum: number): Sentence[] {
	const ranked = rankedSentences(text);
	const selected: Sentence[] = [];
	for (const candidate of ranked) {
		if (candidate.tokens.length === 0) continue;
		if (selected.some(existing => similarity(existing, candidate) > 0.62)) continue;
		selected.push(candidate);
		if (selected.length >= maximum) break;
	}
	return selected.sort((a, b) => a.index - b.index);
}

function sentenceCase(text: string): string {
	const value = text.trim().replace(/[;,]+$/, "");
	return value ? value[0].toLocaleUpperCase("es") + value.slice(1) : value;
}

function topTerms(text: string, maximum = 5): string[] {
	const counts = new Map<string, number>();
	const display = new Map<string, string>();
	for (const raw of text.match(/[\p{L}\p{N}]+/gu) ?? []) {
		const token = normalizeToken(raw);
		if (token.length <= 2 || STOP_WORDS.has(token) || /^\d+$/.test(token)) continue;
		counts.set(token, (counts.get(token) ?? 0) + 1);
		if (!display.has(token)) display.set(token, raw.toLocaleLowerCase("es"));
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
		.slice(0, maximum)
		.map(entry => display.get(entry[0]) ?? entry[0]);
}

function originalTerm(text: string, normalized: string): string {
	return (text.match(/[\p{L}\p{N}]+/gu) ?? []).find(token => normalizeToken(token) === normalized)?.toLocaleLowerCase("es") ?? normalized;
}

export function summarizeLocally(text: string, maximum = 5): string[] {
	return selectDistinct(text, maximum).map(sentence => sentenceCase(sentence.text));
}

export function extractKeyIdeasLocally(text: string, maximum = 5): string[] {
	return rankedSentences(text)
		.filter(sentence => /\b(es|son|significa|define|consiste|permite|causa|produce|importante|clave)\b/i.test(sentence.text) || sentence.score > 0.8)
		.filter((sentence, index, all) => all.findIndex(other => similarity(other, sentence) > 0.76) === index)
		.slice(0, maximum)
		.sort((a, b) => a.index - b.index)
		.map(sentence => sentenceCase(sentence.text));
}

export function tasksFromNotes(text: string, maximum = 10): string[] {
	const lines = stripMarkup(text).split(/\n+/).map(line => line.trim()).filter(Boolean);
	const explicit = lines
		.filter(line => /^[-*•]?\s*\[[ ]\]|\b(todo|tarea|pendiente|hacer|entregar|repasar|revisar|completar|resolver|practicar|estudiar|leer)\b/i.test(line))
		.map(line => sentenceCase(line.replace(/^[-*•]?\s*\[[ xX]\]\s*/, "").replace(/^(todo|tarea|pendiente)\s*[:.-]?\s*/i, "")))
		.filter(Boolean);
	if (explicit.length) return [...new Set(explicit)].slice(0, maximum);

	const ideas = extractKeyIdeasLocally(text, 3);
	const terms = topTerms(text, 3);
	const generated = [
		terms[0] ? `Explicar ${terms[0]} sin mirar los apuntes` : "Explicar el tema sin mirar los apuntes",
		terms[1] ? `Relacionar ${terms[0] ?? "el tema"} con ${terms[1]}` : "Crear un ejemplo propio",
		ideas[0] ? `Comprobar con un ejemplo: ${ideas[0].slice(0, 100)}` : "Resolver un ejemplo y comprobar el resultado",
		"Anotar las dudas que queden pendientes"
	];
	return generated.slice(0, maximum);
}

export function outlineLocally(text: string): string[] {
	const lines = stripMarkup(text).split(/\n+/).map(line => line.trim()).filter(Boolean);
	const output: string[] = [];
	let section = 0;
	for (const line of lines) {
		const clean = line.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]\])\s*/, "").trim();
		const heading = clean.endsWith(":") || (clean.length < 58 && !/[.!?]$/.test(clean));
		if (heading) {
			section++;
			output.push(`${section}. ${sentenceCase(clean.replace(/:$/, ""))}`);
		} else if (output.length && output.length < 16) {
			output.push(`   - ${sentenceCase(clean)}`);
		}
		if (output.length >= 16) break;
	}
	if (output.filter(line => /^\d+\./.test(line)).length >= 2) return output;
	return summarizeLocally(text, 7).map((sentence, index) => `${index + 1}. ${sentence}`);
}

export function flashcardsLocally(text: string, maximum = 8): string[] {
	const clean = stripMarkup(text);
	const cards: string[] = [];
	for (const line of clean.split(/\n+/).map(value => value.trim()).filter(Boolean)) {
		const pair = /^(.{2,70}?)\s*(?::|\s[-–]\s|\s=\s)\s*(.{5,240})$/.exec(line);
		if (pair) {
			cards.push(`P: ¿Qué es ${pair[1].replace(/[?.:]$/, "")}?\nR: ${sentenceCase(pair[2])}`);
			if (cards.length >= maximum) return cards;
		}
	}
	for (const sentence of selectDistinct(clean, maximum * 2)) {
		const definition = /^(.{2,70}?)\s+(es|son|significa|se define como|consiste en)\s+(.{5,240})$/i.exec(sentence.text.replace(/[.]$/, ""));
		if (definition) cards.push(`P: ¿Qué ${definition[2].toLowerCase()} ${definition[1]}?\nR: ${sentenceCase(definition[3])}`);
		else {
			const term = sentence.tokens.sort((a, b) => b.length - a.length)[0];
			if (term) cards.push(`P: ¿Qué debes recordar sobre ${originalTerm(sentence.text, term)}?\nR: ${sentenceCase(sentence.text)}`);
		}
		if (cards.length >= maximum) break;
	}
	return [...new Set(cards)].slice(0, maximum);
}

export function cleanNotesLocally(text: string): string[] {
	const seen = new Set<string>();
	const output: string[] = [];
	for (const raw of stripMarkup(text).split(/\n+/)) {
		let line = raw.trim().replace(/^\s*[•*]\s*/, "- ").replace(/^\s*[-–—]\s*/, "- ");
		if (!line) continue;
		const key = normalizeToken(line.replace(/^[-\d.)\s]+/, ""));
		if (!key || seen.has(key)) continue;
		seen.add(key);
		if (!/^[-\d]/.test(line)) line = sentenceCase(line);
		output.push(line);
	}
	return output.slice(0, 40);
}

export function runLocalStudyTool(tool: LocalStudyTool, text: string): LocalStudyResult {
	const clean = stripMarkup(text);
	if (!clean) return { title: "Sin contenido", content: "", items: [], empty: true };
	switch (tool) {
		case "summary": {
			const items = summarizeLocally(clean, 5);
			return { title: "Resumen", items, content: items.map(item => `- ${item}`).join("\n") };
		}
		case "key-ideas": {
			const items = extractKeyIdeasLocally(clean, 5);
			if (!items.length) items.push(...summarizeLocally(clean, 4));
			return { title: "Ideas clave", items, content: items.map(item => `- ${item}`).join("\n") };
		}
		case "tasks": {
			const items = tasksFromNotes(clean, 10);
			const topic = topTerms(clean, 2).join(" y ");
			return { title: topic ? `Repaso: ${topic}` : "Plan de repaso", items, content: items.map(item => `- [ ] ${item}`).join("\n") };
		}
		case "outline": {
			const items = outlineLocally(clean);
			return { title: "Esquema", items, content: items.join("\n") };
		}
		case "flashcards": {
			const items = flashcardsLocally(clean, 8);
			return { title: "Tarjetas de estudio", items, content: items.join("\n\n") };
		}
		case "clean-notes": {
			const items = cleanNotesLocally(clean);
			return { title: "Apuntes limpios", items, content: items.join("\n") };
		}
	}
}
