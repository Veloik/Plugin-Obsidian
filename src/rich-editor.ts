/**
 * The rich text box: what you see while you type is what the board shows.
 *
 * A box used to be a textarea, so a mark like `__así__` only turned into an
 * underline once you left it, and a colour could never belong to a single word.
 * Editing now happens in a contenteditable element, and this module is the
 * bridge between that element and the `TextRun[]` a box stores: it paints runs
 * into an element, reads them back out of the one being edited, and maps
 * positions in the text onto DOM ranges so a line can be edited by hand.
 */

import { TextRun } from "./types";
import { mergeRuns } from "./rich-text";

/** The look a box has before any run overrides it. */
export interface BaseStyle {
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	/** Computed colour of the box, so a run in the same colour stores nothing. */
	color: string;
}

/** Elements that end a line when the edited DOM is read back as text. */
const BLOCK_TAGS = /^(DIV|P|LI|UL|OL|BLOCKQUOTE|PRE|H[1-6]|TABLE|TR)$/;

const transparent = (color: string): boolean =>
	!color || color === "transparent" || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(color);

/** Paints runs into an element. `paint` writes one fragment of plain text. */
export function renderRuns(
	root: HTMLElement,
	runs: TextRun[],
	base: BaseStyle,
	paint: (parent: HTMLElement, text: string) => void
): void {
	for (const run of runs) {
		if (!run.text) continue;
		const differs = !!run.bold !== base.bold || !!run.italic !== base.italic
			|| !!run.underline !== base.underline || !!run.strike !== base.strike
			|| !!run.color || !!run.mark || !!run.code;
		if (!differs) { paint(root, run.text); continue; }
		const span = run.code ? root.createEl("code", { cls: "notelens-run-code" }) : root.createSpan();
		if (!!run.bold !== base.bold) span.style.fontWeight = run.bold ? "700" : "400";
		if (!!run.italic !== base.italic) span.style.fontStyle = run.italic ? "italic" : "normal";
		if (!!run.underline !== base.underline || !!run.strike !== base.strike) {
			const lines = [run.underline ? "underline" : "", run.strike ? "line-through" : ""].filter(Boolean).join(" ");
			span.style.textDecoration = lines || "none";
		}
		if (run.color) span.style.color = run.color;
		if (run.mark) {
			span.addClass("notelens-run-mark");
			span.style.backgroundColor = run.mark;
		}
		paint(span, run.text);
	}
}

/** Every fragment of the edited element, with the style it is actually wearing. */
export function readRuns(root: HTMLElement, base: BaseStyle): TextRun[] {
	const runs: TextRun[] = [];
	collect(root, root, base, runs);
	return mergeRuns(runs);
}

function collect(node: Node, root: HTMLElement, base: BaseStyle, out: TextRun[]): void {
	for (let child = node.firstChild; child; child = child.nextSibling) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.nodeValue ?? "";
			if (text) out.push({ ...styleOf(child.parentElement, root, base), text });
			continue;
		}
		if (!(child instanceof HTMLElement)) continue;
		if (child.tagName === "BR") { out.push({ text: "\n" }); continue; }
		// A block that follows something else starts a new line.
		if (BLOCK_TAGS.test(child.tagName) && out.length && !out[out.length - 1].text.endsWith("\n")) out.push({ text: "\n" });
		collect(child, root, base, out);
	}
}

/**
 * The style a fragment ends up with. Weight, slant and colour are inherited, so
 * the element holding the text knows them; underline, strike-through and a
 * highlight are not, so they are gathered from the ancestors up to the box.
 */
function styleOf(el: HTMLElement | null, root: HTMLElement, base: BaseStyle): Omit<TextRun, "text"> {
	if (!el) return {};
	let underline = false, strike = false, code = false;
	let mark: string | undefined;
	for (let node: HTMLElement | null = el; node; node = node.parentElement) {
		const style = getComputedStyle(node);
		const lines = style.textDecorationLine;
		if (lines.includes("underline")) underline = true;
		if (lines.includes("line-through")) strike = true;
		if (node.tagName === "CODE") code = true;
		if (!mark && node !== root && !transparent(style.backgroundColor)) mark = style.backgroundColor;
		if (node === root) break;
	}
	const own = getComputedStyle(el);
	const color = own.color;
	return {
		bold: (parseInt(own.fontWeight, 10) || 400) >= 600 || undefined,
		italic: own.fontStyle === "italic" || undefined,
		underline: underline || undefined,
		strike: strike || undefined,
		code: code || undefined,
		color: color && color !== base.color ? color : undefined,
		mark
	};
}

interface Atom {
	node: Text | null;
	/** Where this piece starts in the text of the whole box. */
	from: number;
	length: number;
}

/** Text nodes and line breaks in reading order, with their position in the text. */
function atoms(root: HTMLElement): Atom[] {
	const list: Atom[] = [];
	let at = 0;
	const visit = (node: Node) => {
		for (let child = node.firstChild; child; child = child.nextSibling) {
			if (child.nodeType === Node.TEXT_NODE) {
				const length = (child.nodeValue ?? "").length;
				if (length) { list.push({ node: child as Text, from: at, length }); at += length; }
				continue;
			}
			if (!(child instanceof HTMLElement)) continue;
			if (child.tagName === "BR") { list.push({ node: null, from: at, length: 1 }); at += 1; continue; }
			if (BLOCK_TAGS.test(child.tagName) && at > 0) { list.push({ node: null, from: at, length: 1 }); at += 1; }
			visit(child);
		}
	};
	visit(root);
	return list;
}

/** The text of an edited box, counting every break as one newline. */
export function editableText(root: HTMLElement): string {
	let out = "";
	for (const atom of atoms(root)) out += atom.node ? atom.node.nodeValue ?? "" : "\n";
	return out;
}

/** Where a point in the DOM falls in the text of the box. */
function offsetOf(root: HTMLElement, node: Node, offset: number): number {
	const list = atoms(root);
	if (node.nodeType === Node.TEXT_NODE) {
		const atom = list.find(a => a.node === node);
		if (atom) return atom.from + Math.min(offset, atom.length);
		return 0;
	}
	// A position between children: everything before that child has been passed.
	const child = node.childNodes[offset] ?? null;
	if (!child) return list.length ? list[list.length - 1].from + list[list.length - 1].length : 0;
	const inside = list.find(a => a.node && (a.node === child || child.contains(a.node)));
	return inside ? inside.from : 0;
}

/** Where the caret (or the end of the selection) sits in the text of the box. */
export function selectionOffsets(root: HTMLElement): { from: number; to: number } {
	const selection = root.ownerDocument.getSelection();
	if (!selection || selection.rangeCount === 0) return { from: 0, to: 0 };
	const range = selection.getRangeAt(0);
	if (!root.contains(range.startContainer)) return { from: 0, to: 0 };
	return {
		from: offsetOf(root, range.startContainer, range.startOffset),
		to: offsetOf(root, range.endContainer, range.endOffset)
	};
}

/** A DOM point for a position in the text; used to put the caret back after a rewrite. */
function pointAt(root: HTMLElement, offset: number): { node: Node; offset: number } {
	const list = atoms(root);
	for (const atom of list) {
		if (!atom.node) continue;
		if (offset <= atom.from + atom.length) return { node: atom.node, offset: Math.max(0, offset - atom.from) };
	}
	const last = list.filter(a => a.node).pop();
	return last?.node ? { node: last.node, offset: last.length } : { node: root, offset: root.childNodes.length };
}

/** Selects a stretch of the text, by position rather than by node. */
export function selectOffsets(root: HTMLElement, from: number, to: number): void {
	const selection = root.ownerDocument.getSelection();
	if (!selection) return;
	const start = pointAt(root, from);
	const end = pointAt(root, to);
	const range = root.ownerDocument.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	selection.removeAllRanges();
	selection.addRange(range);
}

/** Wraps whatever is selected in an element, keeping the formatting inside it. */
export function surroundSelection(root: HTMLElement, tag: "code"): boolean {
	const selection = root.ownerDocument.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
	const range = selection.getRangeAt(0);
	if (!root.contains(range.commonAncestorContainer)) return false;
	const wrapper = root.ownerDocument.createElement(tag);
	wrapper.className = "notelens-run-code";
	try {
		range.surroundContents(wrapper);
	} catch {
		// The selection crossed an element boundary: move the contents by hand.
		wrapper.appendChild(range.extractContents());
		range.insertNode(wrapper);
	}
	selection.removeAllRanges();
	const after = root.ownerDocument.createRange();
	after.selectNodeContents(wrapper);
	selection.addRange(after);
	return true;
}

/** Drops the `<code>` wrappers touched by the selection. */
export function unwrapCode(root: HTMLElement): boolean {
	const selection = root.ownerDocument.getSelection();
	if (!selection || selection.rangeCount === 0) return false;
	const range = selection.getRangeAt(0);
	const inside = Array.from(root.querySelectorAll("code")).filter(el => range.intersectsNode(el));
	if (!inside.length) return false;
	for (const el of inside) {
		const parent = el.parentNode;
		if (!parent) continue;
		while (el.firstChild) parent.insertBefore(el.firstChild, el);
		el.remove();
	}
	root.normalize();
	return true;
}
