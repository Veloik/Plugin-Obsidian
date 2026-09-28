/**
 * Turns a typeset formula (a MathJax CHTML container) into a PNG, so a PDF
 * export shows the formula and not its source. MathJax lays glyphs out as
 * `mjx-c` elements whose `::before` carries the character, its font and,
 * through padding, its height above and depth below the baseline; rules
 * (fraction bars, radicals, table lines) are borders. Walking that tree and
 * drawing each piece on a canvas with the fonts the page already loaded
 * reproduces the formula exactly, with no dependence on anything the
 * browser will not do inside an image.
 */

export interface RasterImage {
	dataUrl: string;
	/** CSS pixels, independent of the board's zoom. */
	width: number;
	height: number;
	/** Offset inside the owning box, in CSS pixels. */
	dx?: number;
	dy?: number;
}

interface Frame {
	ctx: CanvasRenderingContext2D;
	originX: number;
	originY: number;
	/** Screen pixels per CSS pixel: the board zoom the rects were measured under. */
	zoom: number;
	/**
	 * For a whole text box: each word keeps its own colour, highlight and
	 * underline, with colours too pale for white paper replaced by `ink`.
	 */
	rich?: { ink: string };
}

/** Parses the rgb()/rgba() a computed style gives; null for transparent. */
function cssColor(value: string): { r: number; g: number; b: number; a: number } | null {
	const m = /rgba?\(([^)]+)\)/.exec(value);
	if (!m) return null;
	const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
	return a > 0.02 ? { r, g, b, a } : null;
}

/** A colour as it can be printed: white or pale ink would vanish on the page. */
function printable(value: string, ink: string): string {
	const c = cssColor(value);
	if (!c) return ink;
	const light = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
	return light > 0.62 ? ink : `rgb(${c.r}, ${c.g}, ${c.b})`;
}

/**
 * Plain words, one at a time, where the layout put them: a text node can wrap
 * over several lines, and only a range per word knows which line each is on.
 */
function paintWords(node: Text, style: CSSStyleDeclaration, frame: Frame): void {
	const { ctx } = frame;
	const text = node.textContent ?? "";
	ctx.save();
	ctx.font = fontOf(style);
	ctx.textBaseline = "alphabetic";
	if (frame.rich) ctx.fillStyle = printable(style.color, frame.rich.ink);
	const range = document.createRange();
	const lines = style.textDecorationLine || "";
	for (const match of text.matchAll(/\S+/g)) {
		range.setStart(node, match.index);
		range.setEnd(node, match.index + match[0].length);
		const rect = range.getClientRects()[0];
		if (!rect || !rect.width) continue;
		const x = (rect.left - frame.originX) / frame.zoom;
		const y = (rect.top - frame.originY) / frame.zoom;
		const w = rect.width / frame.zoom;
		const h = rect.height / frame.zoom;
		const metrics = ctx.measureText(match[0]);
		const ascent = metrics.fontBoundingBoxAscent || h * 0.8;
		const descent = metrics.fontBoundingBoxDescent || h * 0.2;
		const baseline = y + (h - ascent - descent) / 2 + ascent;
		ctx.fillText(match[0], x, baseline);
		if (frame.rich && lines.includes("underline")) ctx.fillRect(x, baseline + descent * 0.35, w, Math.max(1, h * 0.05));
		if (frame.rich && lines.includes("line-through")) ctx.fillRect(x, baseline - ascent * 0.32, w, Math.max(1, h * 0.05));
	}
	ctx.restore();
}

function px(value: string): number {
	const n = parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}

/** The character a ::before rule shows, without the quotes computed styles keep. */
function pseudoContent(style: CSSStyleDeclaration): string {
	const raw = style.content;
	if (!raw || raw === "none" || raw === "normal") return "";
	const m = /^"([\s\S]*)"$|^'([\s\S]*)'$/.exec(raw);
	return m ? (m[1] ?? m[2]).replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_: string, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(.)/g, "$1") : "";
}

function fontOf(style: CSSStyleDeclaration): string {
	return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

/** Borders are how MathJax draws every rule; they are filled at their own width. */
function drawBorders(style: CSSStyleDeclaration, x: number, y: number, w: number, h: number, frame: Frame): void {
	const { ctx } = frame;
	const top = style.borderTopStyle !== "none" ? px(style.borderTopWidth) : 0;
	const bottom = style.borderBottomStyle !== "none" ? px(style.borderBottomWidth) : 0;
	const left = style.borderLeftStyle !== "none" ? px(style.borderLeftWidth) : 0;
	const right = style.borderRightStyle !== "none" ? px(style.borderRightWidth) : 0;
	if (top > 0) ctx.fillRect(x, y, w, top);
	if (bottom > 0) ctx.fillRect(x, y + h - bottom, w, bottom);
	if (left > 0) ctx.fillRect(x, y, left, h);
	if (right > 0) ctx.fillRect(x + w - right, y, right, h);
}

function drawGlyph(el: HTMLElement, x: number, y: number, w: number, h: number, frame: Frame): void {
	const before = getComputedStyle(el, "::before");
	const text = el.textContent?.trim() || pseudoContent(before);
	if (!text) return;
	const style = el.textContent?.trim() ? getComputedStyle(el) : before;
	const { ctx } = frame;
	ctx.font = fontOf(style);
	ctx.textBaseline = "alphabetic";
	const ascent = px(style.paddingTop);
	const descent = px(style.paddingBottom);
	const parent = el.parentElement;
	const stretchy = parent?.tagName === "MJX-EXT" ? parent.parentElement?.tagName : "";
	if (stretchy === "MJX-STRETCHY-V" && ascent + descent > 0) {
		// The middle of a tall bracket is one glyph stretched to fill its box.
		ctx.save();
		ctx.beginPath();
		ctx.rect(x, y, w, h);
		ctx.clip();
		ctx.translate(x, y);
		ctx.scale(1, h / (ascent + descent));
		ctx.fillText(text, 0, ascent);
		ctx.restore();
		return;
	}
	if (stretchy === "MJX-STRETCHY-H") {
		const natural = ctx.measureText(text).width || 1;
		ctx.save();
		ctx.beginPath();
		ctx.rect(x, y, w, h);
		ctx.clip();
		ctx.translate(x, y);
		ctx.scale(w / natural, 1);
		ctx.fillText(text, 0, ascent || h * 0.8);
		ctx.restore();
		return;
	}
	ctx.fillText(text, x, y + (ascent || h * 0.8));
}

function paint(el: Element, frame: Frame): void {
	const tag = el.tagName;
	if (tag === "MJX-ASSISTIVE-MML" || tag === "SCRIPT" || tag === "STYLE") return;
	const style = getComputedStyle(el);
	if (style.display === "none" || style.visibility === "hidden") return;
	const rect = el.getBoundingClientRect();
	const x = (rect.left - frame.originX) / frame.zoom;
	const y = (rect.top - frame.originY) / frame.zoom;
	const w = rect.width / frame.zoom;
	const h = rect.height / frame.zoom;
	if (frame.rich) {
		// Chrome of the box on the board (resize grip, close button) is not content.
		if (tag === "BUTTON" || el.classList.contains("notelens-text-resize") || el.classList.contains("notelens-box-close")) return;
		// A highlighted word: its tint behind each line it covers.
		const background = cssColor(style.backgroundColor);
		if (background && el.parentElement && style.display.startsWith("inline")) {
			frame.ctx.save();
			frame.ctx.fillStyle = `rgba(${background.r}, ${background.g}, ${background.b}, ${background.a})`;
			for (const r of Array.from(el.getClientRects())) {
				frame.ctx.fillRect((r.left - frame.originX) / frame.zoom, (r.top - frame.originY) / frame.zoom, r.width / frame.zoom, r.height / frame.zoom);
			}
			frame.ctx.restore();
		}
		// Typeset maths inside the text takes the colour of the words around it.
		if (tag === "MJX-CONTAINER") frame.ctx.fillStyle = frame.ctx.strokeStyle = printable(style.color, frame.rich.ink);
	}
	if (!frame.rich || tag.startsWith("MJX")) drawBorders(style, x, y, w, h, frame);
	if (tag === "MJX-C") {
		drawGlyph(el as HTMLElement, x, y, w, h, frame);
		return;
	}
	for (const node of Array.from(el.childNodes)) {
		if (node.nodeType === Node.ELEMENT_NODE) {
			paint(node as Element, frame);
		} else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
			// Plain words (\text{…} in a formula, prose in a box) are real text
			// nodes with the element's font.
			paintWords(node as Text, style, frame);
		}
	}
}

/**
 * A whole text box as a picture — its words, their colours and highlights and
 * the formulas typeset among them — for a PDF page that has to show `$x^2$`
 * written inside a sentence as maths rather than as its source.
 */
export async function rasterizeTextBox(root: HTMLElement, ink: string, scale = 3): Promise<RasterImage | null> {
	try {
		await document.fonts?.ready;
		const width = Math.ceil(root.offsetWidth);
		const height = Math.ceil(root.offsetHeight);
		if (!width || !height) return null;
		const origin = root.getBoundingClientRect();
		const canvas = createEl("canvas");
		canvas.width = Math.ceil(width * scale);
		canvas.height = Math.ceil(height * scale);
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.scale(scale, scale);
		ctx.fillStyle = ink;
		ctx.strokeStyle = ink;
		const frame: Frame = { ctx, originX: origin.left, originY: origin.top, zoom: origin.width / width || 1, rich: { ink } };
		for (const node of Array.from(root.childNodes)) {
			if (node.nodeType === Node.ELEMENT_NODE) paint(node as Element, frame);
			else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) paintWords(node as Text, getComputedStyle(root), frame);
		}
		return { dataUrl: canvas.toDataURL("image/png"), width, height };
	} catch {
		return null;
	}
}

/**
 * Renders `root` at `scale` device pixels per CSS pixel in the given colour,
 * which is what a formula on a dark board needs to become ink on a white
 * page. Returns null when the browser cannot produce the image.
 */
export async function rasterizeMath(root: HTMLElement, color: string, scale = 3): Promise<RasterImage | null> {
	try {
		await document.fonts?.ready;
		const width = Math.ceil(root.offsetWidth);
		const height = Math.ceil(root.offsetHeight);
		if (!width || !height) return null;
		const origin = root.getBoundingClientRect();
		const canvas = createEl("canvas");
		canvas.width = Math.ceil(width * scale);
		canvas.height = Math.ceil(height * scale);
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.scale(scale, scale);
		ctx.fillStyle = color;
		ctx.strokeStyle = color;
		paint(root, { ctx, originX: origin.left, originY: origin.top, zoom: origin.width / width || 1 });
		return { dataUrl: canvas.toDataURL("image/png"), width, height };
	} catch {
		return null;
	}
}
