/**
 * Finding handwriting, as OneNote's search does.
 *
 * The page's ink is grouped into runs of writing — strokes close enough, side
 * by side, to be one line — and each run is read once with the ink-to-text
 * reader and remembered, so a search looks through words written by hand as
 * well as typed ones. Handwriting is read imperfectly, so the comparison
 * forgives accents, case and, in longer words, a letter or two.
 */
import type { Stroke } from "./types";

export interface InkRun {
	/** Stable while the strokes are the same: the ids, sorted. */
	key: string;
	ids: string[];
	box: { x: number; y: number; w: number; h: number };
}

/** Lines of writing: strokes joined when their boxes, widened by a letter's gap, meet. */
export function inkRuns(strokes: Stroke[]): InkRun[] {
	const ink = strokes.filter(s => s.type !== "highlighter" && s.points.length);
	if (!ink.length) return [];
	const boxes = ink.map(s => {
		let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity;
		for (const p of s.points) { x = Math.min(x, p.x); y = Math.min(y, p.y); r = Math.max(r, p.x); b = Math.max(b, p.y); }
		return { x, y, r, b };
	});
	const heights = boxes.map(b => b.b - b.y).sort((a, b) => a - b);
	const letter = Math.max(8, heights[Math.floor(heights.length / 2)]);
	// Wide enough to cross the space between two words, too narrow to reach the line below.
	const dx = letter * 1.2, dy = letter * 0.15;
	const parent = ink.map((_, i) => i);
	const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
	const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].x - boxes[b].x);
	for (let oi = 0; oi < order.length; oi++) {
		const a = boxes[order[oi]];
		for (let oj = oi + 1; oj < order.length; oj++) {
			const b = boxes[order[oj]];
			if (b.x > a.r + dx) break;
			// Very tall strokes (a bracket, a diagram) do not glue lines together.
			const overlapY = Math.min(a.b, b.b) - Math.max(a.y, b.y);
			const shorter = Math.min(a.b - a.y, b.b - b.y);
			if (overlapY > -dy && overlapY > -shorter * 0.2) parent[find(order[oi])] = find(order[oj]);
		}
	}
	const groups = new Map<number, number[]>();
	ink.forEach((_, i) => {
		const root = find(i);
		if (!groups.has(root)) groups.set(root, []);
		groups.get(root)!.push(i);
	});
	return [...groups.values()].map(members => {
		const ids = members.map(i => ink[i].id).sort();
		const x = Math.min(...members.map(i => boxes[i].x)), y = Math.min(...members.map(i => boxes[i].y));
		const r = Math.max(...members.map(i => boxes[i].r)), b = Math.max(...members.map(i => boxes[i].b));
		return { key: ids.join("|"), ids, box: { x, y, w: r - x, h: b - y } };
	});
}

/** Lower case, no accents, no punctuation: "Energía." and "energia" are one word. */
export function foldForSearch(text: string): string {
	return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Whether a query appears in handwriting that was read as `text`. Exact
 * after folding; from four letters on, one mistake is forgiven, and from
 * eight, two — about what the reader gets wrong in a word.
 */
export function inkTextMatches(text: string, query: string): boolean {
	const hay = foldForSearch(text), q = foldForSearch(query);
	if (!q) return false;
	if (hay.includes(q)) return true;
	const slack = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
	if (!slack) return false;
	// Approximate substring: the best alignment of q anywhere in hay.
	let prev = new Array<number>(hay.length + 1).fill(0);
	for (let i = 1; i <= q.length; i++) {
		const row = new Array<number>(hay.length + 1);
		row[0] = i;
		for (let j = 1; j <= hay.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (q[i - 1] === hay[j - 1] ? 0 : 1));
		}
		prev = row;
	}
	return Math.min(...prev) <= slack;
}
