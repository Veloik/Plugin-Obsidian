import { unzipSync, zipSync } from "fflate";
import type { Zippable } from "fflate";
import { tr } from "./i18n";
import { buildDeck, buildDocx } from "./office-templates";
import type { DeckThemeId, DocTemplateId } from "./office-templates";

/**
 * Word (.docx) and PowerPoint (.pptx) files, read and edited on the board.
 *
 * Both are zips of XML. The file is opened in place, painted as editable HTML
 * with the fonts, sizes, colours, margins and lists it declares, and — only for
 * the paragraphs that were touched — written back into the very same XML, run
 * properties included, so everything the editor has no picture for (styles,
 * headers, animations, comments…) travels through untouched.
 */

export type OfficeKind = "docx" | "pptx";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** A document this big is a sign of something that is not a document. */
const MAX_OFFICE_BYTES = 96 * 1024 * 1024;
const MAX_OFFICE_ENTRIES = 12000;
const EMU_PER_PX = 9525;
/** Twentieths of a point to CSS pixels. */
const TWIP_PX = 1 / 15;

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const serializer = new XMLSerializer();

/** One stretch of text with one look. `r` points into the paragraph's table of source run properties. */
/** `link` names where a hyperlink points: "r:<relationship id>" for an address, "a:<bookmark>" for a place in the document. */
export interface Segment { text: string; b: boolean; i: boolean; u: boolean; r: number; pt?: number; color?: string; font?: string; hl?: string; link?: string }
export type Align = "left" | "center" | "right" | "justify";
export type FormatOp =
	| { kind: "flag"; tag: "b" | "i" | "u" }
	| { kind: "size"; pt: number }
	| { kind: "color"; hex: string }
	| { kind: "font"; name: string }
	| { kind: "highlight"; hex: string | null };

interface Snapshot { docs: Map<string, string>; parts: string[] }
interface Binding { part: string; node: Element; dialect: "w" | "a"; el: HTMLElement }
interface Rel { id: string; type: string; target: string; url: string }

/** The source run properties of every painted paragraph, by the element that shows it. */
const runTables = new WeakMap<HTMLElement, Element[]>();

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function kids(el: Element | null | undefined, ns: string, name: string): Element[] {
	return el ? Array.from(el.children).filter(c => c.localName === name && c.namespaceURI === ns) : [];
}
function kid(el: Element | null | undefined, ns: string, name: string): Element | null {
	return kids(el, ns, name)[0] ?? null;
}
function deep(el: Element | Document | null | undefined, ns: string, name: string): Element[] {
	return el ? Array.from(el.getElementsByTagNameNS(ns, name)) : [];
}
function wVal(el: Element | null | undefined): string | null {
	return el ? el.getAttributeNS(W_NS, "val") ?? el.getAttribute("w:val") : null;
}
function wAttr(el: Element | null | undefined, name: string): string | null {
	return el ? el.getAttributeNS(W_NS, name) ?? el.getAttribute(`w:${name}`) : null;
}
function wNum(el: Element | null | undefined, name: string): number | undefined {
	const v = wAttr(el, name);
	if (v === null || v === "") return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}
function num(el: Element | null | undefined, attr: string): number | undefined {
	const v = el?.getAttribute(attr);
	if (v === null || v === undefined || v === "") return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}

function resolvePath(base: string, target: string): string {
	if (target.startsWith("/")) return target.slice(1);
	const parts = base.split("/").slice(0, -1).concat(target.split("/"));
	const out: string[] = [];
	for (const part of parts) {
		if (!part || part === ".") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return out.join("/");
}

function mimeOf(path: string): string | null {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	if (ext === "png") return "image/png";
	if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
	if (ext === "gif") return "image/gif";
	if (ext === "webp") return "image/webp";
	if (ext === "svg") return "image/svg+xml";
	if (ext === "bmp") return "image/bmp";
	return null;
}

/** Schema-ordered insertion: Word refuses a file whose properties are out of order. */
function insertOrdered(parent: Element, el: Element, order: string[]): void {
	const rank = order.indexOf(el.localName);
	const before = Array.from(parent.children).find(c => order.indexOf(c.localName) > rank);
	if (before) parent.insertBefore(el, before);
	else parent.appendChild(el);
}

const W_RPR_ORDER = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow",
	"emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs",
	"highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"];
const A_RPR_ORDER = ["ln", "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "effectLst", "effectDag", "highlight", "uLnTx", "uLn", "uFillTx", "uFill", "latin", "ea", "cs", "sym", "hlinkClick", "hlinkMouseOver", "rtl", "extLst"];
const W_PPR_ORDER = ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers",
	"pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN",
	"bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc",
	"textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"];

function setWordProp(rPr: Element, name: string, attrs: Record<string, string> | null): void {
	for (const old of kids(rPr, W_NS, name)) old.remove();
	if (!attrs) return;
	const el = rPr.ownerDocument.createElementNS(W_NS, `w:${name}`);
	for (const [key, value] of Object.entries(attrs)) el.setAttributeNS(W_NS, `w:${key}`, value);
	insertOrdered(rPr, el, W_RPR_ORDER);
}

// ---------------------------------------------------------------------------
// The opened package
// ---------------------------------------------------------------------------

export class OfficeSession {
	readonly slides: string[] = [];
	slideW = 12192000;
	slideH = 6858000;
	private docs = new Map<string, Document>();
	private dirty = new Set<Binding>();
	private touched = new Set<string>();
	private bindings = new WeakMap<HTMLElement, Binding>();
	private byNode = new WeakMap<Element, HTMLElement>();
	private urls: string[] = [];
	private themeColors: Record<string, string> | null = null;
	private themeFonts: { major: string; minor: string } | null = null;
	private changed = false;
	onChange?: () => void;
	/** Something changed the shape of the document (a paragraph split, a list made): the page must be drawn again. */
	onStructure?: (focus?: { node: Element; offset: number }) => void;

	constructor(readonly kind: OfficeKind, readonly files: Record<string, Uint8Array>) {}

	xml(path: string): Document | null {
		const cached = this.docs.get(path);
		if (cached) return cached;
		const raw = this.files[path];
		if (!raw) return null;
		const doc = new DOMParser().parseFromString(decoder.decode(raw), "application/xml");
		if (doc.querySelector("parsererror")) return null;
		this.docs.set(path, doc);
		return doc;
	}

	rels(part: string): Rel[] {
		const dir = part.split("/").slice(0, -1).join("/");
		const name = part.split("/").pop() ?? "";
		const doc = this.xml(`${dir ? `${dir}/` : ""}_rels/${name}.rels`);
		return Array.from(doc?.getElementsByTagName("Relationship") ?? []).map(r => ({
			id: r.getAttribute("Id") ?? "",
			type: r.getAttribute("Type") ?? "",
			target: r.getAttribute("TargetMode") === "External" ? "" : resolvePath(part, r.getAttribute("Target") ?? ""),
			url: r.getAttribute("TargetMode") === "External" ? r.getAttribute("Target") ?? "" : ""
		}));
	}

	/** A picture of the package as an address the page can show; released with the session. */
	media(path: string): string | null {
		const data = this.files[path];
		const type = mimeOf(path);
		if (!data || !type) return null;
		const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type }));
		this.urls.push(url);
		return url;
	}

	release(): void {
		for (const url of this.urls) URL.revokeObjectURL(url);
		this.urls = [];
	}

	get hasChanges(): boolean { return this.changed; }

	private undoStack: Snapshot[] = [];
	private redoStack: Snapshot[] = [];
	private lastTyping = 0;

	private snapshot(): Snapshot {
		const docs = new Map<string, string>();
		for (const [path, doc] of this.docs) docs.set(path, serializer.serializeToString(doc.documentElement));
		return { docs, parts: Object.keys(this.files) };
	}

	/** Remembers the document as it is, so the edit about to be made can be undone. */
	checkpoint(): void {
		this.commit();
		this.undoStack.push(this.snapshot());
		if (this.undoStack.length > 120) this.undoStack.shift();
		this.redoStack.length = 0;
	}

	/** Typing is checkpointed once per burst, not once per letter. */
	private typingCheckpoint(): void {
		const now = Date.now();
		if (now - this.lastTyping > 1000) this.checkpoint();
		this.lastTyping = now;
	}

	get canUndo(): boolean { return this.undoStack.length > 0; }
	get canRedo(): boolean { return this.redoStack.length > 0; }

	undo(): boolean { return this.travel(this.undoStack, this.redoStack); }
	redo(): boolean { return this.travel(this.redoStack, this.undoStack); }

	private travel(from: Snapshot[], to: Snapshot[]): boolean {
		const target = from.pop();
		if (!target) return false;
		this.commit();
		to.push(this.snapshot());
		this.lastTyping = 0;
		for (const name of Object.keys(this.files)) {
			if (!target.parts.includes(name) && this.docs.has(name)) { delete this.files[name]; this.docs.delete(name); this.touched.delete(name); }
		}
		for (const [path, text] of target.docs) {
			const current = this.docs.get(path);
			if (current && serializer.serializeToString(current.documentElement) === text) continue;
			this.docs.set(path, new DOMParser().parseFromString(text, "application/xml"));
			if (!(path in this.files)) this.files[path] = new Uint8Array(0);
			this.touched.add(path);
		}
		if (this.kind === "pptx") this.readSlides();
		this.changed = true;
		this.onChange?.();
		return true;
	}

	/** Reads the deck's slide order and size out of presentation.xml. */
	readSlides(): void {
		const presentation = this.xml("ppt/presentation.xml");
		if (!presentation) return;
		const size = deep(presentation, P_NS, "sldSz")[0];
		this.slideW = num(size, "cx") ?? this.slideW;
		this.slideH = num(size, "cy") ?? this.slideH;
		const rels = this.rels("ppt/presentation.xml");
		this.slides.length = 0;
		for (const id of deep(presentation, P_NS, "sldId")) {
			const rid = id.getAttributeNS(R_NS, "id") ?? id.getAttribute("r:id");
			const target = rels.find(r => r.id === rid)?.target;
			if (target && this.files[target]) this.slides.push(target);
		}
	}

	/** Something about the file changed that is not a run of text (a style, an alignment). */
	touch(part: string): void {
		this.touched.add(part);
		this.changed = true;
		this.onChange?.();
	}

	bind(el: HTMLElement, node: Element, part: string, dialect: "w" | "a"): void {
		const binding: Binding = { part, node, dialect, el };
		this.bindings.set(el, binding);
		this.byNode.set(node, el);
		el.addEventListener("beforeinput", () => this.typingCheckpoint());
		el.addEventListener("input", () => {
			this.dirty.add(binding);
			this.changed = true;
			this.onChange?.();
		});
	}

	elementFor(node: Element): HTMLElement | null {
		return this.byNode.get(node) ?? null;
	}

	/** A part the package did not have: a new slide, its relationships. */
	addPart(path: string, xml: string): void {
		const doc = new DOMParser().parseFromString(xml, "application/xml");
		this.files[path] = new Uint8Array(0);
		this.docs.set(path, doc);
		this.touched.add(path);
		this.changed = true;
	}

	removePart(path: string): void {
		delete this.files[path];
		this.docs.delete(path);
		this.touched.delete(path);
		this.changed = true;
	}

	bindingOf(el: HTMLElement | null): Binding | null {
		return el ? this.bindings.get(el) ?? null : null;
	}

	/** Puts every edited paragraph back into its XML, so anything reading the XML sees the text as typed. */
	commit(): void {
		for (const binding of this.dirty) {
			const segments = segmentsFromDom(binding.el);
			const table = runTables.get(binding.el) ?? [];
			if (binding.dialect === "w") writeWordRuns(binding.node, segments, table);
			else writePptRuns(binding.node, segments, table);
			this.touched.add(binding.part);
		}
		this.dirty.clear();
	}

	/** The zip, with every edit in it. */
	serialize(): Uint8Array {
		this.commit();
		this.changed = false;
		const out: Zippable = {};
		for (const [name, data] of Object.entries(this.files)) {
			const doc = this.touched.has(name) ? this.docs.get(name) : undefined;
			if (doc) {
				const text = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${serializer.serializeToString(doc.documentElement)}`;
				out[name] = encoder.encode(text);
			} else if (/\/media\//i.test(name) || /\.(png|jpe?g|gif|webp|mp4|mp3)$/i.test(name)) {
				out[name] = [data, { level: 0 }];
			} else {
				out[name] = data;
			}
		}
		return zipSync(out);
	}

	private loadTheme(): void {
		if (this.themeColors) return;
		const colors: Record<string, string> = {};
		const path = Object.keys(this.files).filter(n => /^(ppt|word)\/theme\/theme\d+\.xml$/.test(n)).sort()[0];
		const theme = path ? this.xml(path) : null;
		const scheme = deep(theme, A_NS, "clrScheme")[0];
		for (const c of Array.from(scheme?.children ?? [])) {
			const inner = c.firstElementChild;
			const value = inner?.localName === "srgbClr" ? inner.getAttribute("val") : inner?.getAttribute("lastClr");
			if (value) colors[c.localName] = `#${value}`;
		}
		const masterPath = Object.keys(this.files).find(n => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n));
		const map = deep(masterPath ? this.xml(masterPath) : null, P_NS, "clrMap")[0];
		const alias = (name: string, fallback: string): string => colors[map?.getAttribute(name) ?? fallback] ?? colors[fallback] ?? (name.startsWith("bg") ? "#ffffff" : "#000000");
		colors.tx1 = alias("tx1", "dk1");
		colors.bg1 = alias("bg1", "lt1");
		colors.tx2 = alias("tx2", "dk2");
		colors.bg2 = alias("bg2", "lt2");
		this.themeColors = colors;
		const face = (which: string) => deep(theme, A_NS, which)[0] ? kid(deep(theme, A_NS, which)[0], A_NS, "latin")?.getAttribute("typeface") ?? "" : "";
		this.themeFonts = { major: face("majorFont"), minor: face("minorFont") };
	}

	/** Theme colours by their scheme name, with the aliases slides use. */
	color(name: string): string | null {
		this.loadTheme();
		return this.themeColors?.[name] ?? null;
	}

	font(which: "major" | "minor"): string {
		this.loadTheme();
		return this.themeFonts?.[which] ?? "";
	}
}

/** Opens a .docx or .pptx. Nothing in it is executed; it is only read. */
export function openOffice(buffer: ArrayBuffer, kind: OfficeKind): OfficeSession {
	if (buffer.byteLength > MAX_OFFICE_BYTES) throw new Error(tr("El documento es demasiado grande para abrirlo en la pizarra."));
	let entries = 0;
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(new Uint8Array(buffer), { filter: () => ++entries <= MAX_OFFICE_ENTRIES });
	} catch {
		throw new Error(tr("Este archivo no se puede abrir: está protegido, dañado o es de una versión antigua."));
	}
	const session = new OfficeSession(kind, files);
	if (kind === "docx") {
		if (!session.xml("word/document.xml")) throw new Error(tr("Este archivo no parece un documento de Word."));
		return session;
	}
	if (!session.xml("ppt/presentation.xml")) throw new Error(tr("Este archivo no parece una presentación de PowerPoint."));
	session.readSlides();
	if (!session.slides.length) throw new Error(tr("Esta presentación no tiene diapositivas."));
	return session;
}

// ---------------------------------------------------------------------------
// Runs <-> segments
// ---------------------------------------------------------------------------

function sameLook(a: Segment, b: Segment): boolean {
	return a.b === b.b && a.i === b.i && a.u === b.u && a.r === b.r && a.pt === b.pt && a.color === b.color && a.font === b.font && a.hl === b.hl && a.link === b.link;
}

function pushSegment(out: Segment[], seg: Segment): void {
	if (!seg.text) return;
	const last = out[out.length - 1];
	if (last && sameLook(last, seg)) last.text += seg.text;
	else out.push(seg);
}

function flagOn(el: Element | null, isWord: boolean, name: string): boolean {
	if (!el) return false;
	if (isWord) {
		const child = kid(el, W_NS, name);
		if (!child) return false;
		const v = wVal(child);
		return name === "u" ? !!v && v !== "none" : v !== "0" && v !== "false" && v !== "off";
	}
	const v = el.getAttribute(name);
	return name === "u" ? !!v && v !== "none" : v === "1" || v === "true";
}

/** Index of an equal run-properties element in the table, adding it when it is new. */
function tableIndex(table: Element[], keys: string[], rPr: Element | null): number {
	if (!rPr) return -1;
	const key = serializer.serializeToString(rPr);
	const found = keys.indexOf(key);
	if (found >= 0) return found;
	keys.push(key);
	table.push(rPr.cloneNode(true) as Element);
	return table.length - 1;
}

function readWordRuns(p: Element, table: Element[]): Segment[] {
	const out: Segment[] = [];
	const keys: string[] = [];
	const walk = (parent: Element, link?: string) => {
		for (const child of Array.from(parent.children)) {
			if (child.namespaceURI !== W_NS) continue;
			const name = child.localName;
			if (name === "del") continue;
			if (name === "hyperlink") {
				const rid = child.getAttributeNS(R_NS, "id") ?? child.getAttribute("r:id");
				const anchor = wAttr(child, "anchor");
				walk(child, rid ? `r:${rid}` : anchor ? `a:${anchor}` : link);
				continue;
			}
			if (name === "smartTag" || name === "ins" || name === "fldSimple") { walk(child, link); continue; }
			if (name === "sdt") { const content = kid(child, W_NS, "sdtContent"); if (content) walk(content, link); continue; }
			if (name !== "r") continue;
			const rPr = kid(child, W_NS, "rPr");
			let text = "";
			for (const part of Array.from(child.children)) {
				if (part.namespaceURI !== W_NS) continue;
				if (part.localName === "t") text += part.textContent ?? "";
				else if (part.localName === "tab") text += "\t";
				else if (part.localName === "noBreakHyphen") text += "-";
				else if (part.localName === "br" && (!wAttr(part, "type") || wAttr(part, "type") === "textWrapping")) text += "\n";
			}
			pushSegment(out, {
				text, b: flagOn(rPr, true, "b"), i: flagOn(rPr, true, "i"), u: flagOn(rPr, true, "u"),
				r: tableIndex(table, keys, rPr), link
			});
		}
	};
	walk(p);
	return out;
}

function readPptRuns(p: Element, table: Element[]): Segment[] {
	const out: Segment[] = [];
	const keys: string[] = [];
	for (const child of Array.from(p.children)) {
		if (child.namespaceURI !== A_NS) continue;
		if (child.localName === "br") { pushSegment(out, { text: "\n", b: false, i: false, u: false, r: -1 }); continue; }
		if (child.localName !== "r" && child.localName !== "fld") continue;
		const rPr = kid(child, A_NS, "rPr");
		pushSegment(out, {
			text: kid(child, A_NS, "t")?.textContent ?? "",
			b: flagOn(rPr, false, "b"), i: flagOn(rPr, false, "i"), u: flagOn(rPr, false, "u"),
			r: tableIndex(table, keys, rPr)
		});
	}
	return out;
}

function hexOf(color: string | undefined): string | null {
	if (!color) return null;
	const m = /^#?([0-9a-f]{6})$/i.exec(color);
	if (m) return m[1].toUpperCase();
	const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
	if (!rgb) return null;
	return [rgb[1], rgb[2], rgb[3]].map(n => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** A new run's properties: the source ones it came from, with what the writer changed on top. */
function wordRunProps(doc: Document, seg: Segment, table: Element[], fallback: Element | null): Element {
	const source = seg.r >= 0 ? table[seg.r] : fallback;
	const rPr = source ? source.cloneNode(true) as Element : doc.createElementNS(W_NS, "w:rPr");
	for (const [name, on] of [["b", seg.b], ["i", seg.i]] as const) {
		if (on) setWordProp(rPr, name, {}); else setWordProp(rPr, name, null);
		setWordProp(rPr, `${name}Cs`, null);
	}
	setWordProp(rPr, "u", seg.u ? { val: "single" } : null);
	if (seg.color) setWordProp(rPr, "color", { val: seg.color });
	if (seg.pt) {
		setWordProp(rPr, "sz", { val: String(Math.round(seg.pt * 2)) });
		setWordProp(rPr, "szCs", { val: String(Math.round(seg.pt * 2)) });
	}
	if (seg.font) setWordProp(rPr, "rFonts", { ascii: seg.font, hAnsi: seg.font, cs: seg.font });
	if (seg.hl) {
		setWordProp(rPr, "highlight", null);
		setWordProp(rPr, "shd", seg.hl === "none" ? null : { val: "clear", color: "auto", fill: seg.hl });
	}
	return rPr;
}

function writeWordRuns(p: Element, segments: Segment[], table: Element[]): void {
	const doc = p.ownerDocument;
	const fallback = kid(kid(p, W_NS, "pPr"), W_NS, "rPr");
	// Runs that carry a picture stay; every run of text is replaced by the edited ones.
	for (const child of Array.from(p.children)) {
		if (child.namespaceURI !== W_NS) continue;
		const name = child.localName;
		if (name === "pPr" || name.startsWith("bookmark") || name === "proofErr") continue;
		const carriesObject = deep(child, W_NS, "drawing").length + deep(child, W_NS, "pict").length + deep(child, W_NS, "object").length > 0;
		if (name === "r" && carriesObject) continue;
		child.remove();
	}
	let container: Element = p;
	let current: string | undefined;
	for (const seg of segments) {
		if (seg.link !== current) {
			current = seg.link;
			if (seg.link) {
				const h = doc.createElementNS(W_NS, "w:hyperlink");
				if (seg.link.startsWith("r:")) h.setAttributeNS(R_NS, "r:id", seg.link.slice(2));
				else h.setAttributeNS(W_NS, "w:anchor", seg.link.slice(2));
				h.setAttributeNS(W_NS, "w:history", "1");
				p.appendChild(h);
				container = h;
			} else container = p;
		}
		const r = doc.createElementNS(W_NS, "w:r");
		const rPr = wordRunProps(doc, seg, table, seg.r < 0 ? table[0] ?? null : fallback);
		if (rPr.children.length) r.appendChild(rPr);
		for (const piece of seg.text.split(/(\n|\t)/)) {
			if (!piece) continue;
			if (piece === "\n") r.appendChild(doc.createElementNS(W_NS, "w:br"));
			else if (piece === "\t") r.appendChild(doc.createElementNS(W_NS, "w:tab"));
			else {
				const t = doc.createElementNS(W_NS, "w:t");
				t.setAttributeNS(XML_NS, "xml:space", "preserve");
				t.textContent = piece;
				r.appendChild(t);
			}
		}
		container.appendChild(r);
	}
}

function pptRunProps(doc: Document, seg: Segment, table: Element[]): Element {
	const source = seg.r >= 0 ? table[seg.r] : table[0];
	const rPr = source ? source.cloneNode(true) as Element : doc.createElementNS(A_NS, "a:rPr");
	if (!source) rPr.setAttribute("lang", "es-ES");
	for (const [attr, on, value] of [["b", seg.b, "1"], ["i", seg.i, "1"], ["u", seg.u, "sng"]] as const) {
		if (on) rPr.setAttribute(attr, value);
		else rPr.removeAttribute(attr);
	}
	if (seg.pt) rPr.setAttribute("sz", String(Math.round(seg.pt * 100)));
	const colored = (name: string, hex: string): Element => {
		const holder = doc.createElementNS(A_NS, `a:${name}`);
		const c = doc.createElementNS(A_NS, "a:srgbClr");
		c.setAttribute("val", hex);
		holder.appendChild(c);
		return holder;
	};
	if (seg.color) {
		for (const old of kids(rPr, A_NS, "solidFill")) old.remove();
		insertOrdered(rPr, colored("solidFill", seg.color), A_RPR_ORDER);
	}
	if (seg.hl) {
		for (const old of kids(rPr, A_NS, "highlight")) old.remove();
		if (seg.hl !== "none") insertOrdered(rPr, colored("highlight", seg.hl), A_RPR_ORDER);
	}
	if (seg.font) {
		for (const old of kids(rPr, A_NS, "latin")) old.remove();
		const latin = doc.createElementNS(A_NS, "a:latin");
		latin.setAttribute("typeface", seg.font);
		insertOrdered(rPr, latin, A_RPR_ORDER);
	}
	return rPr;
}

function writePptRuns(p: Element, segments: Segment[], table: Element[]): void {
	const doc = p.ownerDocument;
	for (const child of Array.from(p.children)) {
		if (child.namespaceURI === A_NS && (child.localName === "r" || child.localName === "br" || child.localName === "fld")) child.remove();
	}
	const end = kid(p, A_NS, "endParaRPr");
	const put = (el: Element) => { if (end) p.insertBefore(el, end); else p.appendChild(el); };
	for (const seg of segments) {
		for (const piece of seg.text.split(/(\n)/)) {
			if (!piece) continue;
			if (piece === "\n") { put(doc.createElementNS(A_NS, "a:br")); continue; }
			const r = doc.createElementNS(A_NS, "a:r");
			r.appendChild(pptRunProps(doc, seg, table));
			const t = doc.createElementNS(A_NS, "a:t");
			t.textContent = piece;
			r.appendChild(t);
			put(r);
		}
	}
}

/** What an editable paragraph says now, formatting included. */
export function segmentsFromDom(root: HTMLElement): Segment[] {
	const out: Segment[] = [];
	type State = { b: boolean; i: boolean; u: boolean; r: number; pt?: number; color?: string; font?: string; hl?: string; link?: string };
	const walk = (node: Node, s: State) => {
		if (node.nodeType === 3) { pushSegment(out, { text: node.textContent ?? "", ...s }); return; }
		if (!node.instanceOf(HTMLElement)) return;
		if (node.tagName === "BR") { pushSegment(out, { text: "\n", ...s }); return; }
		const tag = node.tagName.toLowerCase();
		const weight = node.style.fontWeight;
		const next: State = { ...s };
		if (tag === "b" || tag === "strong" || weight === "bold" || Number(weight) >= 600) next.b = true;
		if (tag === "i" || tag === "em" || node.style.fontStyle === "italic") next.i = true;
		if (tag === "u" || node.style.textDecorationLine === "underline") next.u = true;
		if (node.dataset.r !== undefined) next.r = Number(node.dataset.r);
		if (node.dataset.pt) next.pt = Number(node.dataset.pt);
		if (node.dataset.color) next.color = node.dataset.color;
		if (node.dataset.font) next.font = node.dataset.font;
		if (node.dataset.hl) next.hl = node.dataset.hl;
		if (node.dataset.link) next.link = node.dataset.link;
		for (const child of Array.from(node.childNodes)) walk(child, next);
	};
	for (const child of Array.from(root.childNodes)) walk(child, { b: false, i: false, u: false, r: -1 });
	// A line break at the very end only shows if something follows it; the extra one is a placeholder.
	const last = out[out.length - 1];
	if (last && last.text.endsWith("\n") && root.lastChild?.nodeName === "BR") last.text = last.text.slice(0, -1);
	return out.filter(s => s.text);
}

/** How a source run looks, and how an override the editor made is drawn. */
export interface Painter {
	runCss(rPr: Element | null): string;
	sizeCss(pt: number): string;
}

/** Paints segments as formatted text inside an editable element. */
export function paintSegments(el: HTMLElement, segments: Segment[], table: Element[], painter: Painter): void {
	el.empty();
	runTables.set(el, table);
	for (const seg of segments) {
		const lines = seg.text.split("\n");
		lines.forEach((line, index) => {
			if (index > 0) el.createEl("br");
			if (!line) return;
			let target: HTMLElement = el;
			if (seg.link) {
				target = target.createSpan({ cls: "notelens-office-link" });
				target.dataset.link = seg.link;
				target.title = tr("Ctrl+clic para abrir el enlace");
			}
			const rPr = seg.r >= 0 ? table[seg.r] ?? null : null;
			if (rPr) {
				target = target.createSpan();
				target.dataset.r = String(seg.r);
				const css = painter.runCss(rPr);
				if (css) target.style.cssText = css;
			}
			if (seg.b) target = target.createEl("b");
			if (seg.i) target = target.createEl("i");
			if (seg.u) target = target.createEl("u");
			if (seg.color || seg.pt || seg.font || seg.hl) target = overrideSpan(target, painter, seg);
			target.appendText(line);
		});
	}
	const last = segments[segments.length - 1];
	if (last?.text.endsWith("\n")) el.createEl("br");
	// An empty editable paragraph with no line in it has its margins counted twice by Chrome, so it gets the line editors give it.
	if (!segments.length) el.createEl("br");
}

/** The look of an override the editor made, as CSS. */
function overrideCss(painter: Painter, o: { pt?: number; color?: string; font?: string; hl?: string }): string {
	let css = "";
	if (o.pt) css += `font-size:${painter.sizeCss(o.pt)};`;
	if (o.color) css += `color:#${o.color};`;
	if (o.font) css += `font-family:"${o.font.replace(/"/g, "")}",system-ui,sans-serif;`;
	if (o.hl) css += o.hl === "none" ? "background:transparent;" : `background:#${o.hl};`;
	return css;
}

function overrideSpan(into: HTMLElement, painter: Painter, o: { pt?: number; color?: string; font?: string; hl?: string }): HTMLElement {
	const span = into.createSpan();
	if (o.pt) span.dataset.pt = String(o.pt);
	if (o.color) span.dataset.color = o.color;
	if (o.font) span.dataset.font = o.font;
	if (o.hl) span.dataset.hl = o.hl;
	span.style.cssText = overrideCss(painter, o);
	return span;
}

// ---------------------------------------------------------------------------
// Formatting the selection
// ---------------------------------------------------------------------------

/** Where an action lands: the selection, or the whole paragraph when nothing is selected. */
function rangeFor(root: HTMLElement, stored: Range | null | undefined): Range | null {
	const selection = root.ownerDocument.defaultView?.getSelection();
	let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
	if (!range || !root.contains(range.commonAncestorContainer)) range = stored && root.contains(stored.commonAncestorContainer) ? stored : null;
	if (!range) return null;
	if (range.collapsed) {
		const whole = root.ownerDocument.createRange();
		whole.selectNodeContents(root);
		return whole.collapsed ? null : whole;
	}
	return range;
}

function unwrap(el: Element): void {
	const parent = el.parentNode;
	while (parent && el.firstChild) parent.insertBefore(el.firstChild, el);
	el.remove();
}

function textNodesOf(root: Node): Text[] {
	const out: Text[] = [];
	const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n.textContent ?? "").length) out.push(n as Text);
	return out;
}

/** Bold, italic, underline, size or colour on the selection (or the paragraph). */
export function formatSelection(session: OfficeSession, root: HTMLElement, op: FormatOp, stored?: Range | null): void {
	const range = rangeFor(root, stored);
	if (!range) return;
	session.checkpoint();
	const doc = root.ownerDocument;
	let on = false;
	if (op.kind === "flag") {
		for (let n: Node | null = range.startContainer; n && n !== root; n = n.parentNode) {
			if (n.instanceOf(HTMLElement) && n.tagName.toLowerCase() === op.tag) { on = true; break; }
		}
	}
	const fragment = range.extractContents();
	if (op.kind === "flag") {
		for (const el of Array.from(fragment.querySelectorAll(op.tag))) unwrap(el);
		if (!on) {
			const wrapper = createEl(op.tag);
			wrapper.appendChild(fragment.cloneNode(true));
			fragment.replaceChildren(wrapper);
		}
	} else {
		const attr = op.kind === "size" ? "pt" : op.kind === "color" ? "color" : op.kind === "font" ? "font" : "hl";
		const value = op.kind === "size" ? String(op.pt) : op.kind === "color" ? op.hex : op.kind === "font" ? op.name : op.hex ?? "none";
		// An earlier override of the same thing gives way to the new one.
		for (const el of Array.from(fragment.querySelectorAll<HTMLElement>(`[data-${attr}]`))) {
			const others = ["pt", "color", "font", "hl"].filter(k => k !== attr && el.dataset[k]);
			if (others.length) { delete el.dataset[attr]; el.style.cssText = overrideCss(painterFor(session), { pt: Number(el.dataset.pt) || undefined, color: el.dataset.color, font: el.dataset.font, hl: el.dataset.hl }); continue; }
			unwrap(el);
		}
		const painter = painterFor(session);
		const mark: { pt?: number; color?: string; font?: string; hl?: string } = {};
		if (attr === "pt") mark.pt = Number(value); else mark[attr] = value;
		const holder = createDiv();
		for (const text of textNodesOf(fragment)) {
			const span = overrideSpan(holder, painter, mark);
			text.replaceWith(span);
			span.appendChild(text);
		}
	}
	const first = fragment.firstChild, last = fragment.lastChild;
	range.insertNode(fragment);
	const selection = doc.defaultView?.getSelection();
	if (first && last && selection) {
		const kept = doc.createRange();
		kept.setStartBefore(first);
		kept.setEndAfter(last);
		selection.removeAllRanges();
		selection.addRange(kept);
	}
	root.dispatchEvent(new Event("input", { bubbles: true }));
}

/** What the selection looks like now, for the toolbar to show. */
export function formatState(session: OfficeSession, root: HTMLElement, stored?: Range | null): { b: boolean; i: boolean; u: boolean; pt: number; color: string; align: Align } {
	const selection = root.ownerDocument.defaultView?.getSelection();
	let anchor: Node | null = selection?.rangeCount && root.contains(selection.anchorNode) ? selection.anchorNode : stored?.startContainer ?? root.firstChild ?? root;
	if (anchor && !root.contains(anchor)) anchor = root;
	const state = { b: false, i: false, u: false, pt: 0, color: "", align: "left" as Align };
	for (let n: Node | null = anchor; n; n = n.parentNode) {
		if (n.instanceOf(HTMLElement)) {
			const tag = n.tagName.toLowerCase();
			if (tag === "b") state.b = true;
			if (tag === "i") state.i = true;
			if (tag === "u") state.u = true;
			if (!state.color && n.dataset.color) state.color = n.dataset.color;
		}
		if (n === root) break;
	}
	const element = anchor?.instanceOf(HTMLElement) ? anchor : anchor?.parentElement ?? root;
	const px = parseFloat(root.ownerDocument.defaultView?.getComputedStyle(element).fontSize ?? "0");
	state.pt = session.kind === "docx"
		? Math.round(px * 0.75 * 2 * (1 / zoomOf(root))) / 2
		: Math.round((px / Math.max(1, root.closest<HTMLElement>(".notelens-slide")?.clientWidth ?? 1)) * session.slideW / 12700 * 2) / 2;
	if (!state.color) state.color = hexOf(root.ownerDocument.defaultView?.getComputedStyle(element).color) ?? "";
	for (const a of ["center", "right", "justify"] as const) if (root.classList.contains(`is-${a}`)) state.align = a;
	return state;
}

function zoomOf(root: HTMLElement): number {
	const z = parseFloat(root.closest<HTMLElement>(".notelens-office-paper")?.style.getPropertyValue("zoom") ?? "");
	return Number.isFinite(z) && z > 0 ? z : 1;
}

/** Sizes the size buttons step through, in points. */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 54, 60, 72, 96];

export function stepSize(current: number, direction: 1 | -1): number {
	if (direction > 0) return FONT_SIZES.find(s => s > current + 0.01) ?? FONT_SIZES[FONT_SIZES.length - 1];
	return [...FONT_SIZES].reverse().find(s => s < current - 0.01) ?? FONT_SIZES[0];
}

/** Enter is a line break inside the paragraph, and paste keeps only its text. */
function tameEditable(el: HTMLElement, hooks?: { enter?: () => void; backspaceStart?: () => boolean }): void {
	el.addEventListener("keydown", (event) => {
		event.stopPropagation();
		if (event.key === "Backspace" && hooks?.backspaceStart && !event.isComposing && hooks.backspaceStart()) {
			event.preventDefault();
			return;
		}
		if (event.key !== "Enter" || event.isComposing) return;
		event.preventDefault();
		if (hooks?.enter && !event.shiftKey) { hooks.enter(); return; }
		const selection = el.ownerDocument.defaultView?.getSelection();
		if (!selection?.rangeCount) return;
		const range = selection.getRangeAt(0);
		range.deleteContents();
		const br = createEl("br");
		range.insertNode(br);
		// A break with nothing after it does not show; the placeholder makes it visible.
		if (!br.nextSibling) br.after(createEl("br"));
		range.setStartAfter(br);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		el.dispatchEvent(new Event("input", { bubbles: true }));
	});
	el.addEventListener("keyup", (event) => event.stopPropagation());
	el.addEventListener("paste", (event) => {
		// A picture on the clipboard is the editor's to place, not this paragraph's.
		if (event.clipboardData?.files.length) return;
		const text = event.clipboardData?.getData("text/plain");
		if (text === undefined) return;
		event.preventDefault();
		const selection = el.ownerDocument.defaultView?.getSelection();
		if (!selection?.rangeCount) return;
		const range = selection.getRangeAt(0);
		range.deleteContents();
		const node = el.ownerDocument.createTextNode(text.replace(/\r\n?/g, "\n"));
		range.insertNode(node);
		range.setStartAfter(node);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		el.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

const painters = new WeakMap<OfficeSession, Painter>();
function painterFor(session: OfficeSession): Painter {
	const cached = painters.get(session);
	if (cached) return cached;
	const painter: Painter = session.kind === "docx"
		? { runCss: (rPr) => wordRunCss(session, rPr), sizeCss: (pt) => `${pt}pt` }
		: { runCss: (rPr) => pptRunCss(session, rPr, 1), sizeCss: (pt) => `${(pt * 12700 / session.slideW) * 100}cqw` };
	painters.set(session, painter);
	return painter;
}

// ---------------------------------------------------------------------------
// Paragraph-level changes: alignment and style
// ---------------------------------------------------------------------------

const ALIGNS: Align[] = ["left", "center", "right", "justify"];

function applyAlignClass(el: HTMLElement, align: Align): void {
	for (const a of ALIGNS) el.removeClass(`is-${a}`);
	el.addClass(`is-${align}`);
}

/** Aligns the paragraph an element shows, in the file and on screen. */
export function setAlignment(session: OfficeSession, el: HTMLElement, align: Align): void {
	const binding = session.bindingOf(el);
	if (!binding) return;
	session.checkpoint();
	const doc = binding.node.ownerDocument;
	if (binding.dialect === "w") {
		let pPr = kid(binding.node, W_NS, "pPr");
		if (!pPr) {
			pPr = doc.createElementNS(W_NS, "w:pPr");
			binding.node.insertBefore(pPr, binding.node.firstChild);
		}
		for (const old of kids(pPr, W_NS, "jc")) old.remove();
		const jc = doc.createElementNS(W_NS, "w:jc");
		jc.setAttributeNS(W_NS, "w:val", align === "justify" ? "both" : align);
		insertOrdered(pPr, jc, W_PPR_ORDER);
	} else {
		let pPr = kid(binding.node, A_NS, "pPr");
		if (!pPr) {
			pPr = doc.createElementNS(A_NS, "a:pPr");
			binding.node.insertBefore(pPr, binding.node.firstChild);
		}
		pPr.setAttribute("algn", align === "center" ? "ctr" : align === "right" ? "r" : align === "justify" ? "just" : "l");
	}
	applyAlignClass(el, align);
	session.touch(binding.part);
}

export interface ParagraphStyle { id: string; name: string }

/** The paragraph styles a document offers in its style gallery. */
export function paragraphStyles(session: OfficeSession): ParagraphStyle[] {
	const out: ParagraphStyle[] = [];
	for (const style of deep(session.xml("word/styles.xml"), W_NS, "style")) {
		if (wAttr(style, "type") !== "paragraph") continue;
		const id = wAttr(style, "styleId");
		const name = wVal(kid(style, W_NS, "name")) ?? id;
		if (!id || !name) continue;
		if (!kid(style, W_NS, "qFormat") && !style.hasAttribute("w:default") && wAttr(style, "default") !== "1") continue;
		out.push({ id, name });
	}
	return out;
}

export function currentStyle(session: OfficeSession, el: HTMLElement): string {
	const binding = session.bindingOf(el);
	const pPr = kid(binding?.node, W_NS, "pPr");
	return wVal(kid(pPr, W_NS, "pStyle")) ?? defaultParagraphStyle(session);
}

function defaultParagraphStyle(session: OfficeSession): string {
	for (const style of deep(session.xml("word/styles.xml"), W_NS, "style")) {
		if (wAttr(style, "type") === "paragraph" && wAttr(style, "default") === "1") return wAttr(style, "styleId") ?? "Normal";
	}
	return "Normal";
}

/** Gives the paragraph another style from the document's own list. */
export function setParagraphStyle(session: OfficeSession, el: HTMLElement, styleId: string): void {
	const binding = session.bindingOf(el);
	if (!binding || binding.dialect !== "w") return;
	session.checkpoint();
	const doc = binding.node.ownerDocument;
	let pPr = kid(binding.node, W_NS, "pPr");
	if (!pPr) {
		pPr = doc.createElementNS(W_NS, "w:pPr");
		binding.node.insertBefore(pPr, binding.node.firstChild);
	}
	for (const old of kids(pPr, W_NS, "pStyle")) old.remove();
	if (styleId !== defaultParagraphStyle(session)) {
		const pStyle = doc.createElementNS(W_NS, "w:pStyle");
		pStyle.setAttributeNS(W_NS, "w:val", styleId);
		pPr.insertBefore(pStyle, pPr.firstChild);
	}
	paintWordParagraphLook(session, binding.node, el);
	session.touch(binding.part);
}

// ---------------------------------------------------------------------------
// Word: styles, numbering and the page
// ---------------------------------------------------------------------------

const DOCX = "word/document.xml";
const HIGHLIGHTS: Record<string, string> = {
	yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000",
	darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000",
	darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000", white: "#ffffff"
};

interface WordCache {
	styles: Map<string, Element>;
	defaultsR: Element | null;
	defaultsP: Element | null;
	numbering: Map<string, Element[]> | null;
}
const wordCaches = new WeakMap<OfficeSession, WordCache>();

function wordCache(session: OfficeSession): WordCache {
	const cached = wordCaches.get(session);
	if (cached) return cached;
	const doc = session.xml("word/styles.xml");
	const styles = new Map<string, Element>();
	for (const style of deep(doc, W_NS, "style")) {
		const id = wAttr(style, "styleId");
		if (id) styles.set(id, style);
	}
	const defaults = deep(doc, W_NS, "docDefaults")[0];
	const cache: WordCache = {
		styles,
		defaultsR: kid(kid(defaults, W_NS, "rPrDefault"), W_NS, "rPr"),
		defaultsP: kid(kid(defaults, W_NS, "pPrDefault"), W_NS, "pPr"),
		numbering: null
	};
	wordCaches.set(session, cache);
	return cache;
}

/** A style and the styles it is based on, base first. */
function styleChain(session: OfficeSession, id: string | null): Element[] {
	const { styles } = wordCache(session);
	const chain: Element[] = [];
	const seen = new Set<string>();
	for (let cur = id; cur && !seen.has(cur); ) {
		seen.add(cur);
		const style = styles.get(cur);
		if (!style) break;
		chain.unshift(style);
		cur = wVal(kid(style, W_NS, "basedOn"));
	}
	return chain;
}

/** Later property elements win over earlier ones, by name. */
function mergeProps(list: (Element | null | undefined)[]): Map<string, Element> {
	const map = new Map<string, Element>();
	for (const el of list) for (const child of Array.from(el?.children ?? [])) if (child.namespaceURI === W_NS) map.set(child.localName, child);
	return map;
}

function onProp(el: Element | undefined): boolean {
	if (!el) return false;
	const v = wVal(el);
	return v !== "0" && v !== "false" && v !== "off";
}

/** Colour, size, face and marks of a run; bold, italic and underline are tags of their own. */
function wordRunCss(session: OfficeSession, rPr: Element | null): string {
	const chain = styleChain(session, wVal(kid(rPr, W_NS, "rStyle")));
	const map = mergeProps([...chain.map(s => kid(s, W_NS, "rPr")), rPr]);
	let css = "";
	const color = map.get("color");
	const hex = wVal(color);
	if (hex && hex !== "auto") css += `color:#${hex};`;
	const sz = wNum(map.get("sz"), "val");
	if (sz) css += `font-size:${sz / 2}pt;`;
	const fonts = map.get("rFonts");
	const face = wAttr(fonts, "ascii") ?? wAttr(fonts, "hAnsi");
	if (face) css += `font-family:"${face.replace(/"/g, "")}",system-ui,sans-serif;`;
	const highlight = wVal(map.get("highlight"));
	if (highlight && HIGHLIGHTS[highlight]) css += `background:${HIGHLIGHTS[highlight]};`;
	const shade = wAttr(map.get("shd"), "fill");
	if (shade && shade !== "auto" && !highlight) css += `background:#${shade};`;
	if (onProp(map.get("strike")) || onProp(map.get("dstrike"))) css += "text-decoration:line-through;";
	if (onProp(map.get("caps"))) css += "text-transform:uppercase;";
	if (onProp(map.get("smallCaps"))) css += "font-variant:small-caps;";
	const align = wVal(map.get("vertAlign"));
	if (align === "superscript") css += "vertical-align:super;font-size:0.7em;";
	else if (align === "subscript") css += "vertical-align:sub;font-size:0.7em;";
	const bold = map.get("b");
	if (bold) css += onProp(bold) ? "font-weight:700;" : "font-weight:400;";
	const italic = map.get("i");
	if (italic) css += onProp(italic) ? "font-style:italic;" : "font-style:normal;";
	const underline = wVal(map.get("u"));
	if (underline && underline !== "none" && !css.includes("line-through")) css += "text-decoration:underline;";
	if (map.get("vanish") && onProp(map.get("vanish"))) css += "display:none;";
	return css;
}

/** The look a paragraph gets from its style chain and its own properties. */
function paintWordParagraphLook(session: OfficeSession, p: Element, el: HTMLElement): void {
	const cache = wordCache(session);
	const pPr = kid(p, W_NS, "pPr");
	const styleId = wVal(kid(pPr, W_NS, "pStyle")) ?? defaultParagraphStyle(session);
	const chain = styleChain(session, styleId);
	const pm = mergeProps([cache.defaultsP, ...chain.map(s => kid(s, W_NS, "pPr")), pPr]);
	const rm = mergeProps([cache.defaultsR, ...chain.map(s => kid(s, W_NS, "rPr"))]);
	let css = "";
	const spacing = pm.get("spacing");
	const before = wNum(spacing, "before"), after = wNum(spacing, "after"), line = wNum(spacing, "line");
	// The space around a paragraph belongs to its block: an editable element with a large margin has it counted twice.
	const spaceCss = `margin-top:${(before ?? 0) * TWIP_PX}px;margin-bottom:${(after ?? 0) * TWIP_PX}px;`;
	if (line) {
		const rule = wAttr(spacing, "lineRule");
		css += !rule || rule === "auto" ? `line-height:${(line / 240).toFixed(3)};` : `line-height:${line * TWIP_PX}px;`;
	}
	const ind = pm.get("ind");
	const left = wNum(ind, "left") ?? wNum(ind, "start"), right = wNum(ind, "right") ?? wNum(ind, "end");
	const first = wNum(ind, "firstLine"), hanging = wNum(ind, "hanging");
	if (left) css += `padding-left:${left * TWIP_PX}px;`;
	if (right) css += `padding-right:${right * TWIP_PX}px;`;
	if (first) css += `text-indent:${first * TWIP_PX}px;`;
	if (hanging) css += `text-indent:${-hanging * TWIP_PX}px;`;
	const sz = wNum(rm.get("sz"), "val");
	if (sz) css += `font-size:${sz / 2}pt;`;
	const fonts = rm.get("rFonts");
	const face = wAttr(fonts, "ascii") ?? wAttr(fonts, "hAnsi");
	if (face) css += `font-family:"${face.replace(/"/g, "")}",system-ui,sans-serif;`;
	const color = wVal(rm.get("color"));
	if (color && color !== "auto") css += `color:#${color};`;
	if (onProp(rm.get("b"))) css += "font-weight:700;";
	if (onProp(rm.get("i"))) css += "font-style:italic;";
	if (onProp(rm.get("caps"))) css += "text-transform:uppercase;";
	const underline = wVal(rm.get("u"));
	if (underline && underline !== "none") css += "text-decoration:underline;";
	el.style.cssText = css;
	if (el.parentElement?.hasClass("notelens-office-block")) el.parentElement.style.cssText = spaceCss;
	const jc = wVal(pm.get("jc"));
	applyAlignClass(el, jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" ? "justify" : "left");
	// A document without the standard headings still shows a heading as one.
	for (let level = 1; level <= 6; level++) el.removeClass(`is-h${level}`);
	const outline = wNum(pm.get("outlineLvl"), "val");
	const heading = /^(?:heading|t[ií]tulo|ttulo)\s?([1-6])$/i.exec(styleId);
	if (!cache.styles.has(styleId)) {
		if (heading) el.addClass(`is-h${heading[1]}`);
		else if (/^title$|^t[ií]tulo$/i.test(styleId)) el.addClass("is-h1");
	} else if (outline !== undefined && outline < 6 && !sz) {
		el.addClass(`is-h${outline + 1}`);
	}
	const level = heading ? Number(heading[1]) - 1 : /^title$|^t[ií]tulo$/i.test(styleId) ? 0 : outline !== undefined && outline < 6 ? outline : undefined;
	if (level !== undefined) el.dataset.level = String(level); else delete el.dataset.level;
}

interface PageBox { w: number; h: number; top: number; right: number; bottom: number; left: number; header: number; footer: number }

/** A stretch of the document with its own paper, margins, and headers and footers. */
interface DocSection {
	box: PageBox;
	/** How it starts: "nextPage" (the usual), or "continuous" on the same page. */
	type: string;
	/** A different first page. */
	titlePg: boolean;
	header: { default?: string; first?: string };
	footer: { default?: string; first?: string };
}

function boxOf(sect: Element | null): PageBox {
	const size = kid(sect, W_NS, "pgSz"), margin = kid(sect, W_NS, "pgMar");
	const px = (v: number | undefined, dflt: number) => Math.round((v ?? dflt) * TWIP_PX);
	const landscape = wAttr(size, "orient") === "landscape";
	const w = px(wNum(size, "w"), 11906), h = px(wNum(size, "h"), 16838);
	return {
		w: landscape && w < h ? h : w, h: landscape && w < h ? w : h,
		top: px(wNum(margin, "top"), 1417), right: px(wNum(margin, "right"), 1701),
		bottom: px(wNum(margin, "bottom"), 1417), left: px(wNum(margin, "left"), 1701),
		header: px(wNum(margin, "header"), 708), footer: px(wNum(margin, "footer"), 708)
	};
}

/** Every section of the document in order; the last one is described by the body's own sectPr. */
function documentSections(session: OfficeSession): DocSection[] {
	const body = deep(session.xml(DOCX), W_NS, "body")[0];
	const sects: Element[] = [];
	for (const p of deep(body, W_NS, "p")) {
		const sect = kid(kid(p, W_NS, "pPr"), W_NS, "sectPr");
		if (sect) sects.push(sect);
	}
	const last = kids(body, W_NS, "sectPr")[0];
	if (last || !sects.length) sects.push(last);
	const rels = session.rels(DOCX);
	const out: DocSection[] = [];
	for (const sect of sects) {
		const previous = out[out.length - 1];
		const refs = (name: string) => {
			const found: { default?: string; first?: string } = { ...(previous ? (name === "headerReference" ? previous.header : previous.footer) : {}) };
			for (const ref of kids(sect, W_NS, name)) {
				const type = wAttr(ref, "type") ?? "default";
				const target = rels.find(r => r.id === (ref.getAttributeNS(R_NS, "id") ?? ref.getAttribute("r:id")))?.target;
				if (target && (type === "default" || type === "first")) found[type] = target;
			}
			return found;
		};
		out.push({
			box: boxOf(sect ?? null),
			type: wVal(kid(sect, W_NS, "type")) ?? "nextPage",
			titlePg: !!kid(sect, W_NS, "titlePg"),
			header: refs("headerReference"),
			footer: refs("footerReference")
		});
	}
	return out;
}

/** The paper most of the document is written on: the first section that has margins. */
function pageBox(session: OfficeSession): PageBox {
	const sections = documentSections(session);
	return (sections.find(s => s.box.left + s.box.right > 0) ?? sections[0]).box;
}

// -- numbering --------------------------------------------------------------

function numberingLevels(session: OfficeSession, numId: string): Element[] | null {
	const cache = wordCache(session);
	if (!cache.numbering) {
		const map = new Map<string, Element[]>();
		const doc = session.xml("word/numbering.xml");
		const abstracts = new Map<string, Element>();
		for (const a of deep(doc, W_NS, "abstractNum")) abstracts.set(wAttr(a, "abstractNumId") ?? "", a);
		for (const n of deep(doc, W_NS, "num")) {
			const abstract = abstracts.get(wVal(kid(n, W_NS, "abstractNumId")) ?? "");
			const id = wAttr(n, "numId");
			if (id && abstract) map.set(id, kids(abstract, W_NS, "lvl"));
		}
		cache.numbering = map;
	}
	return cache.numbering.get(numId) ?? null;
}

function formatCounter(n: number, fmt: string): string {
	const letters = (k: number, base: number) => { let s = ""; for (let v = k; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(base + ((v - 1) % 26)) + s; return s; };
	const roman = (k: number) => { const t: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]]; let s = ""; for (const [v, r] of t) while (k >= v) { s += r; k -= v; } return s; };
	if (fmt === "lowerLetter") return letters(n, 97);
	if (fmt === "upperLetter") return letters(n, 65);
	if (fmt === "lowerRoman") return roman(n);
	if (fmt === "upperRoman") return roman(n).toUpperCase();
	if (fmt === "decimalZero") return String(n).padStart(2, "0");
	return String(n);
}

interface ListState { counters: Map<string, number[]>; section: number; part: string; readonly: boolean }

/** The label a numbered paragraph shows, and how far it is indented. */
function listMarker(session: OfficeSession, pPr: Element | null, state: ListState): { marker: string; left?: number; hanging?: number } | null {
	const numPr = kid(pPr, W_NS, "numPr");
	if (!numPr) return null;
	const numId = wVal(kid(numPr, W_NS, "numId")) ?? "";
	if (!numId || numId === "0") return null;
	const level = Number(wVal(kid(numPr, W_NS, "ilvl")) ?? 0);
	const levels = numberingLevels(session, numId);
	const def = levels?.find(l => Number(wAttr(l, "ilvl")) === level);
	const ind = kid(kid(def, W_NS, "pPr"), W_NS, "ind");
	const geometry = { left: wNum(ind, "left"), hanging: wNum(ind, "hanging") };
	if (!def) return { marker: "•", ...geometry };
	const fmt = wVal(kid(def, W_NS, "numFmt")) ?? "decimal";
	const text = wVal(kid(def, W_NS, "lvlText")) ?? "";
	if (fmt === "bullet") {
		const glyph = text.trim();
		const plain = !glyph || /[-]/.test(glyph) ? "•" : glyph === "o" ? "◦" : glyph;
		return { marker: plain, ...geometry };
	}
	const counters = state.counters.get(numId) ?? [];
	const start = Number(wVal(kid(def, W_NS, "start")) ?? 1);
	counters[level] = counters[level] === undefined ? start : counters[level] + 1;
	counters.length = level + 1;
	state.counters.set(numId, counters);
	const label = text.replace(/%(\d)/g, (_, n: string) => {
		const at = Number(n) - 1;
		const levelDef = levels?.find(l => Number(wAttr(l, "ilvl")) === at);
		return formatCounter(counters[at] ?? Number(wVal(kid(levelDef, W_NS, "start")) ?? 1), wVal(kid(levelDef, W_NS, "numFmt")) ?? "decimal");
	});
	return { marker: label || `${counters[level]}.`, ...geometry };
}

// -- painting ---------------------------------------------------------------

/** The paper a document is laid out on, and the way it is broken into pages. */
export interface DocxLayout {
	/** Holds every page; the frame scales this as a whole. */
	deck: HTMLElement;
	naturalWidth: number;
	pageCount(): number;
	/** Moves blocks between pages after an edit, only if something no longer fits. */
	repaginate(): void;
	/** Draws the whole document again from its XML, keeping the caret where it was asked to be. */
	repaint(focus?: { node: Element; offset: number }): void;
}

/** Where a page number in a header or footer goes, until the page is known. */
const PAGE_TOKEN = "PAGE";
const PAGES_TOKEN = "PAGES";

/** Page-number fields are swapped for tokens, so one header can serve every page. */
function tokenizeFields(root: Element): void {
	for (const p of deep(root, W_NS, "p")) {
		let state: "none" | "instr" | "result" = "none";
		let instr = "";
		let token: string | null = null;
		let first = true;
		for (const r of kids(p, W_NS, "r")) {
			const type = wAttr(kid(r, W_NS, "fldChar"), "fldCharType");
			if (type === "begin") { state = "instr"; instr = ""; token = null; continue; }
			if (type === "separate") {
				state = "result";
				const m = /\b(NUMPAGES|PAGE)\b/.exec(instr);
				token = m ? (m[1] === "PAGE" ? PAGE_TOKEN : PAGES_TOKEN) : null;
				first = true;
				continue;
			}
			if (type === "end") { state = "none"; continue; }
			if (state === "instr") { instr += kid(r, W_NS, "instrText")?.textContent ?? ""; continue; }
			if (state === "result" && token) {
				for (const t of kids(r, W_NS, "t")) { t.textContent = first ? token : ""; first = false; }
			}
		}
	}
	for (const field of deep(root, W_NS, "fldSimple")) {
		const m = /\b(NUMPAGES|PAGE)\b/.exec(wAttr(field, "instr") ?? "");
		const t = deep(field, W_NS, "t")[0];
		if (m && t) t.textContent = m[1] === "PAGE" ? PAGE_TOKEN : PAGES_TOKEN;
	}
}

function fillTokens(root: HTMLElement, page: number, pages: number): void {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		const text = n.textContent ?? "";
		if (text.includes("")) n.textContent = text.split(PAGE_TOKEN).join(String(page)).split(PAGES_TOKEN).join(String(pages));
	}
}

/** Pictures that sit behind or in front of the text, positioned on the page and not in the flow of it. */
const anchorsOf = new WeakMap<HTMLElement, HTMLElement[]>();

/** Paints a document as pages: each section with its own paper, margins, headers and footers, plus fonts, styles and lists. */
export function paintDocx(session: OfficeSession, into: HTMLElement): DocxLayout {
	into.empty();
	const sections = documentSections(session);
	const cache = wordCache(session);
	const face = wAttr(kid(cache.defaultsR, W_NS, "rFonts"), "ascii");
	const size = wNum(kid(cache.defaultsR, W_NS, "sz"), "val");
	const font = (face ? `font-family:"${face.replace(/"/g, "")}",Calibri,system-ui,sans-serif;` : "")
		+ (size ? `font-size:${size / 2}pt;` : "");
	const naturalWidth = Math.max(...sections.map(s => s.box.w));
	const deck = into.createDiv({ cls: "notelens-office-deck" });
	deck.setCssProps({ "--deck-w": `${naturalWidth}px` });
	const staging = createDiv();
	interface PageEntry { paper: HTMLElement; body: HTMLElement; header: HTMLElement; footer: HTMLElement; section: number; first: boolean }
	const pages: PageEntry[] = [];
	const templates = new Map<string, HTMLElement>();
	const sectionOf = (index: number): DocSection => sections[Math.min(Math.max(index, 0), sections.length - 1)];
	const bodyHeight = (entry: PageEntry): number => { const b = sectionOf(entry.section).box; return b.h - b.top - b.bottom; };

	const newPage = (): PageEntry => {
		const paper = deck.createDiv({ cls: "notelens-office-paper" });
		paper.style.cssText = font;
		const header = paper.createDiv({ cls: "notelens-office-header" });
		const body = paper.createDiv({ cls: "notelens-office-pagebody" });
		const footer = paper.createDiv({ cls: "notelens-office-footer" });
		const entry: PageEntry = { paper, body, header, footer, section: 0, first: true };
		pages.push(entry);
		return entry;
	};
	/** Gives a page the paper and margins of its section. */
	const configure = (entry: PageEntry, section: number, first: boolean) => {
		const b = sectionOf(section).box;
		entry.section = section;
		entry.first = first;
		entry.paper.setCssProps({ "--page-w": `${b.w}px`, "--page-h": `${b.h}px`, "--body-h": `${b.h - b.top - b.bottom}px` });
		entry.paper.style.padding = `${b.top}px ${b.right}px ${b.bottom}px ${b.left}px`;
		entry.paper.removeClass("is-tall");
	};
	const overflows = (body: HTMLElement) => body.scrollHeight > body.clientHeight + 1;
	const pageAt = (index: number) => pages[index] ?? newPage();

	/** The header or footer of a part, painted once and copied for every page. */
	const bandFor = (part: string, page: number, total: number): HTMLElement | null => {
		let template = templates.get(part);
		if (!template) {
			const source = session.xml(part)?.documentElement;
			if (!source) return null;
			const clone = source.cloneNode(true) as Element;
			tokenizeFields(clone);
			template = createDiv();
			paintWordBlocks(session, clone, template, { counters: new Map(), section: 0, part, readonly: true });
			templates.set(part, template);
		}
		const copy = template.cloneNode(true) as HTMLElement;
		fillTokens(copy, page, total);
		return copy;
	};
	const decorate = (entry: PageEntry, index: number) => {
		const s = sectionOf(entry.section);
		const b = s.box;
		const useFirst = s.titlePg && entry.first;
		const headerPart = useFirst ? s.header.first : s.header.default;
		const footerPart = useFirst ? s.footer.first : s.footer.default;
		entry.header.empty();
		entry.footer.empty();
		const width = `${b.w - b.left - b.right}px`;
		entry.header.style.cssText = `left:${b.left}px;width:${width};top:${b.header}px;`;
		entry.footer.style.cssText = `left:${b.left}px;width:${width};bottom:${b.footer}px;`;
		const head = headerPart ? bandFor(headerPart, index + 1, pages.length) : null;
		const foot = footerPart ? bandFor(footerPart, index + 1, pages.length) : null;
		if (head) entry.header.append(...Array.from(head.childNodes));
		if (foot) entry.footer.append(...Array.from(foot.childNodes));
	};
	/** Puts a floating picture where the document says, on the paper of the page its paragraph landed on. */
	const placeAnchor = (img: HTMLElement, entry: PageEntry, block: HTMLElement) => {
		const b = sectionOf(entry.section).box;
		const width = Number(img.dataset.w), height = Number(img.dataset.h);
		const pageRelativeH = img.dataset.hFrom === "page";
		const refLeft = pageRelativeH ? 0 : b.left, refWidth = pageRelativeH ? b.w : b.w - b.left - b.right;
		const hAlign = img.dataset.hAlign;
		const left = hAlign === "center" ? refLeft + (refWidth - width) / 2 : hAlign === "right" ? refLeft + refWidth - width : refLeft + Number(img.dataset.hOff ?? 0);
		const vFrom = img.dataset.vFrom;
		const refTop = vFrom === "page" ? 0 : vFrom === "margin" || vFrom === "topMargin" ? b.top : entry.body.offsetTop + block.offsetTop;
		const refHeight = vFrom === "page" ? b.h : b.h - b.top - b.bottom;
		const vAlign = img.dataset.vAlign;
		const top = vAlign === "center" ? refTop + (refHeight - height) / 2 : vAlign === "bottom" ? refTop + refHeight - height : refTop + Number(img.dataset.vOff ?? 0);
		img.style.left = `${left}px`;
		img.style.top = `${top}px`;
		entry.paper.appendChild(img);
	};

	const distribute = (blocks: HTMLElement[]) => {
		for (const stale of Array.from(deck.querySelectorAll(".notelens-office-anchor"))) stale.remove();
		let index = 0;
		let currentSection = Number(blocks[0]?.dataset.section ?? 0);
		let page = pageAt(0);
		configure(page, currentSection, true);
		let afterBreak = false;
		const next = (first: boolean) => {
			page = pageAt(++index);
			configure(page, currentSection, first);
		};
		for (const block of blocks) {
			const section = Number(block.dataset.section ?? currentSection);
			if (section !== currentSection) {
				currentSection = section;
				// A new section starts on a fresh page unless it says it is continuous.
				if (sectionOf(section).type !== "continuous" && page.body.childElementCount > 0) next(true);
				else if (page.body.childElementCount === 0) configure(page, currentSection, true);
			}
			if ((block.dataset.breakBefore === "1" || afterBreak) && page.body.childElementCount > 0) next(false);
			page.body.appendChild(block);
			if (overflows(page.body) && page.body.childElementCount > 1) {
				next(false);
				page.body.appendChild(block);
			}
			afterBreak = block.hasClass("is-pagebreak");
		}
		while (pages.length > index + 1) pages.pop()?.paper.remove();
		pages.forEach((entry, i) => {
			entry.paper.dataset.page = `${i + 1} / ${pages.length}`;
			// A block taller than a page still has to be shown whole.
			if (overflows(entry.body)) entry.paper.addClass("is-tall");
			decorate(entry, i);
			for (const block of Array.from(entry.body.children) as HTMLElement[]) {
				for (const img of anchorsOf.get(block) ?? []) placeAnchor(img, entry, block);
			}
		});
	};

	const build = (): HTMLElement[] => {
		staging.empty();
		const body = deep(session.xml(DOCX), W_NS, "body")[0];
		if (body) paintWordBlocks(session, body, staging, { counters: new Map(), section: 0, part: DOCX, readonly: false });
		return Array.from(staging.children) as HTMLElement[];
	};

	const layout: DocxLayout = {
		deck,
		naturalWidth,
		pageCount: () => pages.length,
		repaginate() {
			// Cheap test first: moving blocks costs the selection, so only do it when a page is over-full or has room for the next block.
			let needed = false;
			for (let i = 0; i < pages.length && !needed; i++) {
				const entry = pages[i];
				if (entry.paper.hasClass("is-tall") ? entry.body.childElementCount > 1 : overflows(entry.body)) needed = true;
				const following = pages[i + 1]?.body.firstElementChild as HTMLElement | undefined;
				if (!needed && following && following.dataset.breakBefore !== "1" && Number(following.dataset.section ?? 0) === entry.section
					&& !entry.body.lastElementChild?.classList.contains("is-pagebreak")) {
					const last = entry.body.lastElementChild as HTMLElement | null;
					const used = last ? last.offsetTop + last.offsetHeight : 0;
					const lead = parseFloat(following.querySelector<HTMLElement>("p")?.style.marginTop ?? "0") || 0;
					if (used + following.offsetHeight + lead + 4 <= bodyHeight(entry)) needed = true;
				}
			}
			if (!needed) return;
			const saved = saveSelection(deck);
			const blocks = pages.flatMap(entry => Array.from(entry.body.children) as HTMLElement[]);
			for (const block of blocks) block.remove();
			distribute(blocks);
			restoreSelection(saved);
		},
		repaint(focus) {
			session.commit();
			const blocks = build();
			for (const entry of pages) entry.body.empty();
			distribute(blocks);
			if (focus) focusParagraph(session, focus.node, focus.offset);
		}
	};
	distribute(build());
	return layout;
}

interface SavedSelection { el: HTMLElement; start: number; end: number }

function saveSelection(root: HTMLElement): SavedSelection | null {
	const selection = root.ownerDocument.defaultView?.getSelection();
	if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return null;
	const anchor = selection.anchorNode;
	const el = (anchor?.instanceOf(HTMLElement) ? anchor : anchor?.parentElement)?.closest<HTMLElement>("[contenteditable='true']");
	if (!el) return null;
	const range = selection.getRangeAt(0);
	if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
	return { el, start: offsetIn(el, range.startContainer, range.startOffset), end: offsetIn(el, range.endContainer, range.endOffset) };
}

function restoreSelection(saved: SavedSelection | null): void {
	if (!saved) return;
	saved.el.focus({ preventScroll: true });
	placeCaret(saved.el, saved.start, saved.end);
}

function paintWordBlocks(session: OfficeSession, parent: Element, into: HTMLElement, list: ListState): void {
	for (const child of Array.from(parent.children)) {
		if (child.namespaceURI !== W_NS) continue;
		if (child.localName === "p") paintWordParagraph(session, child, into, list);
		else if (child.localName === "sdt") {
			const content = kid(child, W_NS, "sdtContent");
			if (content) paintWordBlocks(session, content, into, list);
		} else if (child.localName === "tbl") {
			paintWordTable(session, child, into, list);
			const block = into.lastElementChild as HTMLElement | null;
			if (block) block.dataset.section = String(list.section);
		}
	}
}

function paintWordTable(session: OfficeSession, tbl: Element, into: HTMLElement, list: ListState): void {
	const tblPr = kid(tbl, W_NS, "tblPr");
	const borders = kid(tblPr, W_NS, "tblBorders");
	const drawn = Array.from(borders?.children ?? []).some(b => !["nil", "none"].includes(wVal(b) ?? "nil"));
	const wrap = into.createDiv({ cls: "notelens-office-block is-table" });
	const table = wrap.createEl("table", { cls: "notelens-office-table" });
	if (drawn) table.addClass("has-borders");
	const widths = kids(kid(tbl, W_NS, "tblGrid"), W_NS, "gridCol").map(c => (wNum(c, "w") ?? 0) * TWIP_PX);
	const total = widths.reduce((a, b) => a + b, 0);
	if (total > 0) {
		table.style.width = `${Math.round(total)}px`;
		const group = table.createEl("colgroup");
		for (const w of widths) group.createEl("col").style.width = `${Math.round(w)}px`;
	}
	for (const row of kids(tbl, W_NS, "tr")) {
		const line = table.createEl("tr");
		const height = wNum(kid(kid(row, W_NS, "trPr"), W_NS, "trHeight"), "val");
		if (height) line.style.height = `${Math.round(height * TWIP_PX)}px`;
		for (const cell of kids(row, W_NS, "tc")) {
			const tcPr = kid(cell, W_NS, "tcPr");
			const td = line.createEl("td");
			const span = Number(wVal(kid(tcPr, W_NS, "gridSpan")) ?? 1);
			if (span > 1) td.colSpan = span;
			const shade = wAttr(kid(tcPr, W_NS, "shd"), "fill");
			if (shade && shade !== "auto") td.style.background = `#${shade}`;
			paintWordBlocks(session, cell, td, list);
		}
	}
}

function hasPageBreak(p: Element): boolean {
	return deep(p, W_NS, "br").some(b => wAttr(b, "type") === "page");
}

/** Fields, tracked changes, content controls and mid-text page breaks are shown but not rewritten. */
function wordParagraphLocked(p: Element): boolean {
	return ["fldChar", "fldSimple", "instrText", "ins", "del", "sdt", "moveFrom", "moveTo", "commentRangeStart", "footnoteReference", "endnoteReference", "commentReference"]
		.some(name => deep(p, W_NS, name).length > 0) || hasPageBreak(p);
}

/** What paints a paragraph: its section is remembered, and a paragraph that ends a section starts the next one. */
function paintWordParagraph(session: OfficeSession, p: Element, into: HTMLElement, list: ListState): void {
	const before = into.lastElementChild;
	paintWordParagraphBody(session, p, into, list);
	const block = into.lastElementChild as HTMLElement | null;
	if (block && block !== before) block.dataset.section = String(list.section);
	if (kid(kid(p, W_NS, "pPr"), W_NS, "sectPr")) list.section++;
}

function paintWordParagraphBody(session: OfficeSession, p: Element, into: HTMLElement, list: ListState): void {
	const pPr = kid(p, W_NS, "pPr");
	const wrap = into.createDiv({ cls: "notelens-office-block" });
	if (onProp(kid(pPr, W_NS, "pageBreakBefore") ?? undefined)) wrap.dataset.breakBefore = "1";
	const text = deep(p, W_NS, "t").map(t => t.textContent ?? "").join("").trim();
	if (hasPageBreak(p) && !text) {
		wrap.addClass("is-pagebreak");
		wrap.createDiv({ cls: "notelens-office-breakline", text: tr("Salto de página") });
		return;
	}
	// Pictures: a floating one behind or in front of the text is placed on the page; the others sit above the paragraph that holds them.
	const rels = session.rels(list.part);
	for (const blip of deep(p, A_NS, "blip")) {
		const rid = blip.getAttributeNS(R_NS, "embed") ?? blip.getAttribute("r:embed");
		const target = rid ? rels.find(r => r.id === rid)?.target : undefined;
		const url = target ? session.media(target) : null;
		if (!url) continue;
		let drawing: Element | null = blip;
		while (drawing && drawing.localName !== "anchor" && drawing.localName !== "inline" && drawing.localName !== "drawing") drawing = drawing.parentElement;
		const extent = kid(drawing, WP_NS, "extent") ?? deep(drawing, WP_NS, "extent")[0];
		const cx = num(extent, "cx"), cy = num(extent, "cy");
		if (drawing?.localName === "anchor" && kid(drawing, WP_NS, "wrapNone") && cx && cy) {
			const img = createEl("img", { cls: "notelens-office-anchor" });
			img.src = url;
			img.alt = "";
			img.classList.toggle("is-behind", drawing.getAttribute("behindDoc") === "1");
			const w = Math.round(cx / EMU_PER_PX), h = Math.round(cy / EMU_PER_PX);
			img.style.width = `${w}px`;
			img.style.height = `${h}px`;
			const horizontal = kid(drawing, WP_NS, "positionH"), vertical = kid(drawing, WP_NS, "positionV");
			Object.assign(img.dataset, {
				w: String(w), h: String(h), hFrom: horizontal?.getAttribute("relativeFrom") ?? "margin", vFrom: vertical?.getAttribute("relativeFrom") ?? "paragraph",
				hOff: String(Math.round(Number(kid(horizontal, WP_NS, "posOffset")?.textContent ?? 0) / EMU_PER_PX)),
				vOff: String(Math.round(Number(kid(vertical, WP_NS, "posOffset")?.textContent ?? 0) / EMU_PER_PX))
			});
			const hAlign = kid(horizontal, WP_NS, "align")?.textContent, vAlign = kid(vertical, WP_NS, "align")?.textContent;
			if (hAlign) img.dataset.hAlign = hAlign;
			if (vAlign) img.dataset.vAlign = vAlign;
			anchorsOf.set(wrap, [...(anchorsOf.get(wrap) ?? []), img]);
			continue;
		}
		const img = wrap.createEl("img", { cls: "notelens-office-image" });
		img.src = url;
		img.alt = "";
		if (!list.readonly) {
			img.tabIndex = 0;
			img.addEventListener("keydown", (event) => {
				event.stopPropagation();
				if (event.key !== "Delete" && event.key !== "Backspace") return;
				event.preventDefault();
				session.checkpoint();
				const next = p.nextElementSibling;
				p.remove();
				session.touch(DOCX);
				session.onStructure?.(next && next.localName === "p" ? { node: next, offset: 0 } : undefined);
			});
		}
		if (cx) img.style.width = `${Math.round(cx / EMU_PER_PX)}px`;
	}
	// Text in a text box: shown where the paragraph is; the fallback copy Word stores beside it is left out.
	for (const box of deep(p, W_NS, "txbxContent")) {
		if (ancestorNamed(box, "http://schemas.openxmlformats.org/markup-compatibility/2006", "Fallback")) continue;
		if (!(box.textContent ?? "").trim()) continue;
		const holder = wrap.createDiv({ cls: "notelens-office-textbox" });
		paintWordBlocks(session, box, holder, { counters: new Map(), section: list.section, part: list.part, readonly: true });
	}
	const el = wrap.createEl("p", { cls: "notelens-office-para" });
	const table: Element[] = [];
	const segments = readWordRuns(p, table);
	paintSegments(el, segments, table, painterFor(session));
	paintWordParagraphLook(session, p, el);
	const marker = listMarker(session, pPr, list);
	if (marker) {
		el.addClass("is-list");
		el.dataset.marker = marker.marker;
		if (marker.left) el.style.paddingLeft = `${Math.round(marker.left * TWIP_PX)}px`;
		if (marker.hanging) el.style.textIndent = `${-Math.round(marker.hanging * TWIP_PX)}px`;
	}
	if (!segments.length) el.addClass("is-empty");
	if (list.readonly || wordParagraphLocked(p)) {
		el.addClass("is-locked");
		return;
	}
	el.contentEditable = "true";
	el.spellcheck = true;
	tameEditable(el, {
		enter: () => splitParagraph(session, el),
		backspaceStart: () => mergeWithPrevious(session, el)
	});
	session.bind(el, p, DOCX, "w");
}

// ---------------------------------------------------------------------------
// PowerPoint: one slide at a time, at the size it is shown
// ---------------------------------------------------------------------------

interface Frame { x: number; y: number; cx: number; cy: number; rot?: number; flipH?: boolean; flipV?: boolean }
interface Transform { ox: number; oy: number; sx: number; sy: number }
interface SlideCtx {
	session: OfficeSession;
	part: string;
	layout: Document | null;
	master: Document | null;
	into: HTMLElement;
	readonly: boolean;
	/** Objects of the slide being edited: the only ones that can be selected and moved. */
	interactive: boolean;
	/** Painting what the layout and the master put behind the slide. */
	decor?: boolean;
}

export function slideTitle(session: OfficeSession, index: number): string {
	const part = session.slides[index];
	const doc = part ? session.xml(part) : null;
	for (const sp of deep(doc, P_NS, "sp")) {
		const ph = deep(sp, P_NS, "ph")[0];
		if (ph && /title/i.test(ph.getAttribute("type") ?? "")) {
			const text = deep(sp, A_NS, "t").map(t => t.textContent ?? "").join(" ").trim();
			if (text) return text;
		}
	}
	const first = deep(doc, A_NS, "t").map(t => t.textContent ?? "").join(" ").trim();
	return first.slice(0, 60) || tr("Diapositiva {p0}", { p0: index + 1 });
}

/** A slide drawn into an element; a read-only copy is what the thumbnails show. */
export function paintSlide(session: OfficeSession, index: number, into: HTMLElement, readonly = false): void {
	into.empty();
	const part = session.slides[index];
	const doc = part ? session.xml(part) : null;
	if (!part || !doc) return;
	const rels = session.rels(part);
	const layoutPart = rels.find(r => r.type.endsWith("/slideLayout"))?.target;
	const layout = layoutPart ? session.xml(layoutPart) : null;
	const masterPart = layoutPart ? session.rels(layoutPart).find(r => r.type.endsWith("/slideMaster"))?.target : undefined;
	const master = masterPart ? session.xml(masterPart) : null;

	const stage = into.createDiv({ cls: "notelens-slide" });
	stage.style.aspectRatio = `${session.slideW} / ${session.slideH}`;
	stage.style.background = backgroundCss(session, doc, part) ?? backgroundCss(session, layout, layoutPart) ?? backgroundCss(session, master, masterPart) ?? session.color("bg1") ?? "#ffffff";
	stage.style.color = session.color("tx1") ?? "#000000";
	const minor = session.font("minor");
	if (minor && !minor.startsWith("+")) stage.style.fontFamily = `"${minor}",system-ui,sans-serif`;
	if (readonly) stage.addClass("is-readonly");
	stage.dataset.transition = readTransition(session, index).kind;
	const ctx: SlideCtx = { session, part, layout, master, into: stage, readonly, interactive: !readonly };
	// What the master and the layout draw sits behind the slide's own objects.
	const showLayout = doc.documentElement.getAttribute("showMasterSp") !== "0";
	const showMaster = showLayout && layout?.documentElement.getAttribute("showMasterSp") !== "0";
	const identity = { ox: 0, oy: 0, sx: 1, sy: 1 };
	const decor = (source: Document | null, owner: string | undefined) => {
		const backTree = deep(source, P_NS, "spTree")[0];
		if (backTree && owner) paintTree({ ...ctx, part: owner, readonly: true, interactive: false, decor: true }, backTree, identity);
	};
	if (showMaster) decor(master, masterPart);
	if (showLayout) decor(layout, layoutPart);
	const tree = deep(doc, P_NS, "spTree")[0];
	if (tree) paintTree(ctx, tree, identity);
}

// -- colour: theme references, and the changes a deck makes to them --------

const PRESET_COLORS: Record<string, string> = {
	black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", lime: "00FF00", blue: "0000FF", yellow: "FFFF00", cyan: "00FFFF", magenta: "FF00FF",
	gray: "808080", grey: "808080", silver: "C0C0C0", orange: "FFA500", purple: "800080", navy: "000080", maroon: "800000", teal: "008080", olive: "808000",
	dkGray: "A9A9A9", ltGray: "D3D3D3", dkBlue: "00008B", dkRed: "8B0000", dkGreen: "006400"
};

function rgbOfHex(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function hexOfRgb(r: number, g: number, b: number): string {
	return `#${[r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	const rr = r / 255, gg = g / 255, bb = b / 255;
	const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
	return [h / 6, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	if (s === 0) return [l * 255, l * 255, l * 255];
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const hue = (t: number) => { const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
	return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

/** A colour element as CSS: its base colour with lumMod, lumOff, tint, shade, alpha and the rest applied in order. */
function resolveColor(session: OfficeSession, c: Element, phClr: string | null = null): string | null {
	const val = c.getAttribute("val");
	let base: string | null = null;
	if (c.localName === "srgbClr") base = val ? `#${val}` : null;
	else if (c.localName === "schemeClr") base = val === "phClr" ? phClr : val ? session.color(val) : null;
	else if (c.localName === "sysClr") base = c.getAttribute("lastClr") ? `#${c.getAttribute("lastClr")}` : val === "window" ? "#ffffff" : "#000000";
	else if (c.localName === "prstClr") base = val && PRESET_COLORS[val] ? `#${PRESET_COLORS[val]}` : null;
	else if (c.localName === "hslClr") {
		const [r, g, b] = hslToRgb((num(c, "hue") ?? 0) / 21600000, (num(c, "sat") ?? 0) / 100000, (num(c, "lum") ?? 0) / 100000);
		base = hexOfRgb(r, g, b);
	} else if (c.localName === "scrgbClr") {
		base = hexOfRgb(((num(c, "r") ?? 0) / 100000) * 255, ((num(c, "g") ?? 0) / 100000) * 255, ((num(c, "b") ?? 0) / 100000) * 255);
	}
	if (!base || !/^#[0-9a-f]{6}$/i.test(base)) return base;
	let [r, g, b] = rgbOfHex(base);
	let alpha = 1;
	for (const t of Array.from(c.children)) {
		const f = (num(t, "val") ?? 0) / 100000;
		const name = t.localName;
		if (name === "alpha") alpha = f;
		else if (name === "alphaMod") alpha *= f;
		else if (name === "alphaOff") alpha += f;
		else if (name === "lumMod" || name === "lumOff" || name === "satMod" || name === "satOff") {
			const [h, s0, l0] = rgbToHsl(r, g, b);
			let s = s0, l = l0;
			if (name === "lumMod") l *= f; else if (name === "lumOff") l += f;
			else if (name === "satMod") s *= f; else s += f;
			[r, g, b] = hslToRgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
		} else if (name === "tint") { r = 255 - (255 - r) * f; g = 255 - (255 - g) * f; b = 255 - (255 - b) * f; }
		else if (name === "shade") { r *= f; g *= f; b *= f; }
	}
	alpha = Math.max(0, Math.min(1, alpha));
	return alpha < 1 ? `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha.toFixed(3)})` : hexOfRgb(r, g, b);
}

function colorOf(session: OfficeSession, fill: Element | null | undefined, phClr: string | null = null): string | null {
	const c = fill?.firstElementChild;
	return c ? resolveColor(session, c, phClr) : null;
}

/** A gradient fill as a CSS gradient. */
function gradientCss(session: OfficeSession, grad: Element, phClr: string | null): string | null {
	const stops = kids(kid(grad, A_NS, "gsLst"), A_NS, "gs").map(gs => {
		const color = gs.firstElementChild ? resolveColor(session, gs.firstElementChild, phClr) : null;
		return color ? `${color} ${(num(gs, "pos") ?? 0) / 1000}%` : null;
	}).filter((s): s is string => !!s);
	if (!stops.length) return null;
	if (stops.length === 1) return stops[0].replace(/ [\d.]+%$/, "");
	const lin = kid(grad, A_NS, "lin");
	const path = kid(grad, A_NS, "path");
	if (path) return `radial-gradient(${path.getAttribute("path") === "rect" ? "closest-side" : "circle"} at 50% 50%, ${stops.join(", ")})`;
	const angle = ((num(lin, "ang") ?? 0) / 60000 + 90) % 360;
	return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
}

/** What paints a shape or a cell: a colour, a gradient, a picture or nothing at all. Null when the properties say nothing. */
function fillCss(session: OfficeSession, props: Element | null | undefined, part: string, phClr: string | null = null): string | null {
	for (const child of Array.from(props?.children ?? [])) {
		if (child.namespaceURI !== A_NS) continue;
		if (child.localName === "noFill") return "transparent";
		if (child.localName === "solidFill") return colorOf(session, child, phClr);
		if (child.localName === "gradFill") return gradientCss(session, child, phClr);
		if (child.localName === "pattFill") return colorOf(session, kid(child, A_NS, "fgClr"), phClr);
		if (child.localName === "blipFill") {
			const blip = kid(child, A_NS, "blip");
			const rid = blip?.getAttributeNS(R_NS, "embed") ?? blip?.getAttribute("r:embed");
			const target = rid ? session.rels(part).find(r => r.id === rid)?.target : undefined;
			const url = target ? session.media(target) : null;
			return url ? `url("${url}") center / cover no-repeat` : null;
		}
	}
	return null;
}

/** The background a slide, its layout or its master declares. */
function backgroundCss(session: OfficeSession, doc: Document | null, part: string | undefined): string | null {
	const bgPr = kid(deep(doc, P_NS, "bg")[0], P_NS, "bgPr");
	return bgPr && part ? fillCss(session, bgPr, part) : null;
}

interface LineLook { color: string; width: number; dash: string; head: string; tail: string }

/** The outline of a shape: its own, or the one its theme style refers to. Null when there is none. */
function lineLook(session: OfficeSession, spPr: Element | null, style: Element | null): LineLook | null {
	const ln = kid(spPr, A_NS, "ln");
	const ref = kid(style, A_NS, "lnRef");
	const refColor = ref && (num(ref, "idx") ?? 0) > 0 ? colorOf(session, ref) : null;
	if (kid(ln, A_NS, "noFill")) return null;
	const own = ln ? colorOf(session, kid(ln, A_NS, "solidFill"), refColor) : null;
	const gradient = ln && kid(ln, A_NS, "gradFill") ? gradientCss(session, kid(ln, A_NS, "gradFill") as Element, refColor) : null;
	const color = own ?? (gradient ? gradient.match(/(#[0-9a-f]{6}|rgba?\([^)]*\))/i)?.[0] ?? null : null) ?? refColor;
	if (!color) return null;
	const dash = kid(ln, A_NS, "prstDash")?.getAttribute("val") ?? "solid";
	return {
		color,
		width: num(ln, "w") ?? (ref ? 12700 : 9525),
		dash: dash.includes("dot") || dash === "sysDot" ? "dotted" : dash.toLowerCase().includes("dash") ? "dashed" : "solid",
		head: kid(ln, A_NS, "headEnd")?.getAttribute("type") ?? "none",
		tail: kid(ln, A_NS, "tailEnd")?.getAttribute("type") ?? "none"
	};
}

function cqw(session: OfficeSession, emu: number): string {
	return `${(emu / session.slideW) * 100}cqw`;
}

function pptRunCss(session: OfficeSession, rPr: Element | null, scale: number): string {
	if (!rPr) return "";
	let css = "";
	const sz = num(rPr, "sz");
	if (sz) css += `font-size:${(sz * scale / 100 * 12700 / session.slideW) * 100}cqw;`;
	const color = colorOf(session, kid(rPr, A_NS, "solidFill"));
	if (color) css += `color:${color};`;
	const face = kid(rPr, A_NS, "latin")?.getAttribute("typeface");
	if (face && !face.startsWith("+")) css += `font-family:"${face.replace(/"/g, "")}",system-ui,sans-serif;`;
	const hl = colorOf(session, kid(rPr, A_NS, "highlight"));
	if (hl) css += `background:${hl};`;
	if ((rPr.getAttribute("strike") ?? "noStrike") !== "noStrike") css += "text-decoration:line-through;";
	const base = num(rPr, "baseline");
	if (base) css += `vertical-align:${base > 0 ? "super" : "sub"};font-size:0.7em;`;
	if (rPr.getAttribute("cap") === "all") css += "text-transform:uppercase;";
	const spacing = num(rPr, "spc");
	if (spacing) css += `letter-spacing:${(spacing / 100 * 12700 / session.slideW) * 100}cqw;`;
	return css;
}

function frameOf(xfrm: Element | null): Frame | null {
	if (!xfrm) return null;
	const off = kid(xfrm, A_NS, "off"), ext = kid(xfrm, A_NS, "ext");
	const x = num(off, "x"), y = num(off, "y"), cx = num(ext, "cx"), cy = num(ext, "cy");
	if (x === undefined || y === undefined || cx === undefined || cy === undefined) return null;
	const rot = num(xfrm, "rot");
	return { x, y, cx, cy, rot: rot ? rot / 60000 : undefined, flipH: xfrm.getAttribute("flipH") === "1", flipV: xfrm.getAttribute("flipV") === "1" };
}

function shapeXfrm(shape: Element): Element | null {
	if (shape.localName === "graphicFrame") return kid(shape, P_NS, "xfrm");
	if (shape.localName === "grpSp") return kid(kid(shape, P_NS, "grpSpPr"), A_NS, "xfrm");
	return kid(kid(shape, P_NS, "spPr"), A_NS, "xfrm");
}

function normType(type: string | null): string {
	if (!type || type === "obj" || type === "subTitle" || type === "body") return "body";
	if (type === "ctrTitle" || type === "title") return "title";
	return type;
}

/** The placeholder of a layout or master that a slide's shape stands on. */
function findPlaceholder(doc: Document | null, ph: Element): Element | null {
	const idx = ph.getAttribute("idx");
	const type = normType(ph.getAttribute("type"));
	const candidates = deep(doc, P_NS, "sp").filter(sp => deep(sp, P_NS, "ph").length > 0);
	const byIdx = idx !== null ? candidates.find(sp => deep(sp, P_NS, "ph")[0]?.getAttribute("idx") === idx) : undefined;
	return byIdx ?? candidates.find(sp => normType(deep(sp, P_NS, "ph")[0]?.getAttribute("type") ?? null) === type) ?? null;
}

function paintTree(ctx: SlideCtx, tree: Element, tf: Transform): void {
	for (const shape of Array.from(tree.children)) {
		if (shape.namespaceURI !== P_NS) continue;
		if (shape.localName === "grpSp") {
			const xfrm = shapeXfrm(shape);
			const off = kid(xfrm, A_NS, "off"), ext = kid(xfrm, A_NS, "ext");
			const chOff = kid(xfrm, A_NS, "chOff"), chExt = kid(xfrm, A_NS, "chExt");
			const kx = (num(ext, "cx") ?? 1) / (num(chExt, "cx") || 1);
			const ky = (num(ext, "cy") ?? 1) / (num(chExt, "cy") || 1);
			paintTree({ ...ctx, interactive: false }, shape, {
				ox: tf.ox + tf.sx * ((num(off, "x") ?? 0) - (num(chOff, "x") ?? 0) * kx),
				oy: tf.oy + tf.sy * ((num(off, "y") ?? 0) - (num(chOff, "y") ?? 0) * ky),
				sx: tf.sx * kx, sy: tf.sy * ky
			});
		} else if (shape.localName === "sp") paintShape(ctx, shape, tf);
		else if (shape.localName === "cxnSp") paintLine(ctx, kid(shape, P_NS, "spPr"), kid(shape, P_NS, "style"), frameOf(shapeXfrm(shape)), tf);
		else if (shape.localName === "pic") paintPicture(ctx, shape, tf);
		else if (shape.localName === "graphicFrame") paintGraphicFrame(ctx, shape, tf);
	}
}

function place(ctx: SlideCtx, el: HTMLElement, f: Frame, tf: Transform): void {
	const { slideW, slideH } = ctx.session;
	el.style.left = `${((tf.ox + tf.sx * f.x) / slideW) * 100}%`;
	el.style.top = `${((tf.oy + tf.sy * f.y) / slideH) * 100}%`;
	el.style.width = `${(tf.sx * f.cx / slideW) * 100}%`;
	el.style.height = `${(tf.sy * f.cy / slideH) * 100}%`;
	const transform = `${f.rot ? `rotate(${f.rot}deg) ` : ""}${f.flipH ? "scaleX(-1) " : ""}${f.flipV ? "scaleY(-1)" : ""}`.trim();
	if (transform) el.style.transform = transform;
}

/** Font size in hundredths of a point, as a fraction of the slide's width. */
function sizeCss(ctx: SlideCtx, hundredths: number): string {
	return `${(hundredths / 100 * 12700 / ctx.session.slideW) * 100}cqw`;
}

/** A straight line between two corners of a frame, drawn as a thin rotated bar. Elbows and curves are drawn straight. */
function paintLine(ctx: SlideCtx, spPr: Element | null, style: Element | null, f: Frame | null, tf: Transform): void {
	if (!f) return;
	const look = lineLook(ctx.session, spPr, style);
	if (!look) return;
	const { slideW, slideH } = ctx.session;
	const x1 = tf.ox + tf.sx * (f.x + (f.flipH ? f.cx : 0)), y1 = tf.oy + tf.sy * (f.y + (f.flipV ? f.cy : 0));
	const x2 = tf.ox + tf.sx * (f.x + (f.flipH ? 0 : f.cx)), y2 = tf.oy + tf.sy * (f.y + (f.flipV ? 0 : f.cy));
	const dx = x2 - x1, dy = y2 - y1;
	const width = Math.max(look.width, 6350);
	const bar = ctx.into.createDiv({ cls: "notelens-slide-line" });
	bar.style.left = `${(x1 / slideW) * 100}%`;
	bar.style.top = `${(y1 / slideH) * 100}%`;
	bar.style.width = `${(Math.hypot(dx, dy) / slideW) * 100}%`;
	bar.style.borderTop = `${cqw(ctx.session, width)} ${look.dash} ${look.color}`;
	bar.style.color = look.color;
	bar.style.fontSize = cqw(ctx.session, width * 4);
	bar.style.marginTop = `-${cqw(ctx.session, width / 2)}`;
	bar.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
	if (look.tail !== "none") bar.addClass("has-tail");
	if (look.head !== "none") bar.addClass("has-head");
}

/** A freeform shape as an SVG path: lines, curves and arcs in the shape's own coordinates. */
function drawFreeform(into: HTMLElement, custGeom: Element, frame: Frame, fill: string | null, look: LineLook | null, session: OfficeSession): void {
	const paths = kids(kid(custGeom, A_NS, "pathLst"), A_NS, "path");
	if (!paths.length) return;
	const w0 = num(paths[0], "w") || frame.cx, h0 = num(paths[0], "h") || frame.cy;
	const svg = into.createSvg("svg", { cls: "notelens-slide-geom", attr: { viewBox: `0 0 ${w0} ${h0}`, preserveAspectRatio: "none" } });
	for (const path of paths) {
		const sx = w0 / (num(path, "w") || w0), sy = h0 / (num(path, "h") || h0);
		const point = (el: Element | null | undefined): [number, number] => [(num(el, "x") ?? 0) * sx, (num(el, "y") ?? 0) * sy];
		let d = "";
		let cur: [number, number] = [0, 0];
		for (const cmd of Array.from(path.children)) {
			const pts = kids(cmd, A_NS, "pt").map(point);
			if (cmd.localName === "moveTo" && pts[0]) { cur = pts[0]; d += `M${cur[0]} ${cur[1]} `; }
			else if (cmd.localName === "lnTo" && pts[0]) { cur = pts[0]; d += `L${cur[0]} ${cur[1]} `; }
			else if (cmd.localName === "cubicBezTo" && pts.length === 3) { d += `C${pts.map(p => p.join(" ")).join(",")} `; cur = pts[2]; }
			else if (cmd.localName === "quadBezTo" && pts.length === 2) { d += `Q${pts.map(p => p.join(" ")).join(",")} `; cur = pts[1]; }
			else if (cmd.localName === "arcTo") {
				const wR = (num(cmd, "wR") ?? 0) * sx, hR = (num(cmd, "hR") ?? 0) * sy;
				const st = ((num(cmd, "stAng") ?? 0) / 60000) * Math.PI / 180, sw = ((num(cmd, "swAng") ?? 0) / 60000) * Math.PI / 180;
				const ex = cur[0] - wR * Math.cos(st) + wR * Math.cos(st + sw), ey = cur[1] - hR * Math.sin(st) + hR * Math.sin(st + sw);
				d += `A${wR} ${hR} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${ex} ${ey} `;
				cur = [ex, ey];
			} else if (cmd.localName === "close") d += "Z ";
		}
		const stroked = path.getAttribute("stroke") !== "0" && !!look;
		const filled = path.getAttribute("fill") !== "none" && !!fill && fill !== "transparent";
		const shape = svg.createSvg("path", { attr: { d: d.trim() } });
		shape.setAttribute("fill", filled ? (fill?.startsWith("url(") || fill?.includes("gradient") ? (fill.match(/(#[0-9a-f]{6}|rgba?\([^)]*\))/i)?.[0] ?? "none") : fill ?? "none") : "none");
		if (stroked && look) {
			shape.setAttribute("stroke", look.color);
			shape.setAttribute("stroke-width", String(look.width * (w0 / Math.max(1, frame.cx))));
			shape.setAttribute("stroke-linejoin", "round");
			if (look.dash !== "solid") shape.setAttribute("stroke-dasharray", look.dash === "dotted" ? "1 3" : "6 4");
		}
	}
	void session;
}

function paintPicture(ctx: SlideCtx, pic: Element, tf: Transform): void {
	const f = frameOf(shapeXfrm(pic));
	const blip = deep(pic, A_NS, "blip")[0];
	const rid = blip?.getAttributeNS(R_NS, "embed") ?? blip?.getAttribute("r:embed");
	const target = rid ? ctx.session.rels(ctx.part).find(r => r.id === rid)?.target : undefined;
	const url = target ? ctx.session.media(target) : null;
	if (!f || !url) return;
	const crop = kid(kid(pic, P_NS, "blipFill"), A_NS, "srcRect");
	const [l, t, r, b] = ["l", "t", "r", "b"].map(k => (num(crop, k) ?? 0) / 100000);
	const cropped = l + t + r + b > 0.001 && l + r < 0.99 && t + b < 0.99;
	const geometry = kid(kid(pic, P_NS, "spPr"), A_NS, "prstGeom")?.getAttribute("prst");
	const frame = ctx.into.createDiv({ cls: "notelens-slide-picture" });
	const img = cropped ? frame.createEl("img") : frame.createEl("img", { cls: "notelens-slide-picture-fill" });
	img.src = url;
	img.alt = "";
	if (cropped) {
		// The visible part is a window onto a larger picture.
		img.style.width = `${100 / (1 - l - r)}%`;
		img.style.height = `${100 / (1 - t - b)}%`;
		img.style.left = `${(-l / (1 - l - r)) * 100}%`;
		img.style.top = `${(-t / (1 - t - b)) * 100}%`;
	}
	if (geometry === "ellipse") frame.addClass("is-ellipse");
	else if (geometry === "roundRect") frame.addClass("is-rounded");
	place(ctx, frame, f, tf);
	registerShape(ctx, frame, pic, f, "picture", false);
}

/** Every list-style container that can say something about a paragraph's level. */
function slideStyleChain(ctx: SlideCtx, sp: Element): Element[] {
	const containers: Element[] = [];
	const own = kid(kid(sp, P_NS, "txBody"), A_NS, "lstStyle");
	if (own) containers.push(own);
	const ph = deep(sp, P_NS, "ph")[0];
	if (ph) {
		for (const doc of [ctx.layout, ctx.master]) {
			const found = doc ? findPlaceholder(doc, ph) : null;
			const lst = kid(kid(found, P_NS, "txBody"), A_NS, "lstStyle");
			if (lst) containers.push(lst);
		}
	}
	const styles = deep(ctx.master, P_NS, "txStyles")[0];
	const group = !ph ? "otherStyle" : normType(ph.getAttribute("type")) === "title" ? "titleStyle" : "bodyStyle";
	const style = kid(styles, P_NS, group);
	if (style) containers.push(style);
	return containers;
}

function levelProps(containers: Element[], level: number): Element[] {
	return containers.map(c => kid(c, A_NS, `lvl${level + 1}pPr`)).filter((e): e is Element => !!e);
}

const LINE_GEOMETRIES = new Set(["line", "straightConnector1", "bentConnector2", "bentConnector3", "bentConnector4", "bentConnector5", "curvedConnector2", "curvedConnector3", "curvedConnector4", "curvedConnector5"]);

function paintShape(ctx: SlideCtx, sp: Element, tf: Transform): void {
	const ph = deep(sp, P_NS, "ph")[0];
	if (ctx.decor && ph) return;
	let f = frameOf(shapeXfrm(sp));
	if (!f && ph) {
		for (const doc of [ctx.layout, ctx.master]) {
			const found = doc ? findPlaceholder(doc, ph) : null;
			f = found ? frameOf(shapeXfrm(found)) : null;
			if (f) break;
		}
	}
	if (!f) return;
	const spPr = kid(sp, P_NS, "spPr");
	const style = kid(sp, P_NS, "style");
	const geometry = kid(spPr, A_NS, "prstGeom")?.getAttribute("prst");
	const custom = kid(spPr, A_NS, "custGeom");
	// A "shape" that is really a line has no height to hold a box.
	if (geometry && LINE_GEOMETRIES.has(geometry) && !kid(sp, P_NS, "txBody")?.textContent?.trim()) { paintLine(ctx, spPr, style, f, tf); return; }
	const box = ctx.into.createDiv({ cls: "notelens-slide-shape" });
	place(ctx, box, f, tf);
	registerShape(ctx, box, sp, f, "shape", !!kid(sp, P_NS, "txBody"));

	const fillRef = kid(style, A_NS, "fillRef");
	const refColor = fillRef && (num(fillRef, "idx") ?? 0) > 0 ? colorOf(ctx.session, fillRef) : null;
	const fill = fillCss(ctx.session, spPr, ctx.part, refColor) ?? refColor;
	const look = lineLook(ctx.session, spPr, style);
	if (custom) {
		drawFreeform(box, custom, f, fill, look, ctx.session);
		box.addClass("is-freeform");
	} else {
		if (fill) box.style.background = fill;
		if (look) box.style.border = `${cqw(ctx.session, look.width)} ${look.dash} ${look.color}`;
		if (geometry === "ellipse") box.addClass("is-ellipse");
		else if (geometry === "roundRect") box.addClass("is-rounded");
		else if (geometry) box.dataset.geo = geometry;
	}
	const shadow = kid(kid(spPr, A_NS, "effectLst"), A_NS, "outerShdw");
	if (shadow) {
		const dist = num(shadow, "dist") ?? 0, dir = ((num(shadow, "dir") ?? 0) / 60000) * Math.PI / 180;
		const shade = colorOf(ctx.session, shadow) ?? "rgba(0,0,0,0.4)";
		box.style.filter = `drop-shadow(${cqw(ctx.session, dist * Math.cos(dir))} ${cqw(ctx.session, dist * Math.sin(dir))} ${cqw(ctx.session, num(shadow, "blurRad") ?? 0)} ${shade})`;
	}

	const txBody = kid(sp, P_NS, "txBody");
	if (!txBody) return;
	const bodyPr = kid(txBody, A_NS, "bodyPr");
	const anchor = bodyPr?.getAttribute("anchor");
	box.style.justifyContent = anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start";
	const inset = (attr: string, dflt: number) => `${((num(bodyPr, attr) ?? dflt) / ctx.session.slideW) * 100}cqw`;
	box.style.padding = `${inset("tIns", 45720)} ${inset("rIns", 91440)} ${inset("bIns", 45720)} ${inset("lIns", 91440)}`;
	if (bodyPr?.getAttribute("wrap") === "none") box.addClass("is-nowrap");
	const scale = (num(kid(bodyPr, A_NS, "normAutofit"), "fontScale") ?? 100000) / 100000;
	const isTitle = !!ph && normType(ph.getAttribute("type")) === "title";
	const hint = ph ? (isTitle ? tr("Añade un título") : tr("Añade texto")) : "";
	const fontRef = kid(style, A_NS, "fontRef");
	const fontColor = fontRef ? colorOf(ctx.session, fontRef) : null;
	paintParagraphs(ctx, txBody, box, slideStyleChain(ctx, sp), scale, 1800, isTitle, hint, fontColor);
}

function paintParagraphs(ctx: SlideCtx, txBody: Element, into: HTMLElement, chain: Element[], scale: number, dfltSize = 1800, isTitle = false, hint = "", fontColor: string | null = null): void {
	const painter: Painter = {
		runCss: (rPr) => pptRunCss(ctx.session, rPr, scale),
		sizeCss: (pt) => `${(pt * 12700 / ctx.session.slideW) * 100}cqw`
	};
	const face = ctx.session.font(isTitle ? "major" : "minor");
	for (const p of kids(txBody, A_NS, "p")) {
		const pPr = kid(p, A_NS, "pPr");
		const level = Math.min(8, num(pPr, "lvl") ?? 0);
		const inherited = levelProps(chain, level);
		const firstRun = kids(p, A_NS, "r").map(r => kid(r, A_NS, "rPr")).find(Boolean) ?? null;
		const defaults = inherited.map(l => kid(l, A_NS, "defRPr")).filter((e): e is Element => !!e);
		const pick = <T,>(read: (el: Element) => T | undefined): T | undefined => {
			for (const el of [firstRun, kid(p, A_NS, "endParaRPr"), ...defaults]) {
				const v = el ? read(el) : undefined;
				if (v !== undefined) return v;
			}
			return undefined;
		};
		const size = (pick(el => num(el, "sz")) ?? dfltSize) * scale;
		const color = pick(el => colorOf(ctx.session, kid(el, A_NS, "solidFill")) ?? undefined) ?? fontColor;
		if (ctx.decor && !kids(p, A_NS, "r").length) continue;
		const para = into.createDiv({ cls: "notelens-slide-para" });
		para.style.fontSize = sizeCss(ctx, size);
		if (color) para.style.color = color;
		const typeface = pick(el => { const t = kid(el, A_NS, "latin")?.getAttribute("typeface"); return t && !t.startsWith("+") ? t : undefined; }) ?? (face && !face.startsWith("+") ? face : "");
		if (typeface) para.style.fontFamily = `"${typeface.replace(/"/g, "")}",system-ui,sans-serif`;
		// Bold and italic that a level or a placeholder gives the text, unless the run itself says otherwise.
		if (pick(el => el.getAttribute("b") ?? undefined) === "1") para.addClass("is-bold");
		if (pick(el => el.getAttribute("i") ?? undefined) === "1") para.addClass("is-italic");
		const own = (name: string) => pPr?.getAttribute(name) ?? inherited.map(l => l.getAttribute(name)).find(v => v !== null && v !== undefined) ?? undefined;
		const algn = own("algn");
		applyAlignClass(para, algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : "left");
		const marL = Number(own("marL") ?? 0), indent = Number(own("indent") ?? 0);
		if (marL) para.style.paddingLeft = `${(marL / ctx.session.slideW) * 100}cqw`;
		if (indent) para.style.textIndent = `${(indent / ctx.session.slideW) * 100}cqw`;
		// Line height, and the space before and after a paragraph, as a percentage of the line or in points.
		const spacing = (name: string): Element | null => {
			for (const source of [pPr, ...inherited]) { const el = kid(source, A_NS, name); if (el) return el.firstElementChild; }
			return null;
		};
		const measure = (el: Element | null, percentUnit: (pct: number) => string): string | null => {
			const v = num(el, "val");
			if (!el || v === undefined) return null;
			return el.localName === "spcPts" ? `${(v / 100 * 12700 / ctx.session.slideW) * 100}cqw` : percentUnit(v / 100000);
		};
		const lineHeight = measure(spacing("lnSpc"), pct => String(pct * 1.2));
		if (lineHeight) para.style.lineHeight = lineHeight;
		const before = measure(spacing("spcBef"), pct => `${pct * 1.2}em`);
		if (before) para.style.paddingTop = before;
		const after = measure(spacing("spcAft"), pct => `${pct * 1.2}em`);
		if (after) para.style.paddingBottom = after;
		const bulletSource = [pPr, ...inherited].find(l => kid(l, A_NS, "buChar") || kid(l, A_NS, "buNone"));
		const bullet = kid(bulletSource, A_NS, "buChar");
		if (bullet) para.setAttr("data-bullet", bullet.getAttribute("char") ?? "•");
		const table: Element[] = [];
		const segments = readPptRuns(p, table);
		paintSegments(para, segments, table, painter);
		if (!segments.length) {
			para.addClass("is-empty");
			if (hint) para.dataset.hint = hint;
		}
		// A slide-number or date field would be flattened to plain text by an edit, so a paragraph that holds one is left as it is.
		if (ctx.readonly || kids(p, A_NS, "fld").length) continue;
		para.contentEditable = "true";
		para.spellcheck = true;
		tameEditable(para, {
			enter: () => splitParagraph(ctx.session, para),
			backspaceStart: () => mergeWithPrevious(ctx.session, para)
		});
		ctx.session.bind(para, p, ctx.part, "a");
	}
}

/** One side of a table cell's border, as CSS. */
function cellBorder(session: OfficeSession, ln: Element | null): string | null {
	if (!ln) return null;
	if (kid(ln, A_NS, "noFill")) return "none";
	const color = colorOf(session, kid(ln, A_NS, "solidFill"));
	if (!color) return null;
	const dash = kid(ln, A_NS, "prstDash")?.getAttribute("val") ?? "solid";
	return `${cqw(session, num(ln, "w") ?? 12700)} ${dash.includes("dash") || dash.includes("Dash") ? "dashed" : dash.includes("ot") ? "dotted" : "solid"} ${color}`;
}

function paintTable(ctx: SlideCtx, frame: Element, tf: Transform): void {
	const f = frameOf(shapeXfrm(frame));
	const tbl = deep(frame, A_NS, "tbl")[0];
	if (!f || !tbl) return;
	const wrap = ctx.into.createDiv({ cls: "notelens-slide-shape notelens-slide-table" });
	place(ctx, wrap, f, tf);
	registerShape(ctx, wrap, frame, f, "table", true);
	const table = wrap.createEl("table");
	const tblPr = kid(tbl, A_NS, "tblPr");
	// Tables that lean on a table style get its usual look: an accent header row and light bands.
	const styled = !!kid(tblPr, A_NS, "tableStyleId");
	const firstRow = tblPr?.getAttribute("firstRow") === "1", banded = tblPr?.getAttribute("bandRow") === "1";
	const accent = ctx.session.color("accent1") ?? "#4472c4";
	const widths = kids(kid(tbl, A_NS, "tblGrid"), A_NS, "gridCol").map(c => num(c, "w") ?? 0);
	const total = widths.reduce((a, b) => a + b, 0) || 1;
	const group = table.createEl("colgroup");
	for (const w of widths) group.createEl("col").style.width = `${(w / total) * 100}%`;
	kids(tbl, A_NS, "tr").forEach((row, rowIndex) => {
		const line = table.createEl("tr");
		line.style.height = `${((num(row, "h") ?? 370840) / f.cy) * 100}%`;
		for (const cell of kids(row, A_NS, "tc")) {
			const td = line.createEl("td");
			const span = num(cell, "gridSpan");
			if (span && span > 1) td.colSpan = span;
			const tcPr = kid(cell, A_NS, "tcPr");
			let fill = fillCss(ctx.session, tcPr, ctx.part);
			let onAccent = false;
			if (!fill && styled) {
				if (firstRow && rowIndex === 0) { fill = accent; onAccent = true; }
				else if (banded) fill = rowIndex % 2 ? "rgba(128,128,128,0.16)" : "rgba(128,128,128,0.07)";
			}
			if (fill) td.style.background = fill;
			const borders = [["lnL", "borderLeft"], ["lnR", "borderRight"], ["lnT", "borderTop"], ["lnB", "borderBottom"]] as const;
			if (borders.some(([name]) => kid(tcPr, A_NS, name))) {
				td.addClass("has-own-borders");
				for (const [name, prop] of borders) { const css = cellBorder(ctx.session, kid(tcPr, A_NS, name)); if (css) td.style[prop] = css; }
			}
			const txBody = kid(cell, A_NS, "txBody");
			if (txBody) paintParagraphs(ctx, txBody, td, [], 1, 1800, false, "", onAccent ? "#ffffff" : null);
			if (onAccent) td.addClass("is-head");
		}
	});
}

// ---------------------------------------------------------------------------
// Charts and SmartArt on a slide
// ---------------------------------------------------------------------------

const C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const DGM_NS = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
const DSP_NS = "http://schemas.microsoft.com/office/drawing/2008/diagram";

interface ChartSeries { name: string; cats: string[]; vals: number[]; xs: number[]; color: string | null }

function chartValues(cache: Element | null): string[] {
	const out: string[] = [];
	for (const pt of kids(cache, C_NS, "pt")) out[num(pt, "idx") ?? out.length] = kid(pt, C_NS, "v")?.textContent ?? "";
	return Array.from(out, v => v ?? "");
}

function readSeries(session: OfficeSession, chart: Element): ChartSeries[] {
	return kids(chart, C_NS, "ser").map((ser, index) => {
		const cache = (name: string) => {
			const holder = kid(ser, C_NS, name);
			return kid(kid(holder, C_NS, "strRef"), C_NS, "strCache") ?? kid(kid(holder, C_NS, "numRef"), C_NS, "numCache") ?? kid(holder, C_NS, "numLit") ?? kid(holder, C_NS, "strLit");
		};
		const name = deep(kid(ser, C_NS, "tx"), C_NS, "v")[0]?.textContent?.trim() || `${index + 1}`;
		const color = colorOf(session, kid(kid(ser, C_NS, "spPr"), A_NS, "solidFill")) ?? colorOf(session, kid(kid(kid(ser, C_NS, "spPr"), A_NS, "ln"), A_NS, "solidFill"));
		return {
			name, color,
			cats: chartValues(cache("cat")),
			vals: chartValues(cache("val") ?? cache("yVal")).map(v => Number(v) || 0),
			xs: chartValues(cache("xVal")).map(v => Number(v) || 0)
		};
	});
}

/** A round upper bound for an axis, and the step between its lines. */
function niceScale(max: number): { top: number; step: number } {
	if (max <= 0) return { top: 1, step: 0.2 };
	const raw = max / 5;
	const power = Math.pow(10, Math.floor(Math.log10(raw)));
	const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= raw) ?? 10 * power;
	return { top: Math.ceil(max / step) * step, step };
}

function formatNumber(n: number): string {
	if (Math.abs(n) >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
	if (Math.abs(n) >= 1e4) return `${+(n / 1e3).toFixed(1)}k`;
	return `${+n.toFixed(2)}`;
}

/** Draws a chart from the values a deck keeps with it: columns, bars, lines, areas, pies and scatter plots. */
function drawChart(session: OfficeSession, doc: Document, into: HTMLElement, frame: Frame): void {
	const plot = deep(doc, C_NS, "plotArea")[0];
	const kinds = ["barChart", "bar3DChart", "lineChart", "line3DChart", "areaChart", "pieChart", "pie3DChart", "doughnutChart", "scatterChart"];
	const chart = Array.from(plot?.children ?? []).find(c => c.namespaceURI === C_NS && kinds.includes(c.localName));
	if (!plot || !chart) return;
	const W = 960, H = Math.max(240, Math.round(W * frame.cy / Math.max(1, frame.cx)));
	const svg = into.createSvg("svg", { cls: "notelens-slide-chart-svg", attr: { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet" } });
	const ink = session.color("tx1") ?? "#333333";
	const add = (tag: string, attrs: Record<string, string | number>, text?: string): SVGElement => {
		const el = svg.createSvg(tag as "text", { attr: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)])) });
		if (text !== undefined) el.textContent = text;
		return el;
	};
	const series = readSeries(session, chart);
	const accent = (i: number) => series[i]?.color ?? session.color(`accent${(i % 6) + 1}`) ?? ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"][i % 6];
	const title = kid(kid(doc.documentElement, C_NS, "chart"), C_NS, "title");
	const titleText = deep(title, A_NS, "t").map(t => t.textContent ?? "").join("").trim();
	const legend = kid(kid(doc.documentElement, C_NS, "chart"), C_NS, "legend");
	const top = titleText ? 58 : 24, bottom = legend ? 46 : 16;
	if (titleText) add("text", { x: W / 2, y: 34, "text-anchor": "middle", "font-size": 24, "font-weight": 600, fill: ink }, titleText);
	const kind = chart.localName;
	const cats = series.reduce((longest, s) => (s.cats.length > longest.length ? s.cats : longest), [] as string[]);
	const count = Math.max(cats.length, ...series.map(s => s.vals.length), 1);
	if (legend && series.length) {
		let x = W / 2 - series.reduce((sum, s) => sum + s.name.length * 8 + 40, 0) / 2;
		const items = kind.startsWith("pie") || kind === "doughnutChart" ? cats.map((c, i) => ({ name: c, i })) : series.map((s, i) => ({ name: s.name, i }));
		if (kind.startsWith("pie") || kind === "doughnutChart") x = W / 2 - items.reduce((sum, s) => sum + s.name.length * 8 + 40, 0) / 2;
		for (const item of items) {
			add("rect", { x, y: H - 30, width: 14, height: 14, fill: accent(item.i) });
			add("text", { x: x + 20, y: H - 18, "font-size": 15, fill: ink }, item.name);
			x += item.name.length * 8 + 40;
		}
	}
	if (kind === "pieChart" || kind === "pie3DChart" || kind === "doughnutChart") {
		const values = series[0]?.vals ?? [];
		const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
		const cx = W / 2, cy = (top + H - bottom) / 2, r = Math.min((H - top - bottom) / 2, W / 3) - 6;
		let angle = -Math.PI / 2;
		values.forEach((v, i) => {
			const sweep = (Math.max(0, v) / total) * Math.PI * 2;
			const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle), x2 = cx + r * Math.cos(angle + sweep), y2 = cy + r * Math.sin(angle + sweep);
			const large = sweep > Math.PI ? 1 : 0;
			add("path", { d: `M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`, fill: accent(i), stroke: "#ffffff", "stroke-width": 2 });
			if (sweep > 0.2) add("text", { x: cx + r * 0.66 * Math.cos(angle + sweep / 2), y: cy + r * 0.66 * Math.sin(angle + sweep / 2), "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 16, fill: "#ffffff", "font-weight": 600 }, `${Math.round((v / total) * 100)}%`);
			angle += sweep;
		});
		if (kind === "doughnutChart") add("circle", { cx, cy, r: r * 0.5, fill: session.color("bg1") ?? "#ffffff" });
		return;
	}
	const left = 70, right = 24;
	const plotW = W - left - right, plotH = H - top - bottom - 26;
	const isBar = kind.startsWith("bar");
	const horizontal = isBar && kid(chart, C_NS, "barDir")?.getAttribute("val") === "bar";
	const grouping = kid(chart, C_NS, "grouping")?.getAttribute("val") ?? "clustered";
	const stacked = grouping === "stacked" || grouping === "percentStacked";
	const percent = grouping === "percentStacked";
	const xs = kind === "scatterChart" ? series.flatMap(s => s.xs) : [];
	const stackTotals = Array.from({ length: count }, (_, i) => series.reduce((sum, s) => sum + Math.max(0, s.vals[i] ?? 0), 0));
	const maxValue = percent ? 100 : stacked ? Math.max(...stackTotals, 0) : Math.max(...series.flatMap(s => s.vals), 0);
	const minValue = Math.min(0, ...series.flatMap(s => s.vals));
	const scale = niceScale(maxValue);
	const span = scale.top - Math.min(0, minValue) || 1;
	const yOf = (v: number) => top + plotH - ((v - Math.min(0, minValue)) / span) * plotH;
	const xMax = xs.length ? Math.max(...xs, 1) : 1;
	for (let v = Math.min(0, minValue); v <= scale.top + 1e-9; v += scale.step) {
		const y = horizontal ? 0 : yOf(v);
		if (horizontal) {
			const x = left + ((v - Math.min(0, minValue)) / span) * plotW;
			add("line", { x1: x, y1: top, x2: x, y2: top + plotH, stroke: "rgba(128,128,128,0.3)" });
			add("text", { x, y: top + plotH + 20, "text-anchor": "middle", "font-size": 14, fill: ink }, percent ? `${v}%` : formatNumber(v));
		} else {
			add("line", { x1: left, y1: y, x2: left + plotW, y2: y, stroke: "rgba(128,128,128,0.3)" });
			add("text", { x: left - 8, y: y + 5, "text-anchor": "end", "font-size": 14, fill: ink }, percent ? `${v}%` : formatNumber(v));
		}
	}
	const slot = (horizontal ? plotH : plotW) / count;
	cats.forEach((cat, i) => {
		if (kind === "scatterChart") return;
		const label = cat.length > 14 ? `${cat.slice(0, 13)}…` : cat;
		if (horizontal) add("text", { x: left - 8, y: top + slot * (i + 0.5) + 5, "text-anchor": "end", "font-size": 14, fill: ink }, label);
		else add("text", { x: left + slot * (i + 0.5), y: top + plotH + 20, "text-anchor": "middle", "font-size": 14, fill: ink }, label);
	});
	if (isBar) {
		const each = stacked ? slot * 0.6 : (slot * 0.7) / Math.max(1, series.length);
		for (let i = 0; i < count; i++) {
			let acc = 0;
			series.forEach((s, si) => {
				const raw = s.vals[i] ?? 0;
				const v = percent ? (raw / (stackTotals[i] || 1)) * 100 : raw;
				const from = stacked ? acc : 0, to = stacked ? acc + v : v;
				acc += stacked ? v : 0;
				const offset = stacked ? slot * 0.2 : slot * 0.15 + each * si;
				if (horizontal) {
					const x0 = left + ((Math.min(from, to) - Math.min(0, minValue)) / span) * plotW, x1 = left + ((Math.max(from, to) - Math.min(0, minValue)) / span) * plotW;
					add("rect", { x: x0, y: top + slot * i + offset, width: Math.max(0, x1 - x0), height: each, fill: accent(si) });
				} else {
					const y0 = yOf(Math.max(from, to)), y1 = yOf(Math.min(from, to));
					add("rect", { x: left + slot * i + offset, y: y0, width: each, height: Math.max(0, y1 - y0), fill: accent(si) });
				}
			});
		}
	} else if (kind === "scatterChart") {
		series.forEach((s, si) => {
			s.vals.forEach((v, i) => add("circle", { cx: left + ((s.xs[i] ?? i) / xMax) * plotW, cy: yOf(v), r: 5, fill: accent(si) }));
		});
	} else {
		series.forEach((s, si) => {
			const point = (i: number): [number, number] => [left + slot * (i + 0.5), yOf(s.vals[i] ?? 0)];
			const pts = s.vals.map((_, i) => point(i));
			if (kind === "areaChart" && pts.length) {
				add("polygon", { points: [`${pts[0][0]},${yOf(0)}`, ...pts.map(p => p.join(",")), `${pts[pts.length - 1][0]},${yOf(0)}`].join(" "), fill: accent(si), "fill-opacity": 0.55 });
			} else {
				add("polyline", { points: pts.map(p => p.join(",")).join(" "), fill: "none", stroke: accent(si), "stroke-width": 3, "stroke-linejoin": "round" });
				for (const [x, y] of pts) add("circle", { cx: x, cy: y, r: 4.5, fill: accent(si) });
			}
		});
	}
	add("line", { x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH, stroke: ink, "stroke-opacity": 0.6 });
}

/** A chart placed on a slide: its part is read for the values it carries. */
function paintChart(ctx: SlideCtx, frame: Element, f: Frame, tf: Transform): void {
	const chart = deep(frame, C_NS, "chart")[0];
	const rid = chart?.getAttributeNS(R_NS, "id") ?? chart?.getAttribute("r:id");
	const target = rid ? ctx.session.rels(ctx.part).find(r => r.id === rid)?.target : undefined;
	const doc = target ? ctx.session.xml(target) : null;
	const wrap = ctx.into.createDiv({ cls: "notelens-slide-shape notelens-slide-chart" });
	place(ctx, wrap, f, tf);
	registerShape(ctx, wrap, frame, f, "picture", false);
	if (doc) drawChart(ctx.session, doc, wrap, f);
}

/** SmartArt is stored with a ready-made drawing of its shapes; those shapes are painted where the diagram sits. */
function paintSmartArt(ctx: SlideCtx, f: Frame, tf: Transform): void {
	const rel = ctx.session.rels(ctx.part).find(r => r.type.endsWith("/diagramDrawing"));
	const raw = rel ? ctx.session.files[rel.target] : undefined;
	if (!raw) return;
	const text = new TextDecoder().decode(raw)
		.replace(new RegExp(`xmlns:dsp="${DSP_NS}"`), `xmlns:p="${P_NS}"`)
		.replace(/<(\/?)dsp:/g, "<$1p:");
	const doc = new DOMParser().parseFromString(text, "application/xml");
	const tree = deep(doc, P_NS, "spTree")[0];
	if (!tree || doc.querySelector("parsererror")) return;
	paintTree({ ...ctx, interactive: false, readonly: true, decor: false }, tree, { ox: tf.ox + tf.sx * f.x, oy: tf.oy + tf.sy * f.y, sx: tf.sx, sy: tf.sy });
}

/** A frame holds a table, a chart or a diagram. */
function paintGraphicFrame(ctx: SlideCtx, frame: Element, tf: Transform): void {
	const f = frameOf(shapeXfrm(frame));
	if (!f) return;
	if (deep(frame, C_NS, "chart").length) paintChart(ctx, frame, f, tf);
	else if (deep(frame, DGM_NS, "relIds").length) paintSmartArt(ctx, f, tf);
	else paintTable(ctx, frame, tf);
}

// ---------------------------------------------------------------------------
// Structure: new paragraphs, joined paragraphs, lists, page breaks
// ---------------------------------------------------------------------------

/** Characters before a point of an editable paragraph; a line break counts as one. */
function offsetIn(root: HTMLElement, container: Node, offset: number): number {
	const probe = root.ownerDocument.createRange();
	probe.selectNodeContents(root);
	probe.setEnd(container, offset);
	let count = 0;
	const walk = (node: Node) => {
		if (node.nodeType === 3) count += node.textContent?.length ?? 0;
		else if (node.nodeName === "BR") count += 1;
		else node.childNodes.forEach(walk);
	};
	probe.cloneContents().childNodes.forEach(walk);
	return count;
}

function caretOffset(el: HTMLElement): number {
	const selection = el.ownerDocument.defaultView?.getSelection();
	if (!selection?.rangeCount) return 0;
	const range = selection.getRangeAt(0);
	return el.contains(range.startContainer) ? offsetIn(el, range.startContainer, range.startOffset) : 0;
}

function textLength(el: HTMLElement): number {
	return segmentsFromDom(el).reduce((n, s) => n + s.text.length, 0);
}

/** Puts the caret (or a selection) at character offsets inside a paragraph. */
function placeCaret(el: HTMLElement, start: number, end = start): void {
	const doc = el.ownerDocument;
	const selection = doc.defaultView?.getSelection();
	if (!selection) return;
	const range = doc.createRange();
	range.selectNodeContents(el);
	range.collapse(true);
	const locate = (target: number, edge: "start" | "end"): boolean => {
		let remaining = target;
		const walk = (node: Node): boolean => {
			if (node.nodeType === 3) {
				const length = node.textContent?.length ?? 0;
				if (remaining <= length) { if (edge === "start") range.setStart(node, remaining); else range.setEnd(node, remaining); return true; }
				remaining -= length;
				return false;
			}
			if (node.nodeName === "BR") {
				if (remaining === 0) { if (edge === "start") range.setStartBefore(node); else range.setEndBefore(node); return true; }
				remaining -= 1;
				return false;
			}
			return Array.from(node.childNodes).some(walk);
		};
		return walk(el);
	};
	const startFound = locate(start, "start");
	if (!startFound) { range.selectNodeContents(el); range.collapse(false); }
	else if (end === start) range.collapse(true);
	else if (!locate(end, "end")) range.setEndAfter(el.lastChild ?? el);
	selection.removeAllRanges();
	selection.addRange(range);
}

/** Puts the caret in the paragraph that shows an XML paragraph, after the page has been drawn again. */
export function focusParagraph(session: OfficeSession, node: Element, offset: number): void {
	const el = session.elementFor(node);
	if (!el) return;
	el.focus({ preventScroll: true });
	placeCaret(el, offset);
	el.scrollIntoView({ block: "nearest" });
}

function splitSegments(segments: Segment[], offset: number): [Segment[], Segment[]] {
	const left: Segment[] = [], right: Segment[] = [];
	let pos = 0;
	for (const seg of segments) {
		const end = pos + seg.text.length;
		if (end <= offset) left.push(seg);
		else if (pos >= offset) right.push(seg);
		else {
			left.push({ ...seg, text: seg.text.slice(0, offset - pos) });
			right.push({ ...seg, text: seg.text.slice(offset - pos) });
		}
		pos = end;
	}
	return [left, right];
}

function ensureWordPPr(node: Element): Element {
	let pPr = kid(node, W_NS, "pPr");
	if (!pPr) {
		pPr = node.ownerDocument.createElementNS(W_NS, "w:pPr");
		node.insertBefore(pPr, node.firstChild);
	}
	return pPr;
}

/** Enter: the paragraph is cut at the caret and the rest becomes a paragraph of its own. */
function splitParagraph(session: OfficeSession, el: HTMLElement): void {
	const binding = session.bindingOf(el);
	const selection = el.ownerDocument.defaultView?.getSelection();
	if (!binding || !selection?.rangeCount) return;
	if (!selection.isCollapsed) selection.deleteFromDocument();
	const offset = Math.min(caretOffset(el), textLength(el));
	session.checkpoint();
	const segments = segmentsFromDom(el);
	const table = runTables.get(el) ?? [];
	const [left, right] = splitSegments(segments, offset);
	const node = binding.node;
	const doc = node.ownerDocument;
	if (binding.dialect === "w") {
		const numPr = kid(kid(node, W_NS, "pPr"), W_NS, "numPr");
		// Enter on an empty list item ends the list.
		if (!segments.length && numPr) {
			numPr.remove();
			session.touch(binding.part);
			session.onStructure?.({ node, offset: 0 });
			return;
		}
		const fresh = doc.createElementNS(W_NS, "w:p");
		const pPr = kid(node, W_NS, "pPr");
		if (pPr) fresh.appendChild(pPr.cloneNode(true));
		// A heading is followed by the style its definition names, as in Word.
		if (!right.length) {
			const chain = styleChain(session, wVal(kid(pPr, W_NS, "pStyle")) ?? defaultParagraphStyle(session));
			const next = wVal(kid(chain[chain.length - 1], W_NS, "next"));
			if (next) {
				const freshPPr = ensureWordPPr(fresh);
				for (const old of kids(freshPPr, W_NS, "pStyle")) old.remove();
				if (next !== defaultParagraphStyle(session)) {
					const pStyle = doc.createElementNS(W_NS, "w:pStyle");
					pStyle.setAttributeNS(W_NS, "w:val", next);
					freshPPr.insertBefore(pStyle, freshPPr.firstChild);
				}
			}
		}
		writeWordRuns(node, left, table);
		writeWordRuns(fresh, right, table);
		node.after(fresh);
		session.touch(binding.part);
		session.onStructure?.({ node: fresh, offset: 0 });
		return;
	}
	const fresh = doc.createElementNS(A_NS, "a:p");
	const pPr = kid(node, A_NS, "pPr");
	if (pPr) fresh.appendChild(pPr.cloneNode(true));
	const end = kid(node, A_NS, "endParaRPr");
	if (end) fresh.appendChild(end.cloneNode(true));
	writePptRuns(node, left, table);
	writePptRuns(fresh, right, table);
	node.after(fresh);
	session.touch(binding.part);
	session.onStructure?.({ node: fresh, offset: 0 });
}

/** Backspace at the start of a paragraph: it joins the one before. Returns whether it did. */
function mergeWithPrevious(session: OfficeSession, el: HTMLElement): boolean {
	const binding = session.bindingOf(el);
	const selection = el.ownerDocument.defaultView?.getSelection();
	if (!binding || !selection?.isCollapsed || caretOffset(el) !== 0) return false;
	const node = binding.node;
	const prev = node.previousElementSibling;
	const isWord = binding.dialect === "w";
	if (!prev || prev.localName !== "p" || prev.namespaceURI !== (isWord ? W_NS : A_NS)) return false;
	if (isWord && (wordParagraphLocked(prev) || deep(node, W_NS, "drawing").length || deep(prev, W_NS, "drawing").length)) return false;
	session.checkpoint();
	const tablePrev: Element[] = [], tableNode: Element[] = [];
	const before = isWord ? readWordRuns(prev, tablePrev) : readPptRuns(prev, tablePrev);
	const after = isWord ? readWordRuns(node, tableNode) : readPptRuns(node, tableNode);
	const shift = tablePrev.length;
	const merged: Segment[] = [];
	for (const seg of [...before, ...after.map(s => ({ ...s, r: s.r >= 0 ? s.r + shift : -1 }))]) pushSegment(merged, { ...seg });
	const joinAt = before.reduce((n, s) => n + s.text.length, 0);
	if (isWord) writeWordRuns(prev, merged, [...tablePrev, ...tableNode]);
	else writePptRuns(prev, merged, [...tablePrev, ...tableNode]);
	node.remove();
	session.touch(binding.part);
	session.onStructure?.({ node: prev, offset: joinAt });
	return true;
}

/** Numbering ids the document already defines, by the kind of list they make. */
export function listKinds(session: OfficeSession): { bullet: string | null; decimal: string | null } {
	const found = { bullet: null as string | null, decimal: null as string | null };
	for (const num_ of deep(session.xml("word/numbering.xml"), W_NS, "num")) {
		const id = wAttr(num_, "numId");
		const level = id ? numberingLevels(session, id)?.find(l => Number(wAttr(l, "ilvl")) === 0) : undefined;
		const fmt = wVal(kid(level, W_NS, "numFmt"));
		if (!id || !fmt) continue;
		if (fmt === "bullet") found.bullet ??= id;
		else if (fmt === "decimal") found.decimal ??= id;
	}
	return found;
}

/** Puts the paragraph in a bulleted or numbered list, or takes it out when it is already in that one. */
export function toggleList(session: OfficeSession, el: HTMLElement, kind: "bullet" | "decimal"): void {
	const binding = session.bindingOf(el);
	const id = listKinds(session)[kind];
	if (!binding || binding.dialect !== "w" || !id) return;
	const offset = caretOffset(el);
	session.checkpoint();
	const node = binding.node;
	const pPr = ensureWordPPr(node);
	const existing = kid(pPr, W_NS, "numPr");
	const current = wVal(kid(existing, W_NS, "numId"));
	for (const old of kids(pPr, W_NS, "numPr")) old.remove();
	if (current !== id) {
		const doc = node.ownerDocument;
		const numPr = doc.createElementNS(W_NS, "w:numPr");
		const ilvl = doc.createElementNS(W_NS, "w:ilvl");
		ilvl.setAttributeNS(W_NS, "w:val", "0");
		const numId = doc.createElementNS(W_NS, "w:numId");
		numId.setAttributeNS(W_NS, "w:val", id);
		numPr.append(ilvl, numId);
		insertOrdered(pPr, numPr, W_PPR_ORDER);
	}
	session.touch(binding.part);
	session.onStructure?.({ node, offset });
}

/** A page break after the paragraph the caret is in, with an empty paragraph to carry on in. */
export function insertPageBreak(session: OfficeSession, el: HTMLElement): void {
	const binding = session.bindingOf(el);
	if (!binding || binding.dialect !== "w") return;
	session.checkpoint();
	const node = binding.node;
	const doc = node.ownerDocument;
	const breaker = doc.createElementNS(W_NS, "w:p");
	const run = doc.createElementNS(W_NS, "w:r");
	const br = doc.createElementNS(W_NS, "w:br");
	br.setAttributeNS(W_NS, "w:type", "page");
	run.appendChild(br);
	breaker.appendChild(run);
	const fresh = doc.createElementNS(W_NS, "w:p");
	node.after(breaker);
	breaker.after(fresh);
	session.touch(binding.part);
	session.onStructure?.({ node: fresh, offset: 0 });
}

// ---------------------------------------------------------------------------
// Slides: add, remove, add a text box
// ---------------------------------------------------------------------------

const CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_DECL = `xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"`;

function relationshipsXml(items: [string, string, string][]): string {
	return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R_NS}/${type}" Target="${target}"/>`).join("")}</Relationships>`;
}

function xmlEscape(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Removes a slide (never the last one), with its part and every reference to it. */
export function deleteSlide(session: OfficeSession, index: number): boolean {
	const path = session.slides[index];
	const presentation = session.xml("ppt/presentation.xml");
	const relsPath = "ppt/_rels/presentation.xml.rels";
	const relsDoc = session.xml(relsPath);
	const types = session.xml("[Content_Types].xml");
	if (!path || session.slides.length <= 1 || !presentation || !relsDoc || !types) return false;
	session.checkpoint();
	const relEl = Array.from(relsDoc.getElementsByTagName("Relationship")).find(r => resolvePath("ppt/presentation.xml", r.getAttribute("Target") ?? "") === path);
	const rid = relEl?.getAttribute("Id");
	for (const entry of deep(presentation, P_NS, "sldId")) {
		if ((entry.getAttributeNS(R_NS, "id") ?? entry.getAttribute("r:id")) === rid) entry.remove();
	}
	relEl?.remove();
	for (const override of Array.from(types.getElementsByTagName("Override"))) {
		if (override.getAttribute("PartName") === `/${path}`) override.remove();
	}
	session.removePart(path);
	session.removePart(`ppt/slides/_rels/${path.split("/").pop()}.rels`);
	session.touch(relsPath);
	session.touch("ppt/presentation.xml");
	session.touch("[Content_Types].xml");
	session.slides.splice(index, 1);
	return true;
}

/** A text box near the top left of a slide; its first paragraph is returned for the caret. */
export function addTextBox(session: OfficeSession, index: number): Element | null {
	const part = session.slides[index];
	const doc = part ? session.xml(part) : null;
	const tree = deep(doc, P_NS, "spTree")[0];
	if (!part || !doc || !tree) return null;
	session.checkpoint();
	const id = Math.max(1, ...deep(doc, P_NS, "cNvPr").map(c => Number(c.getAttribute("id")) || 0)) + 1;
	const w = Math.round(session.slideW * 0.42), h = Math.round(session.slideH * 0.12);
	const x = Math.round(session.slideW * 0.08), y = Math.round(session.slideH * 0.3);
	const xml = `<p:sp ${NS_DECL}><p:nvSpPr><p:cNvPr id="${id}" name="Cuadro de texto ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES" sz="2400"/><a:t>${xmlEscape(tr("Escribe aquí"))}</a:t></a:r></a:p></p:txBody></p:sp>`;
	const parsed = new DOMParser().parseFromString(xml, "application/xml");
	const shape = doc.importNode(parsed.documentElement, true);
	tree.appendChild(shape);
	session.touch(part);
	return deep(shape, A_NS, "p")[0] ?? null;
}

// ---------------------------------------------------------------------------
// New files
// ---------------------------------------------------------------------------

/** A new .docx or .pptx from a template (a note-taking layout, or a slide theme), complete enough for Word and PowerPoint to open. */
export function newOfficeFile(kind: OfficeKind, title: string, variant?: string): Uint8Array {
	const parts = kind === "docx"
		? buildDocx(title, (variant as DocTemplateId | undefined) ?? "blank")
		: buildDeck(title, (variant as DeckThemeId | undefined) ?? "classic");
	const files: Record<string, Uint8Array> = {};
	for (const [path, text] of Object.entries(parts)) files[path] = encoder.encode(text);
	return zipSync(files);
}

// ---------------------------------------------------------------------------
// Word: tables, pictures, indentation, outline, counting, searching
// ---------------------------------------------------------------------------

function ancestorNamed(node: Element, ns: string, name: string): Element | null {
	for (let cur: Element | null = node.parentElement; cur; cur = cur.parentElement) {
		if (cur.localName === name && cur.namespaceURI === ns) return cur;
	}
	return null;
}

/** The element of the body that holds a paragraph, so a table can go after it and not inside a cell. */
function topLevelOf(node: Element): Element {
	let cur = node;
	while (cur.parentElement && cur.parentElement.localName !== "body") cur = cur.parentElement;
	return cur;
}

function parseFragment(doc: Document, xml: string): Element {
	return doc.importNode(new DOMParser().parseFromString(xml, "application/xml").documentElement, true);
}

/** A table after the paragraph the caret is in, with an empty paragraph under it to carry on in. */
export function insertTable(session: OfficeSession, el: HTMLElement, rows: number, cols: number): void {
	const binding = session.bindingOf(el);
	if (!binding || binding.dialect !== "w") return;
	session.checkpoint();
	const node = binding.node;
	const doc = node.ownerDocument;
	const box = pageBox(session);
	const total = Math.round((box.w - box.left - box.right) / TWIP_PX);
	const width = Math.floor(total / cols);
	const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map(n => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`).join("");
	const cell = (header: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EEF5"/>' : ""}</w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr></w:p></w:tc>`;
	const xml = `<w:tbl xmlns:w="${W_NS}"><w:tblPr><w:tblW w:w="${width * cols}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(cols)}</w:tblGrid>${Array.from({ length: rows }, (_, i) => `<w:tr>${cell(i === 0).repeat(cols)}</w:tr>`).join("")}</w:tbl>`;
	const table = parseFragment(doc, xml);
	const anchor = topLevelOf(node);
	anchor.after(table);
	table.after(doc.createElementNS(W_NS, "w:p"));
	session.touch(binding.part);
	const first = deep(table, W_NS, "p")[0];
	session.onStructure?.(first ? { node: first, offset: 0 } : undefined);
}

export type TableAction = "rowBefore" | "rowAfter" | "colBefore" | "colAfter" | "deleteRow" | "deleteCol" | "deleteTable";

/** Where the caret is in a table, or null when it is not in one. */
export function tableInfo(session: OfficeSession, el: HTMLElement): { rows: number; cols: number } | null {
	const node = session.bindingOf(el)?.node;
	const tr_ = node ? ancestorNamed(node, W_NS, "tr") : null;
	const tbl = tr_ ? ancestorNamed(tr_, W_NS, "tbl") : null;
	if (!tr_ || !tbl) return null;
	return { rows: kids(tbl, W_NS, "tr").length, cols: kids(tr_, W_NS, "tc").length };
}

function emptied(source: Element): Element {
	const copy = source.cloneNode(true) as Element;
	for (const p of deep(copy, W_NS, "p")) {
		for (const child of Array.from(p.children)) if (child.localName !== "pPr") child.remove();
	}
	return copy;
}

/** Makes every column of a table the same share of what it already spans. */
function evenColumns(tbl: Element): void {
	const grid = kid(tbl, W_NS, "tblGrid");
	const cols = kids(grid, W_NS, "gridCol");
	if (!cols.length) return;
	const total = cols.reduce((sum, c) => sum + (wNum(c, "w") ?? 0), 0);
	const each = Math.floor(total / cols.length) || 2400;
	for (const c of cols) c.setAttributeNS(W_NS, "w:w", String(each));
	for (const row of kids(tbl, W_NS, "tr")) {
		for (const cell of kids(row, W_NS, "tc")) {
			const w = kid(kid(cell, W_NS, "tcPr"), W_NS, "tcW");
			if (w) { w.setAttributeNS(W_NS, "w:w", String(each * (Number(wVal(kid(kid(cell, W_NS, "tcPr"), W_NS, "gridSpan")) ?? 1)))); w.setAttributeNS(W_NS, "w:type", "dxa"); }
		}
	}
	const tblW = kid(kid(tbl, W_NS, "tblPr"), W_NS, "tblW");
	if (tblW && wAttr(tblW, "type") === "dxa") tblW.setAttributeNS(W_NS, "w:w", String(each * cols.length));
}

export function tableEdit(session: OfficeSession, el: HTMLElement, action: TableAction): void {
	const binding = session.bindingOf(el);
	const node = binding?.node;
	const tc = node ? ancestorNamed(node, W_NS, "tc") : null;
	const tr_ = tc ? ancestorNamed(tc, W_NS, "tr") : null;
	const tbl = tr_ ? ancestorNamed(tr_, W_NS, "tbl") : null;
	if (!binding || !tc || !tr_ || !tbl) return;
	session.checkpoint();
	const rows = kids(tbl, W_NS, "tr");
	const col = kids(tr_, W_NS, "tc").indexOf(tc);
	let focus: Element | null = null;
	if (action === "rowBefore" || action === "rowAfter") {
		const fresh = emptied(tr_);
		if (action === "rowBefore") tr_.before(fresh); else tr_.after(fresh);
		focus = deep(kids(fresh, W_NS, "tc")[col] ?? fresh, W_NS, "p")[0] ?? null;
	} else if (action === "colBefore" || action === "colAfter") {
		const grid = kid(tbl, W_NS, "tblGrid");
		const gridCol = kids(grid, W_NS, "gridCol")[col];
		if (gridCol) { const copy = gridCol.cloneNode(true) as Element; if (action === "colBefore") gridCol.before(copy); else gridCol.after(copy); }
		for (const row of rows) {
			const cell = kids(row, W_NS, "tc")[col];
			if (!cell) continue;
			const fresh = emptied(cell);
			if (action === "colBefore") cell.before(fresh); else cell.after(fresh);
			if (row === tr_) focus = deep(fresh, W_NS, "p")[0] ?? null;
		}
		evenColumns(tbl);
	} else if (action === "deleteRow") {
		if (rows.length < 2) return;
		const near = rows[rows.indexOf(tr_) + 1] ?? rows[rows.indexOf(tr_) - 1];
		tr_.remove();
		focus = deep(kids(near, W_NS, "tc")[col] ?? near, W_NS, "p")[0] ?? null;
	} else if (action === "deleteCol") {
		if (kids(tr_, W_NS, "tc").length < 2) return;
		kids(kid(tbl, W_NS, "tblGrid"), W_NS, "gridCol")[col]?.remove();
		for (const row of rows) kids(row, W_NS, "tc")[col]?.remove();
		evenColumns(tbl);
		focus = deep(kids(tr_, W_NS, "tc")[Math.max(0, col - 1)], W_NS, "p")[0] ?? null;
	} else {
		const next = tbl.nextElementSibling;
		const before = tbl.previousElementSibling;
		tbl.remove();
		const keep = next?.localName === "p" ? next : before?.localName === "p" ? before : null;
		focus = keep;
		if (!keep) { const p = tbl.ownerDocument.createElementNS(W_NS, "w:p"); (next ?? before)?.before(p); if (!next && !before) tbl.parentElement?.appendChild(p); focus = p; }
	}
	session.touch(binding.part);
	session.onStructure?.(focus ? { node: focus, offset: 0 } : undefined);
}

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" };

/** Stores a picture in the package and returns the relationship that points at it. */
function storePicture(session: OfficeSession, folder: "word" | "ppt", relsOwner: string, data: Uint8Array, ext: string): string | null {
	const e = ext.toLowerCase() === "jpeg" ? "jpg" : ext.toLowerCase();
	if (!IMAGE_TYPES[e]) return null;
	let n = 1;
	while (session.files[`${folder}/media/image${n}.${e}`]) n++;
	const path = `${folder}/media/image${n}.${e}`;
	session.files[path] = data;
	const dir = relsOwner.split("/").slice(0, -1).join("/");
	const relsPath = `${dir}/_rels/${relsOwner.split("/").pop()}.rels`;
	let rels = session.xml(relsPath);
	if (!rels) { session.addPart(relsPath, relationshipsXml([])); rels = session.xml(relsPath); }
	const types = session.xml("[Content_Types].xml");
	if (!rels || !types) return null;
	const used = new Set(Array.from(rels.getElementsByTagName("Relationship")).map(r => r.getAttribute("Id")));
	let k = 1;
	while (used.has(`rId${k}`)) k++;
	const rid = `rId${k}`;
	const rel = rels.createElementNS(rels.documentElement.namespaceURI, "Relationship");
	rel.setAttribute("Id", rid);
	rel.setAttribute("Type", `${R_NS}/image`);
	// Relative to the part that points at it: a slide lives a folder below ppt, and its pictures beside it, one up.
	rel.setAttribute("Target", `${"../".repeat(Math.max(0, dir.split("/").length - folder.split("/").length))}media/image${n}.${e}`);
	rels.documentElement.appendChild(rel);
	session.touch(relsPath);
	const has = Array.from(types.getElementsByTagName("Default")).some(d => d.getAttribute("Extension")?.toLowerCase() === e);
	if (!has) {
		const def = types.createElementNS(types.documentElement.namespaceURI, "Default");
		def.setAttribute("Extension", e);
		def.setAttribute("ContentType", IMAGE_TYPES[e]);
		types.documentElement.insertBefore(def, types.documentElement.firstChild);
		session.touch("[Content_Types].xml");
	}
	return rid;
}

/** A picture in a paragraph of its own after the paragraph the caret is in. */
export function insertImage(session: OfficeSession, el: HTMLElement, data: Uint8Array, ext: string, natural: { w: number; h: number }): void {
	const binding = session.bindingOf(el);
	if (!binding || binding.dialect !== "w") return;
	session.checkpoint();
	const rid = storePicture(session, "word", DOCX, data, ext);
	if (!rid) return;
	const node = binding.node;
	const doc = node.ownerDocument;
	const box = pageBox(session);
	const width = Math.max(40, Math.min(natural.w || 400, box.w - box.left - box.right));
	const height = Math.round(width * (natural.h || 300) / (natural.w || 400));
	const cx = width * EMU_PER_PX, cy = height * EMU_PER_PX;
	const id = Math.max(0, ...deep(doc, WP_NS, "docPr").map(d => Number(d.getAttribute("id")) || 0)) + 1;
	const xml = `<w:p xmlns:w="${W_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Imagen ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Imagen ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
	const picture = parseFragment(doc, xml);
	const fresh = doc.createElementNS(W_NS, "w:p");
	const anchor = ancestorNamed(node, W_NS, "tc") ? node : topLevelOf(node);
	anchor.after(picture);
	picture.after(fresh);
	session.touch(binding.part);
	session.onStructure?.({ node: fresh, offset: 0 });
}

/** Moves a paragraph's left indent a step in or out. */
export function changeIndent(session: OfficeSession, el: HTMLElement, direction: 1 | -1): void {
	const binding = session.bindingOf(el);
	if (!binding) return;
	const offset = caretOffset(el);
	session.checkpoint();
	const node = binding.node;
	const doc = node.ownerDocument;
	if (binding.dialect === "w") {
		const pPr = ensureWordPPr(node);
		let ind = kid(pPr, W_NS, "ind");
		if (!ind) { ind = doc.createElementNS(W_NS, "w:ind"); insertOrdered(pPr, ind, W_PPR_ORDER); }
		const next = Math.max(0, (wNum(ind, "left") ?? wNum(ind, "start") ?? 0) + direction * 360);
		ind.removeAttributeNS(W_NS, "start");
		ind.setAttributeNS(W_NS, "w:left", String(next));
	} else {
		let pPr = kid(node, A_NS, "pPr");
		if (!pPr) { pPr = doc.createElementNS(A_NS, "a:pPr"); node.insertBefore(pPr, node.firstChild); }
		pPr.setAttribute("marL", String(Math.max(0, (num(pPr, "marL") ?? 0) + direction * 457200)));
	}
	session.touch(binding.part);
	session.onStructure?.({ node, offset });
}

export interface OutlineEntry { text: string; level: number; el: HTMLElement }

/** The headings of a painted document, in order. */
export function documentOutline(root: HTMLElement): OutlineEntry[] {
	const out: OutlineEntry[] = [];
	for (const el of Array.from(root.querySelectorAll<HTMLElement>("p.notelens-office-para[data-level]"))) {
		const text = (el.textContent ?? "").trim();
		if (text) out.push({ text, level: Number(el.dataset.level), el });
	}
	return out;
}

export function countWords(root: HTMLElement): number {
	const text = Array.from(root.querySelectorAll("p.notelens-office-para")).map(p => p.textContent ?? "").join(" ");
	return text.split(/\s+/).filter(Boolean).length;
}

/** Selects the next (or previous) occurrence of a text in the paragraphs of a document. */
export function findText(root: HTMLElement, query: string, backwards = false): boolean {
	if (!query) return false;
	const needle = query.toLowerCase();
	const paragraphs = Array.from(root.querySelectorAll<HTMLElement>("p.notelens-office-para[contenteditable='true']"));
	if (!paragraphs.length) return false;
	const saved = saveSelection(root);
	let index = saved ? paragraphs.indexOf(saved.el) : -1;
	let from = saved ? (backwards ? saved.start : saved.end) : (backwards ? Infinity : 0);
	if (index < 0) index = backwards ? paragraphs.length - 1 : 0;
	for (let step = 0; step <= paragraphs.length; step++) {
		const el = paragraphs[(index + (backwards ? -step : step) + paragraphs.length * 2) % paragraphs.length];
		const text = (el.textContent ?? "").toLowerCase();
		const at = backwards ? text.lastIndexOf(needle, Math.min(from, text.length) - 1) : text.indexOf(needle, from);
		if (at >= 0 && (backwards ? at < from : true)) {
			el.focus({ preventScroll: true });
			placeCaret(el, at, at + needle.length);
			el.scrollIntoView({ block: "center" });
			return true;
		}
		from = backwards ? Infinity : 0;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Slides: objects you can select and move, shapes, pictures, layouts, order
// ---------------------------------------------------------------------------

export interface ShapeInfo { node: Element; part: string; frame: Frame; kind: "shape" | "picture" | "table"; text: boolean }
const shapeInfos = new WeakMap<HTMLElement, ShapeInfo>();
const shapeEls = new WeakMap<Element, HTMLElement>();

export function shapeInfoOf(el: HTMLElement | null): ShapeInfo | undefined {
	return el ? shapeInfos.get(el) : undefined;
}
export function shapeElementFor(node: Element): HTMLElement | null {
	return shapeEls.get(node) ?? null;
}

function registerShape(ctx: SlideCtx, el: HTMLElement, node: Element, frame: Frame, kind: ShapeInfo["kind"], text: boolean): void {
	if (!ctx.interactive) { el.addClass("is-decor"); return; }
	shapeInfos.set(el, { node, part: ctx.part, frame, kind, text });
	shapeEls.set(node, el);
	el.addClass("is-object");
}

function setChildren(doc: Document, parent: Element, ns: string, prefix: string, name: string, attrs: Record<string, string>): Element {
	let child = kid(parent, ns, name);
	if (!child) { child = doc.createElementNS(ns, `${prefix}:${name}`); parent.appendChild(child); }
	for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, v);
	return child;
}

/** Writes a new position and size into an object's XML. */
export function setShapeFrame(session: OfficeSession, el: HTMLElement, frame: Frame): void {
	const info = shapeInfos.get(el);
	if (!info) return;
	const doc = info.node.ownerDocument;
	let xfrm: Element;
	if (info.node.localName === "graphicFrame") {
		xfrm = kid(info.node, P_NS, "xfrm") ?? info.node.appendChild(doc.createElementNS(P_NS, "p:xfrm"));
	} else {
		let spPr = kid(info.node, P_NS, "spPr");
		if (!spPr) {
			spPr = doc.createElementNS(P_NS, "p:spPr");
			const nv = info.node.firstElementChild;
			if (nv) nv.after(spPr); else info.node.appendChild(spPr);
		}
		let existing = kid(spPr, A_NS, "xfrm");
		if (!existing) { existing = doc.createElementNS(A_NS, "a:xfrm"); spPr.insertBefore(existing, spPr.firstChild); }
		xfrm = existing;
	}
	setChildren(doc, xfrm, A_NS, "a", "off", { x: String(Math.round(frame.x)), y: String(Math.round(frame.y)) });
	setChildren(doc, xfrm, A_NS, "a", "ext", { cx: String(Math.round(Math.max(1, frame.cx))), cy: String(Math.round(Math.max(1, frame.cy))) });
	info.frame = { ...frame };
	session.touch(info.part);
}

export function removeShape(session: OfficeSession, el: HTMLElement): void {
	const info = shapeInfos.get(el);
	if (!info) return;
	session.checkpoint();
	info.node.remove();
	session.touch(info.part);
}

/** A copy of an object, a little down and to the right. */
export function duplicateShape(session: OfficeSession, el: HTMLElement): Element | null {
	const info = shapeInfos.get(el);
	const tree = info?.node.parentElement;
	if (!info || !tree) return null;
	session.checkpoint();
	const copy = info.node.cloneNode(true) as Element;
	const id = Math.max(1, ...deep(tree.ownerDocument, P_NS, "cNvPr").map(c => Number(c.getAttribute("id")) || 0)) + 1;
	deep(copy, P_NS, "cNvPr")[0]?.setAttribute("id", String(id));
	info.node.after(copy);
	session.touch(info.part);
	const shifted = { ...info.frame, x: info.frame.x + session.slideW * 0.03, y: info.frame.y + session.slideH * 0.04 };
	const dummy = { node: copy, part: info.part, frame: info.frame, kind: info.kind, text: info.text };
	const holder = createDiv();
	shapeInfos.set(holder, dummy);
	setShapeFrame(session, holder, shifted);
	return copy;
}

export function reorderShape(session: OfficeSession, el: HTMLElement, where: "front" | "back"): void {
	const info = shapeInfos.get(el);
	const tree = info?.node.parentElement;
	if (!info || !tree) return;
	session.checkpoint();
	if (where === "front") tree.appendChild(info.node);
	else {
		const firstShape = Array.from(tree.children).find(c => c.namespaceURI === P_NS && ["sp", "pic", "graphicFrame", "grpSp", "cxnSp"].includes(c.localName));
		if (firstShape) tree.insertBefore(info.node, firstShape);
	}
	session.touch(info.part);
}

const SP_PR_ORDER = ["xfrm", "custGeom", "prstGeom", "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "ln", "effectLst", "effectDag", "scene3d", "sp3d", "extLst"];

/** The fill colour of a shape, or none. */
export function setShapeFill(session: OfficeSession, el: HTMLElement, hex: string | null): void {
	const info = shapeInfos.get(el);
	if (!info || info.node.localName !== "sp") return;
	session.checkpoint();
	const doc = info.node.ownerDocument;
	let spPr = kid(info.node, P_NS, "spPr");
	if (!spPr) { spPr = doc.createElementNS(P_NS, "p:spPr"); info.node.firstElementChild?.after(spPr); }
	for (const name of ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"]) for (const old of kids(spPr, A_NS, name)) old.remove();
	const fill = hex ? doc.createElementNS(A_NS, "a:solidFill") : doc.createElementNS(A_NS, "a:noFill");
	if (hex) { const c = doc.createElementNS(A_NS, "a:srgbClr"); c.setAttribute("val", hex); fill.appendChild(c); }
	insertOrdered(spPr, fill, SP_PR_ORDER);
	session.touch(info.part);
}

/** A ready-made shape in the middle of a slide, with room for text in it. */
export function addShape(session: OfficeSession, index: number, geometry: string): Element | null {
	const part = session.slides[index];
	const doc = part ? session.xml(part) : null;
	const tree = deep(doc, P_NS, "spTree")[0];
	if (!part || !doc || !tree) return null;
	session.checkpoint();
	const id = Math.max(1, ...deep(doc, P_NS, "cNvPr").map(c => Number(c.getAttribute("id")) || 0)) + 1;
	const w = Math.round(session.slideW * 0.24), h = Math.round(geometry === "rightArrow" ? session.slideH * 0.18 : session.slideH * 0.3);
	const x = Math.round((session.slideW - w) / 2), y = Math.round((session.slideH - h) / 2);
	const xml = `<p:sp ${NS_DECL}><p:nvSpPr><p:cNvPr id="${id}" name="Forma ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="es-ES" sz="2000"/></a:p></p:txBody></p:sp>`;
	const shape = parseFragment(doc, xml);
	tree.appendChild(shape);
	session.touch(part);
	return shape;
}

/** A picture on a slide, no wider than most of it and centred. */
export function addPicture(session: OfficeSession, index: number, data: Uint8Array, ext: string, natural: { w: number; h: number }): Element | null {
	const part = session.slides[index];
	const doc = part ? session.xml(part) : null;
	const tree = deep(doc, P_NS, "spTree")[0];
	if (!part || !doc || !tree) return null;
	session.checkpoint();
	const rid = storePicture(session, "ppt", part, data, ext);
	if (!rid) return null;
	const ratio = (natural.w || 4) / (natural.h || 3);
	let w = Math.round(session.slideW * 0.6);
	let h = Math.round(w / ratio);
	if (h > session.slideH * 0.8) { h = Math.round(session.slideH * 0.8); w = Math.round(h * ratio); }
	const id = Math.max(1, ...deep(doc, P_NS, "cNvPr").map(c => Number(c.getAttribute("id")) || 0)) + 1;
	const xml = `<p:pic ${NS_DECL}><p:nvPicPr><p:cNvPr id="${id}" name="Imagen ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${Math.round((session.slideW - w) / 2)}" y="${Math.round((session.slideH - h) / 2)}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
	const picture = parseFragment(doc, xml);
	tree.appendChild(picture);
	session.touch(part);
	return picture;
}

/** A plain colour behind one slide (null puts the theme's own background back). */
export function setSlideBackground(session: OfficeSession, index: number, hex: string | null): void {
	const part = session.slides[index];
	const doc = part ? session.xml(part) : null;
	const cSld = deep(doc, P_NS, "cSld")[0];
	if (!part || !doc || !cSld) return;
	session.checkpoint();
	for (const old of kids(cSld, P_NS, "bg")) old.remove();
	if (hex) {
		const bg = parseFragment(doc, `<p:bg ${NS_DECL}><p:bgPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`);
		cSld.insertBefore(bg, cSld.firstChild);
	}
	session.touch(part);
}

export interface SlideLayout { path: string; name: string }

/** The layouts a deck offers for a new slide, by the name their author gave them. */
export function slideLayouts(session: OfficeSession): SlideLayout[] {
	const out: SlideLayout[] = [];
	const first = session.slides[0];
	const layoutOfFirst = first ? session.rels(first).find(r => r.type.endsWith("/slideLayout"))?.target : undefined;
	const masterPath = layoutOfFirst ? session.rels(layoutOfFirst).find(r => r.type.endsWith("/slideMaster"))?.target : undefined;
	const master = masterPath ? session.xml(masterPath) : null;
	if (!masterPath || !master) return out;
	const rels = session.rels(masterPath);
	for (const entry of deep(master, P_NS, "sldLayoutId")) {
		const rid = entry.getAttributeNS(R_NS, "id") ?? entry.getAttribute("r:id");
		const path = rels.find(r => r.id === rid)?.target;
		const layout = path ? session.xml(path) : null;
		if (path && layout) out.push({ path, name: deep(layout, P_NS, "cSld")[0]?.getAttribute("name") || path.split("/").pop() || path });
	}
	return out;
}

/** Puts a slide's XML into the deck after another slide, with the relationships it needs. */
function registerSlide(session: OfficeSession, after: number, xml: string, relsXml: string | null): number {
	const presentation = session.xml("ppt/presentation.xml");
	const relsPath = "ppt/_rels/presentation.xml.rels";
	const relsDoc = session.xml(relsPath);
	const types = session.xml("[Content_Types].xml");
	const list = deep(presentation, P_NS, "sldIdLst")[0];
	if (!presentation || !relsDoc || !types || !list) return -1;
	let n = 1;
	while (session.files[`ppt/slides/slide${n}.xml`]) n++;
	const path = `ppt/slides/slide${n}.xml`;
	session.addPart(path, xml);
	if (relsXml) session.addPart(`ppt/slides/_rels/slide${n}.xml.rels`, relsXml);
	const override = types.createElementNS(types.documentElement.namespaceURI, "Override");
	override.setAttribute("PartName", `/${path}`);
	override.setAttribute("ContentType", CT_SLIDE);
	types.documentElement.appendChild(override);
	session.touch("[Content_Types].xml");
	const used = new Set(Array.from(relsDoc.getElementsByTagName("Relationship")).map(r => r.getAttribute("Id")));
	let k = 1;
	while (used.has(`rId${k}`)) k++;
	const rid = `rId${k}`;
	const rel = relsDoc.createElementNS(relsDoc.documentElement.namespaceURI, "Relationship");
	rel.setAttribute("Id", rid);
	rel.setAttribute("Type", `${R_NS}/slide`);
	rel.setAttribute("Target", `slides/slide${n}.xml`);
	relsDoc.documentElement.appendChild(rel);
	session.touch(relsPath);
	const ids = deep(presentation, P_NS, "sldId").map(s => Number(s.getAttribute("id")) || 0);
	const entry = presentation.createElementNS(P_NS, "p:sldId");
	entry.setAttribute("id", String(Math.max(255, ...ids) + 1));
	entry.setAttributeNS(R_NS, "r:id", rid);
	const reference = kids(list, P_NS, "sldId")[after];
	if (reference) reference.after(entry); else list.appendChild(entry);
	session.touch("ppt/presentation.xml");
	session.slides.splice(after + 1, 0, path);
	return after + 1;
}

/** A new slide after another, on the layout given (or the layout of the one before). */
export function addSlide(session: OfficeSession, after: number, layoutPath?: string): number {
	session.checkpoint();
	const source = session.slides[Math.max(0, Math.min(after, session.slides.length - 1))];
	const layoutTarget = layoutPath ?? (source ? session.rels(source).find(r => r.type.endsWith("/slideLayout"))?.target ?? "" : "");
	const layoutDoc = layoutTarget ? session.xml(layoutTarget) : null;
	let id = 1;
	const shapes: string[] = [];
	for (const sp of deep(layoutDoc, P_NS, "sp")) {
		const ph = deep(sp, P_NS, "ph")[0];
		if (!ph) continue;
		const type = ph.getAttribute("type");
		if (type && ["dt", "ftr", "sldNum"].includes(type)) continue;
		const idx = ph.getAttribute("idx");
		id++;
		shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Marcador ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph${type ? ` type="${type}"` : ""}${idx ? ` idx="${idx}"` : ""}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="es-ES"/></a:p></p:txBody></p:sp>`);
	}
	const xml = `${XML_HEAD}<p:sld ${NS_DECL}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes.join("")}</p:spTree></p:cSld></p:sld>`;
	const rels = layoutTarget ? relationshipsXml([["rId1", "slideLayout", `../slideLayouts/${layoutTarget.split("/").pop()}`]]) : null;
	return registerSlide(session, after, xml, rels);
}

/** A copy of a slide right after it. */
export function duplicateSlide(session: OfficeSession, index: number): number {
	const part = session.slides[index];
	const doc = part ? session.xml(part) : null;
	if (!part || !doc) return -1;
	session.checkpoint();
	const relsPath = `ppt/slides/_rels/${part.split("/").pop()}.rels`;
	const relsDoc = session.xml(relsPath);
	const xml = `${XML_HEAD}${serializer.serializeToString(doc.documentElement)}`;
	const rels = relsDoc ? `${XML_HEAD}${serializer.serializeToString(relsDoc.documentElement)}` : null;
	return registerSlide(session, index, xml, rels);
}

/** Moves a slide to another place in the order. */
export function moveSlide(session: OfficeSession, from: number, to: number): boolean {
	const presentation = session.xml("ppt/presentation.xml");
	const list = deep(presentation, P_NS, "sldIdLst")[0];
	if (!list || to < 0 || to >= session.slides.length || from === to) return false;
	session.checkpoint();
	const entries = kids(list, P_NS, "sldId");
	const moving = entries[from];
	const target = entries[to];
	if (!moving || !target) return false;
	if (to > from) target.after(moving); else target.before(moving);
	const [slide] = session.slides.splice(from, 1);
	session.slides.splice(to, 0, slide);
	session.touch("ppt/presentation.xml");
	return true;
}

/** The address a hyperlink of a Word document points to, or null for a link inside the document. */
export function linkTarget(session: OfficeSession, link: string): string | null {
	if (!link.startsWith("r:")) return null;
	const url = session.rels(DOCX).find(r => r.id === link.slice(2))?.url ?? "";
	return /^(https?:|mailto:)/i.test(url) ? url : null;
}

// ---------------------------------------------------------------------------
// Slide transitions
// ---------------------------------------------------------------------------

export type TransitionKind = "none" | "fade" | "push" | "cover" | "wipe" | "zoom" | "split" | "dissolve";
/** The way the new slide moves: "l" is towards the left, so it arrives from the right. */
export type TransitionDir = "l" | "r" | "u" | "d";
export interface SlideTransition { kind: TransitionKind; dir: TransitionDir; ms: number }

const P14_NS = "http://schemas.microsoft.com/office/powerpoint/2010/main";
export const TRANSITION_SPEEDS: [string, number][] = [["Rápida", 350], ["Media", 700], ["Lenta", 1100]];
const NO_TRANSITION: SlideTransition = { kind: "none", dir: "l", ms: 700 };

/** The transition a slide plays as it comes on screen, read from the file; effects that have no match here fade. */
export function readTransition(session: OfficeSession, index: number): SlideTransition {
	const part = session.slides[index];
	const doc = part ? session.xml(part) : null;
	const el = deep(doc, P_NS, "transition")[0];
	if (!el) return { ...NO_TRANSITION };
	const effect = Array.from(el.children).find(c => !["sndAc"].includes(c.localName));
	const speed = el.getAttribute("spd");
	const p14 = Number(el.getAttributeNS(P14_NS, "dur") ?? el.getAttribute("p14:dur"));
	const ms = Number.isFinite(p14) && p14 > 0 ? p14 : speed === "fast" ? 350 : speed === "slow" ? 1100 : 700;
	const dirAttr = effect?.getAttribute("dir");
	const dir: TransitionDir = dirAttr === "r" || dirAttr === "u" || dirAttr === "d" ? dirAttr : "l";
	const name = effect?.localName ?? "";
	let kind: TransitionKind;
	if (!effect) kind = "fade";
	else if (name === "fade") kind = "fade";
	else if (name === "push") kind = "push";
	else if (name === "cover" || name === "pull") kind = "cover";
	else if (name === "wipe") kind = "wipe";
	else if (name === "zoom") kind = "zoom";
	else if (name === "split" || name === "blinds" || name === "strips") kind = "split";
	else if (name === "dissolve" || name === "randomBar" || name === "checker") kind = "dissolve";
	else kind = "fade";
	return { kind, dir, ms };
}

/** Gives a slide a transition (or takes it away), or the same one to every slide. */
export function setTransition(session: OfficeSession, index: number, transition: SlideTransition, all = false): void {
	session.checkpoint();
	const targets = all ? session.slides.map((_, i) => i) : [index];
	for (const i of targets) {
		const part = session.slides[i];
		const doc = part ? session.xml(part) : null;
		const root = doc?.documentElement;
		if (!part || !doc || !root) continue;
		for (const old of deep(doc, P_NS, "transition")) {
			// A transition PowerPoint 2010 wrote sits in a compatibility wrapper that goes with it.
			let holder: Element = old;
			while (holder.parentElement && holder.parentElement !== root) holder = holder.parentElement;
			holder.remove();
		}
		if (transition.kind !== "none") {
			const speed = transition.ms < 500 ? "fast" : transition.ms > 900 ? "slow" : "med";
			const dir = transition.dir;
			const effect: Record<Exclude<TransitionKind, "none">, string> = {
				fade: "<p:fade/>", dissolve: "<p:dissolve/>", zoom: '<p:zoom dir="in"/>', split: '<p:split orient="vert" dir="out"/>',
				push: `<p:push dir="${dir}"/>`, cover: `<p:cover dir="${dir}"/>`, wipe: `<p:wipe dir="${dir}"/>`
			};
			const el = parseFragment(doc, `<p:transition ${NS_DECL} spd="${speed}">${effect[transition.kind]}</p:transition>`);
			const before = kids(root, P_NS, "timing")[0] ?? kids(root, P_NS, "extLst")[0] ?? null;
			root.insertBefore(el, before);
		}
		session.touch(part);
	}
}
