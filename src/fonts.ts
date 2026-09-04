import type { CanvasFont } from "./types";

/**
 * Every typeface a text box can wear, in one place: the ribbon panel, the
 * floating format bar, the canvas measurer and the PDF export all read this
 * table, so adding a family here is enough to make it available everywhere.
 *
 * `css` is a full stack with system fallbacks — no web fonts are downloaded,
 * so a board looks the same offline and Obsidian never blocks on the network.
 * `pdf` maps the family onto one of the three cores jsPDF always ships.
 */
export const CANVAS_FONTS: { id: CanvasFont; label: string; css: string; pdf: "helvetica" | "times" | "courier" }[] = [
	{ id: "sans", label: "Interfaz", css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", pdf: "helvetica" },
	{ id: "serif", label: "Clásica", css: "Georgia, 'Times New Roman', serif", pdf: "times" },
	{ id: "rounded", label: "Redondeada", css: "'Trebuchet MS', 'Segoe UI', sans-serif", pdf: "helvetica" },
	{ id: "mono", label: "Monoespaciada", css: "ui-monospace, SFMono-Regular, Consolas, monospace", pdf: "courier" },
	{ id: "handwriting", label: "Manuscrita", css: "'Segoe Script', 'Bradley Hand', 'Brush Script MT', cursive", pdf: "times" },
	{ id: "marker", label: "Rotulador", css: "'Comic Sans MS', 'Segoe Print', 'Chalkboard SE', cursive", pdf: "helvetica" },
	{ id: "elegant", label: "Elegante", css: "Garamond, 'Palatino Linotype', 'Book Antiqua', Palatino, serif", pdf: "times" },
	{ id: "slab", label: "Slab", css: "Rockwell, 'Roboto Slab', 'Bookman Old Style', Georgia, serif", pdf: "times" },
	{ id: "condensed", label: "Estrecha", css: "'Arial Narrow', 'Roboto Condensed', 'Segoe UI', sans-serif", pdf: "helvetica" },
	{ id: "typewriter", label: "Máquina de escribir", css: "'Courier New', Courier, monospace", pdf: "courier" },
	{ id: "display", label: "Titular", css: "Impact, Haettenschweiler, 'Arial Black', sans-serif", pdf: "helvetica" }
];

/** CSS stack for a family; anything unknown falls back to the interface font. */
export function fontStack(font: CanvasFont | undefined): string {
	return (CANVAS_FONTS.find(f => f.id === font) ?? CANVAS_FONTS[0]).css;
}

/** jsPDF core font for a family. */
export function pdfFontFor(font: CanvasFont | undefined): "helvetica" | "times" | "courier" {
	return (CANVAS_FONTS.find(f => f.id === font) ?? CANVAS_FONTS[0]).pdf;
}
