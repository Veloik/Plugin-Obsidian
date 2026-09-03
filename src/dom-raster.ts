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
	return m ? (m[1] ?? m[2]).replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(.)/g, "$1") : "";
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
	drawBorders(style, x, y, w, h, frame);
	if (tag === "MJX-C") {
		drawGlyph(el as HTMLElement, x, y, w, h, frame);
		return;
	}
	for (const node of Array.from(el.childNodes)) {
		if (node.nodeType === Node.ELEMENT_NODE) {
			paint(node as Element, frame);
		} else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
			// Plain words (\text{…}) are real text nodes with the element's font.
			frame.ctx.font = fontOf(style);
			frame.ctx.textBaseline = "alphabetic";
			frame.ctx.fillText(node.textContent, x, y + (px(style.paddingTop) || h * 0.8));
		}
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
