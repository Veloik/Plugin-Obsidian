/**
 * Inline formatting inside a text box.
 *
 * A box keeps plain text — that is what gets saved, exported to Markdown and
 * read back by search — so a word is emphasised with the same marks Obsidian
 * already uses: `**negrita**`, `*cursiva*`, `__subrayado__`, `~~tachado~~`,
 * `==resaltado==` and `` `código` ``. The editor shows the marks while you
 * type; the painted box shows the styled text.
 */

import type { TextRun } from "./types";

export interface InlineStyle {
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	mark?: boolean;
	code?: boolean;
}

export interface InlineRun extends InlineStyle {
	text: string;
}

export type InlineMark = "bold" | "italic" | "underline" | "strike" | "mark" | "code";

/** Longest markers first: `**` must win over `*`. */
export const INLINE_MARKERS: { marker: string; style: InlineMark }[] = [
	{ marker: "**", style: "bold" },
	{ marker: "__", style: "underline" },
	{ marker: "==", style: "mark" },
	{ marker: "~~", style: "strike" },
	{ marker: "*", style: "italic" },
	{ marker: "`", style: "code" }
];

export const markerFor = (style: InlineMark): string =>
	INLINE_MARKERS.find(m => m.style === style)?.marker ?? "**";

/**
 * Where the pair of a marker closes, or -1 when it never does.
 *
 * The mark has to hug its text — `**dato**`, never `** dato **` — which is
 * the rule that keeps arithmetic written on a board (`2 * 3 * 4`) as
 * arithmetic. A pair never spans a blank line either, so one stray marker
 * cannot swallow the rest of the note.
 */
function closingIndex(text: string, marker: string, from: number): number {
	const stop = text.indexOf("\n\n", from);
	const limit = stop === -1 ? text.length : stop;
	if (/\s/.test(text[from] ?? " ")) return -1;
	for (let at = text.indexOf(marker, from); at !== -1 && at < limit; at = text.indexOf(marker, at + 1)) {
		if (at > from && !/\s/.test(text[at - 1])) return at;
	}
	return -1;
}

/**
 * Splits text into styled runs. Marks nest (`**==dato==**` is bold and
 * highlighted); a marker with no partner stays as literal text, which is what
 * anyone writing `2 * 3` expects.
 */
export function parseInline(text: string, style: InlineStyle = {}, depth = 0): InlineRun[] {
	const runs: InlineRun[] = [];
	let plain = "";
	const flush = () => { if (plain) { runs.push({ ...style, text: plain }); plain = ""; } };

	for (let i = 0; i < text.length;) {
		const hit = depth < 4 ? INLINE_MARKERS.find(m => text.startsWith(m.marker, i) && !style[m.style]) : undefined;
		const close = hit ? closingIndex(text, hit.marker, i + hit.marker.length) : -1;
		if (!hit || close === -1) {
			plain += text[i];
			i += 1;
			continue;
		}
		flush();
		const inner = text.slice(i + hit.marker.length, close);
		// Code is literal: nothing inside it is a marker.
		if (hit.style === "code") runs.push({ ...style, code: true, text: inner });
		else runs.push(...parseInline(inner, { ...style, [hit.style]: true }, depth + 1));
		i = close + hit.marker.length;
	}
	flush();
	return runs;
}

/** The same text with every formatting mark removed — for PDF text and measuring. */
export function stripInlineMarks(text: string): string {
	return text.split("\n").map(line => parseInline(line).map(run => run.text).join("")).join("\n");
}

/** The marks in a piece of text, turned into runs the rich editor can show. */
export function runsFromInline(text: string, tint: string): TextRun[] {
	return parseInline(text).map(run => ({
		text: run.text,
		bold: run.bold,
		italic: run.italic,
		underline: run.underline,
		strike: run.strike,
		code: run.code,
		mark: run.mark ? tint : undefined
	}));
}

/** Runs written back as marked text, which is what `TextBox.text` keeps. */
export function runsToMarked(runs: TextRun[]): string {
	let out = "";
	for (const run of runs) {
		if (!run.text) continue;
		// Marks have to hug their text, so the blanks around a fragment stay outside them.
		const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text) as RegExpExecArray;
		if (!body) { out += run.text; continue; }
		let piece = body;
		if (run.code) piece = `\`${piece}\``;
		if (run.mark) piece = `==${piece}==`;
		if (run.strike) piece = `~~${piece}~~`;
		if (run.underline) piece = `__${piece}__`;
		if (run.italic) piece = `*${piece}*`;
		if (run.bold) piece = `**${piece}**`;
		out += lead + piece + trail;
	}
	return out;
}

/** The words alone, with no marks: what a box measures, exports and searches by. */
export function runsToPlain(runs: TextRun[]): string {
	return runs.map(run => run.text).join("");
}

/** Joins neighbours that look the same and drops the empty ones. */
export function mergeRuns(runs: TextRun[]): TextRun[] {
	const out: TextRun[] = [];
	for (const run of runs) {
		if (!run.text) continue;
		const last = out[out.length - 1];
		const same = last
			&& !!last.bold === !!run.bold && !!last.italic === !!run.italic
			&& !!last.underline === !!run.underline && !!last.strike === !!run.strike
			&& !!last.code === !!run.code && last.color === run.color && last.mark === run.mark;
		if (same) last.text += run.text;
		else out.push({ ...run });
	}
	return out;
}

// ---------------------------------------------------------------------------
// Lists as line prefixes, and the words of a note
// ---------------------------------------------------------------------------

export type ListKind = "bullet" | "number" | "arrow" | "dash";

export const LIST_PREFIX = /^(\s*)(?:[•·]|\d+[.)]|→|-->|->|[-–])\s+/;
export const LIST_MARK: Record<ListKind, string> = { bullet: "• ", number: "1. ", arrow: "→ ", dash: "- " };

/** Which kind of list a line already belongs to, if any. */
export function listKindOf(line: string): ListKind | null {
	const m = /^\s*(?:([•·])|(\d+[.)])|(→|-->|->)|([-–]))\s+/.exec(line);
	if (!m) return null;
	return m[1] ? "bullet" : m[2] ? "number" : m[3] ? "arrow" : "dash";
}

/** One prefix put in or taken out of a line, as a position in the text of the box. */
export interface LineEdit { from: number; to: number; text: string; }

/**
 * What toggling a list does to each line the selection touches (every line when
 * nothing is selected). Only the prefix moves, so the words keep whatever style
 * they were wearing.
 */
export function planListToggle(value: string, selStart: number, selEnd: number, kind: ListKind): LineEdit[] {
	const wholeBox = selStart === selEnd;
	const from = wholeBox ? 0 : value.lastIndexOf("\n", selStart - 1) + 1;
	const until = wholeBox ? value.length : (value.indexOf("\n", selEnd) === -1 ? value.length : value.indexOf("\n", selEnd));
	const lines = value.slice(from, until).split("\n");
	const allHave = lines.every(l => !l.trim() || listKindOf(l) === kind);
	const edits: LineEdit[] = [];
	let at = from;
	let counter = 1;
	for (const line of lines) {
		const indent = /^\s*/.exec(line)?.[0] ?? "";
		const present = LIST_PREFIX.exec(line);
		if (line.trim()) {
			if (allHave && present) edits.push({ from: at + indent.length, to: at + present[0].length, text: "" });
			else if (!allHave) {
				const mark = kind === "number" ? `${counter++}. ` : LIST_MARK[kind];
				edits.push({ from: at + indent.length, to: at + (present?.[0].length ?? indent.length), text: mark });
			}
		}
		at += line.length + 1;
	}
	return edits;
}

/**
 * The first lines of a note, as prose.
 *
 * A preview is meant to remind you what the note says, so everything that is
 * machinery rather than words — front matter, fenced code, HTML, embeds, table
 * rulers, and the punctuation of links and emphasis — is dropped first. A note
 * that opens with a code block used to show its code on the board.
 */
export function notePreview(content: string, lines = 5): string {
	const body = content
		.replace(/^---[\s\S]*?---\s*/, "")
		.replace(/```[\s\S]*?(```|$)/g, " ")
		.replace(/~~~[\s\S]*?(~~~|$)/g, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/!\[\[[^\]]*\]\]/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias: string) => alias || target)
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/`([^`]*)`/g, "$1");
	return body.split(/\r?\n/)
		.map(line => line.replace(/^\s*>+\s*/, "").replace(/^\s*#{1,6}\s*/, "").replace(/^\s*[-*+]\s+/, "").replace(/^\s*\d+[.)]\s+/, "").replace(/[*_~]/g, "").trim())
		.filter(line => line && !/^\|/.test(line) && !/^[-=:|\s]{3,}$/.test(line))
		.slice(0, lines)
		.join("\n");
}
