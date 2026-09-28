/**
 * Handwriting → text, as OneNote's "Ink to Text".
 *
 * The strokes are cut into symbols by the same segmentation the formula reader
 * uses (ink-math.ts), and the network's readings are then decided as prose:
 * rows of writing become lines, wide gaps become spaces, each word is read
 * either as letters or as a number (so the o of "sol" is not a zero and the 0
 * of "105" is not an o), the case of c/C, s/S, x/X… comes from the letter's
 * height against the small letters of its line, and a word the writer is
 * likely to use — a common word, or one already in the vault — wins over a
 * string of letters that only looks alike.
 */
import { InkGlyph, InkMathStroke, readInkGroup, segmentInk } from "./ink-math";

export interface InkTextRecognition {
	text: string;
	/** Size of the small letters, in board units, to pick a matching font size. */
	xHeight: number;
	/** Mean probability of the chosen characters, 0..1. */
	confidence: number;
}

/** Letters the network only knows in one case, because both are one shape. */
const MERGED = new Set([..."ckopsuvwxz"]);
/** Small letters with no ascender or descender. */
const XHEIGHT = new Set([..."acemnorsuvwxz"]);
const ASCENDING = new Set([..."bdfhklt"]);
const DESCENDING = new Set([..."gjpqy"]);
const PUNCTUATION = new Set([...".,;:!?'\"-()[]+=/&%<>"]);
/** A digit read inside a word of letters, and the letter it must have been. */
const DIGIT_AS_LETTER: Record<string, string> = { "0": "o", "1": "l", "2": "z", "5": "s", "6": "b", "9": "g", "8": "B", "4": "y", "7": "T" };
const LETTER_AS_DIGIT: Record<string, string> = { o: "0", O: "0", l: "1", I: "1", i: "1", z: "2", Z: "2", s: "5", S: "5", b: "6", g: "9", q: "9", B: "8" };

/**
 * Short words people write in notes, in the two languages the plugin speaks.
 * A word here or in the vault is preferred over a look-alike that is not a word.
 */
const COMMON_WORDS = `
a al algo como con cual cuando de del desde donde dos el ella ellos en entre era es esa ese eso esta este esto fue ha hay la las le lo los mas me mi muy no nos o para pero por porque que se si sin sobre son su sus tambien tiene todo tres tu un una uno y ya
agua ahora antes año area paso pasos altura final inicial nulo media medio normal claro clave base cada caso clase cosa curva dato datos dia ejemplo ecuacion energia entonces examen fecha forma funcion grafica hacer hoja idea igual lado ley linea masa mismo modo nota numero otra otro parte pagina porque punto recta regla resultado seguir segun serie siempre solo suma tabla tarea tema tiempo tipo total valor velocidad vez
the of and to in is it that for on with as by at be this are or from an not but was were have has had can will would if then than so no yes do does all any each one two three more most some such only also into out up about over after before when where which who what why how its their there these those we you they he she his her our your my me us them i
area base case class data date energy example exam force function graph idea law line mass note number page point rate result rule same set speed step sum table task term test time total type value
`.trim().split(/\s+/);

const PRIOR_BONUS = Math.log(12);

interface Candidate { ch: string; p: number }

function textCandidates(g: InkGlyph): Candidate[] {
	const out: Candidate[] = [];
	for (const r of g.ranked) {
		const v = r.value.length === 1 ? r.value : r.value === "\\cdot" ? "." : r.value === "\\{" ? "(" : r.value === "\\}" ? ")" : "";
		if (!v || !(/[A-Za-z0-9]/.test(v) || PUNCTUATION.has(v))) continue;
		const known = out.find(c => c.ch === v);
		if (known) known.p += r.p; else out.push({ ch: v, p: r.p });
	}
	return out.length ? out : [{ ch: "?", p: 0.01 }];
}

const isLetter = (ch: string) => /^[A-Za-z]$/.test(ch);
const isDigit = (ch: string) => /^[0-9]$/.test(ch);
const cy = (b: InkGlyph["box"]) => (b.y + b.bottom) / 2;

/** Ink too small to have a shape: a full stop, the dot of an i written as a short tick. */
let dotSize = 0;
const dotLike = (g: InkGlyph) => g.dot || Math.max(g.box.w, g.box.h) < dotSize;

/**
 * A stroke that sits inside the symbol written just before it belongs to it:
 * the middle bar of an E or an F, drawn last. The formula reader keeps such a
 * bar apart, because in maths a minus inside a bracket is common; in prose it
 * never is.
 */
function joinContained(glyphs: InkGlyph[], scale: number): InkGlyph[] {
	const out: InkGlyph[] = [];
	for (const g of glyphs) {
		const prev = out[out.length - 1];
		if (prev && !g.dot && prev.strokes.length + g.strokes.length <= 4) {
			const b = g.box, a = prev.box;
			const inside = b.x >= a.x - scale * 0.08 && b.right <= a.right + scale * 0.15 && b.y >= a.y - scale * 0.05 && b.bottom <= a.bottom + scale * 0.05;
			if (inside) {
				const joined = readInkGroup([...prev.strokes, ...g.strokes], scale);
				const best = textCandidates(joined)[0];
				if (/[A-Za-z0-9]/.test(best.ch) && best.p > 0.3) { out[out.length - 1] = joined; continue; }
			}
		}
		out.push(g);
	}
	return out;
}

function median(values: number[]): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Rows of writing, top to bottom, each sorted left to right. */
function rowsOf(glyphs: InkGlyph[], scale: number): InkGlyph[][] {
	const solid = glyphs.filter(g => !dotLike(g)).sort((a, b) => cy(a.box) - cy(b.box));
	const rows: { centre: number; glyphs: InkGlyph[] }[] = [];
	for (const g of solid) {
		const row = rows.find(r => Math.abs(r.centre - cy(g.box)) < scale * 0.7);
		if (row) {
			row.glyphs.push(g);
			row.centre = median(row.glyphs.map(o => cy(o.box)));
		} else rows.push({ centre: cy(g.box), glyphs: [g] });
	}
	// Dots belong to the row they sit on or just above (a full stop, the dot of an i).
	for (const g of glyphs.filter(dotLike)) {
		if (!rows.length) rows.push({ centre: cy(g.box), glyphs: [] });
		const row = rows.reduce((best, r) => Math.abs(r.centre + scale * 0.2 - cy(g.box)) < Math.abs(best.centre + scale * 0.2 - cy(g.box)) ? r : best);
		row.glyphs.push(g);
	}
	return rows.sort((a, b) => a.centre - b.centre).map(r => r.glyphs.sort((a, b) => a.box.x - b.box.x));
}

/** Readings of one word, best first, with the lexicon's say. */
function readWord(options: Candidate[][], lexicon: Set<string>): { word: string; p: number; score: number } {
	let beam: { word: string; score: number; p: number }[] = [{ word: "", score: 0, p: 0 }];
	for (const slot of options) {
		const next: typeof beam = [];
		for (const partial of beam) for (const c of slot.slice(0, 3)) {
			next.push({ word: partial.word + c.ch, score: partial.score + Math.log(Math.max(c.p, 1e-4)), p: partial.p + c.p });
		}
		beam = next.sort((a, b) => b.score - a.score).slice(0, 24);
	}
	const scored = beam.map(b => ({ ...b, score: b.score + (lexicon.has(b.word.toLowerCase()) ? PRIOR_BONUS : 0) }));
	scored.sort((a, b) => b.score - a.score);
	return { word: scored[0].word, p: scored[0].p / Math.max(1, options.length), score: scored[0].score };
}

export function recognizeInkText(strokes: InkMathStroke[], vocabulary: Iterable<string> = []): InkTextRecognition {
	const cut = segmentInk(strokes);
	const scale = cut.scale;
	dotSize = scale * 0.3;
	const glyphs = joinContained(cut.glyphs, scale);
	if (!glyphs.length) return { text: "", xHeight: 0, confidence: 0 };
	const lexicon = new Set(COMMON_WORDS);
	for (const w of vocabulary) if (w.length > 1) lexicon.add(w.toLowerCase());
	const lines: string[] = [];
	const xHeights: number[] = [];
	let pSum = 0, pCount = 0;
	for (const row of rowsOf(glyphs, scale)) {
		const solid = row.filter(g => !dotLike(g));
		const readings = new Map(row.map(g => [g, textCandidates(g)] as const));
		const top = (g: InkGlyph) => readings.get(g)![0].ch;
		// The small letters of the row say how tall a lowercase letter is here.
		const small = solid.filter(g => XHEIGHT.has(top(g).toLowerCase()) || isDigit(top(g)) && top(g) === "0");
		const heights = solid.map(g => g.box.h);
		const xh = small.length ? median(small.map(g => g.box.h)) : median(heights) * 0.65;
		const baseline = small.length ? median(small.map(g => g.box.bottom)) : median(solid.map(g => g.box.bottom));
		xHeights.push(xh);
		// Words: a gap clearly wider than the gaps between letters.
		const words: InkGlyph[][] = [];
		let last: InkGlyph | null = null;
		for (const g of row) {
			const gap = last ? g.box.x - last.box.right : Infinity;
			if (!last || gap > Math.max(xh * 0.75, scale * 0.35)) words.push([g]);
			else words[words.length - 1].push(g);
			if (!dotLike(g) || !last) last = !last || g.box.right > last.box.right ? g : last;
		}
		const out: string[] = [];
		for (const word of words) {
			// A dot above a stem is the dot of an i or a j that was cut apart.
			const glyphsOf = word.filter(g => !(dotLike(g) && g.box.bottom < baseline - xh * 0.75 && word.some(o => !dotLike(o)
				&& (g.box.x + g.box.right) / 2 > o.box.x - xh * 0.3 && (g.box.x + g.box.right) / 2 < o.box.right + xh * 0.3)));
			const dotted = new Set(word.filter(g => !glyphsOf.includes(g)).map(dot => word.filter(o => !dotLike(o))
				.reduce((best, o) => Math.abs(o.box.x + o.box.right - dot.box.x - dot.box.right) < Math.abs(best.box.x + best.box.right - dot.box.x - dot.box.right) ? o : best)));
			// Read it both as a word and as a number, and keep the likelier.
			const readAs = (lettersWord: boolean) => readWord(glyphsOf.map((g, index) => {
				if (dotLike(g)) {
					// On the line a full stop, high up an apostrophe.
					return [{ ch: cy(g.box) < baseline - xh * 0.8 ? "'" : ".", p: 0.9 }];
				}
				let cands = readings.get(g)!.map(c => ({ ...c }));
				if (dotted.has(g) && lettersWord) {
					const descends = g.box.bottom > baseline + xh * 0.35;
					cands = [{ ch: descends ? "j" : "i", p: 0.9 }];
				}
				const kind = lettersWord ? isLetter : isDigit;
				const swap = lettersWord ? DIGIT_AS_LETTER : LETTER_AS_DIGIT;
				// Punctuation stays punctuation only at the edges of a word.
				const edge = index === 0 || index === glyphsOf.length - 1;
				// The network has no o: it answers 0 for both, so a small one costs nothing.
				cands = cands.flatMap(c => kind(c.ch) || (edge && PUNCTUATION.has(c.ch) && c.p > 0.5) ? [c]
					: swap[c.ch] ? [{ ch: swap[c.ch], p: c.p * (c.ch === "0" && g.box.h < xh * 1.25 ? 1 : 0.2) }] : []);
				// A number is digits throughout; anything else is not a number.
				if (!cands.length) cands = lettersWord ? readings.get(g)!.slice(0, 1) : [{ ch: "?", p: 1e-6 }];
				const merged = new Map<string, number>();
				for (const c of cands) merged.set(c.ch, (merged.get(c.ch) ?? 0) + c.p);
				return [...merged].map(([ch, p]) => ({ ch: fixCase(ch, g, xh, baseline), p })).sort((a, b) => b.p - a.p);
			}), lexicon);
			const asWord = readAs(true), asNumber = readAs(false);
			const { word: text, p } = asNumber.score > asWord.score ? asNumber : asWord;
			pSum += p * glyphsOf.length;
			pCount += glyphsOf.length;
			out.push(text);
		}
		// A full stop or a comma written apart from its word joins it.
		lines.push(out.join(" ").replace(/ ([.,;:!?])/g, "$1").trim());
	}
	return { text: lines.filter(Boolean).join("\n"), xHeight: median(xHeights), confidence: pCount ? pSum / pCount : 0 };
}

/**
 * Case from size. The network gives c, s, x… in one case only; others (A/a,
 * Y/y…) it knows apart, but a capital written as small as the lowercase
 * letters next to it is the lowercase one written carefully.
 */
function fixCase(ch: string, g: InkGlyph, xh: number, baseline: number): string {
	if (!isLetter(ch) || !xh) return ch;
	const h = g.box.h;
	const lower = ch.toLowerCase();
	if (MERGED.has(lower)) {
		if (lower === "k") return ch;
		if (lower === "p") return g.box.bottom < baseline + h * 0.2 && h > xh * 1.2 ? "P" : "p";
		return h > xh * 1.25 ? lower.toUpperCase() : lower;
	}
	if (ch !== lower && h < xh * 1.2 && !ASCENDING.has(lower) && !DESCENDING.has(lower)) return lower;
	return ch;
}
