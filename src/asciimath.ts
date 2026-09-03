/**
 * Offline conversion of easy-to-type math notation into LaTeX, in the spirit
 * of AsciiMath: `x^2/2 + sqrt(x)`, `sum_(i=1)^n i`, `int_0^1 x^2 dx`,
 * `lim_(x->oo) 1/x`, `[[a,b],[c,d]]`, `((n),(k))`, `{(x, x>=0), (-x, x<0):}`.
 * Symbols typed from a maths keyboard (π, √, ∫, ≤, →, ∞, α…) are read as
 * their spelled-out forms. Anything that already looks like LaTeX is left
 * alone by the caller.
 */

export function looksLikeLatex(src: string): boolean {
	return /\\[a-zA-Z]+|\\\\|\\[{}()[\]]|[_^]\s*\{/.test(src);
}

const GREEK = ["alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
	"Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega"];

const SYMBOLS: Record<string, string> = {
	oo: "\\infty", inf: "\\infty", infty: "\\infty", infinity: "\\infty",
	"+-": "\\pm", "-+": "\\mp", "->": "\\to", "=>": "\\Rightarrow", "<=>": "\\Leftrightarrow", "<=": "\\le", ">=": "\\ge", "!=": "\\ne",
	"~=": "\\approx", "~~": "\\approx", "==": "\\equiv", ":=": ":=", "...": "\\ldots", "*": "\\cdot", "**": "\\ast", xx: "\\times", "-:": "\\div",
	sum: "\\sum", prod: "\\prod", int: "\\int", oint: "\\oint", lim: "\\lim", del: "\\partial", partial: "\\partial", grad: "\\nabla", nabla: "\\nabla",
	in: "\\in", notin: "\\notin", sub: "\\subset", sup: "\\supset", uu: "\\cup", nn: "\\cap", and: "\\land", or: "\\lor", not: "\\neg",
	AA: "\\forall", EE: "\\exists", RR: "\\mathbb{R}", NN: "\\mathbb{N}", ZZ: "\\mathbb{Z}", QQ: "\\mathbb{Q}", CC: "\\mathbb{C}",
	deg: "^{\\circ}", "%": "\\%", prop: "\\propto", perp: "\\perp", parallel: "\\parallel", angle: "\\angle", therefore: "\\therefore", because: "\\because",
	hbar: "\\hbar", ell: "\\ell", emptyset: "\\emptyset", cdots: "\\cdots", vdots: "\\vdots", ddots: "\\ddots", ohm: "\\Omega"
};

/** Characters a maths keyboard produces, read as the words above. */
const UNICODE: Record<string, string> = {
	"π": " pi ", "√": " sqrt ", "∫": " int ", "∮": " oint ", "∑": " sum ", "∏": " prod ", "∞": " oo ",
	"≤": " <= ", "≥": " >= ", "≠": " != ", "≈": " ~= ", "≡": " == ", "→": " -> ", "⇒": " => ", "⇔": " <=> ", "↔": " <=> ",
	"±": " +- ", "∓": " -+ ", "×": " xx ", "·": " * ", "⋅": " * ", "∙": " * ", "÷": " -: ", "−": " - ", "–": " - ",
	"∂": " del ", "∇": " grad ", "∈": " in ", "∉": " notin ", "⊂": " sub ", "⊃": " sup ", "∪": " uu ", "∩": " nn ",
	"∀": " AA ", "∃": " EE ", "ℝ": " RR ", "ℕ": " NN ", "ℤ": " ZZ ", "ℚ": " QQ ", "ℂ": " CC ", "∅": " emptyset ",
	"…": " ... ", "′": "'", "″": "''", "°": " deg ", "∠": " angle ", "⊥": " perp ", "∥": " parallel ", "∝": " prop ",
	"ℓ": " ell ", "ħ": " hbar ", "∴": " therefore ", "∵": " because ", "¬": " not ", "∧": " and ", "∨": " or ",
	"α": " alpha ", "β": " beta ", "γ": " gamma ", "δ": " delta ", "ε": " epsilon ", "ζ": " zeta ", "η": " eta ", "θ": " theta ",
	"ι": " iota ", "κ": " kappa ", "λ": " lambda ", "μ": " mu ", "ν": " nu ", "ξ": " xi ", "ρ": " rho ", "σ": " sigma ",
	"τ": " tau ", "υ": " upsilon ", "φ": " phi ", "ϕ": " phi ", "χ": " chi ", "ψ": " psi ", "ω": " omega ",
	"Γ": " Gamma ", "Δ": " Delta ", "Θ": " Theta ", "Λ": " Lambda ", "Ξ": " Xi ", "Π": " Pi ", "Σ": " Sigma ", "Φ": " Phi ", "Ψ": " Psi ", "Ω": " Omega "
};

/** Combining marks typed over a letter (x̄, x̂, ẋ, x⃗) become the matching accent. */
const COMBINING: Record<string, string> = { "̄": "bar", "̅": "bar", "̂": "hat", "̇": "dot", "̈": "ddot", "̃": "tilde", "⃗": "vec" };

const FUNCTIONS = ["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "ln", "log", "exp", "det", "dim", "max", "min", "gcd", "lcm", "mod", "sup", "inf", "arg"];
const UNARY: Record<string, string> = { sqrt: "\\sqrt", abs: "abs", vec: "\\vec", hat: "\\hat", bar: "\\bar", dot: "\\dot", ddot: "\\ddot", tilde: "\\tilde", ul: "\\underline", bb: "\\mathbf", cal: "\\mathcal", floor: "floor", ceil: "ceil", norm: "norm" };
const BINARY: Record<string, string> = { frac: "frac", root: "root", overset: "overset", underset: "underset", color: "color" };

type Tok = { kind: "num" | "id" | "op" | "text" | "open" | "close" | "comma"; value: string };

const MULTI_OPS = ["<=>", "+-", "-+", "->", "=>", "<=", ">=", "!=", "~=", "~~", "==", ":=", "...", "**", "-:"];

function isKnownWord(w: string): boolean {
	return w in SYMBOLS || GREEK.includes(w) || FUNCTIONS.includes(w) || w in UNARY || w in BINARY || w === "text" || w === "matrix";
}

/** dx, dt, dθ… stay whole so d/dx and dy/dx become the fractions people mean. */
function isDifferential(w: string): boolean {
	return w.length === 2 && w[0] === "d" && /[a-zA-Z]/.test(w[1]) && !isKnownWord(w);
}

const SUPERSCRIPTS = "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079\u207a\u207b\u207f\u2071";
const SUBSCRIPTS = "\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089\u208a\u208b";
const SUPER_TO_ASCII = "0123456789+-ni";
const SUB_TO_ASCII = "0123456789+-";

function normalize(src: string): string {
	let out = src
		.replace(new RegExp(`[${SUPERSCRIPTS}]+`, "g"), run => `^(${[...run].map(ch => SUPER_TO_ASCII[SUPERSCRIPTS.indexOf(ch)]).join("")})`)
		.replace(new RegExp(`[${SUBSCRIPTS}]+`, "g"), run => `_(${[...run].map(ch => SUB_TO_ASCII[SUBSCRIPTS.indexOf(ch)]).join("")})`);
	for (const [mark, accent] of Object.entries(COMBINING)) {
		out = out.replace(new RegExp(`([A-Za-z])${mark}`, "g"), ` ${accent} $1 `);
	}
	return out.replace(/[^\x00-\x7f]/g, ch => UNICODE[ch] ?? ch);
}

function tokenize(src: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		if (/\s/.test(ch)) { i++; continue; }
		if (ch === '"') {
			const end = src.indexOf('"', i + 1);
			const text = end === -1 ? src.slice(i + 1) : src.slice(i + 1, end);
			out.push({ kind: "text", value: text });
			i = end === -1 ? src.length : end + 1;
			continue;
		}
		const num = /^\d+(\.\d+)?/.exec(src.slice(i));
		if (num) { out.push({ kind: "num", value: num[0] }); i += num[0].length; continue; }
		const textCall = /^text\s*([([{])/.exec(src.slice(i));
		if (textCall) {
			const close = textCall[1] === "(" ? ")" : textCall[1] === "[" ? "]" : "}";
			const start = i + textCall[0].length;
			const end = src.indexOf(close, start);
			out.push({ kind: "text", value: end === -1 ? src.slice(start) : src.slice(start, end) });
			i = end === -1 ? src.length : end + 1;
			continue;
		}
		const word = /^[a-zA-Z]+/.exec(src.slice(i));
		if (word) {
			// Longest known word first, else split single letters (so "ab" is a·b and "pi" stays pi).
			let w = word[0];
			while (w.length > 1 && !isKnownWord(w) && !isDifferential(w)) w = w.slice(0, -1);
			out.push({ kind: "id", value: w });
			i += w.length;
			continue;
		}
		const multi = MULTI_OPS.find(op => src.startsWith(op, i));
		if (multi) { out.push({ kind: "op", value: multi }); i += multi.length; continue; }
		if ("([{".includes(ch)) { out.push({ kind: "open", value: ch }); i++; continue; }
		if (")]}".includes(ch)) { out.push({ kind: "close", value: ch }); i++; continue; }
		if (ch === ",") { out.push({ kind: "comma", value: "," }); i++; continue; }
		out.push({ kind: "op", value: ch });
		i++;
	}
	return out;
}

class Converter {
	private pos = 0;
	constructor(private toks: Tok[]) {}

	/** The whole line: expressions separated by commas, stray closers kept as text. */
	convert(): string {
		const parts: string[] = [];
		while (this.pos < this.toks.length) {
			const chunk = this.sequence(() => false);
			if (chunk) parts.push(chunk);
			const t = this.peek();
			if (t?.kind === "comma") { this.take(); parts.push(","); }
			else if (t?.kind === "close") { this.take(); parts.push(t.value === "}" ? "\\}" : t.value); }
		}
		return tidy(parts.join(" "));
	}

	private peek(offset = 0): Tok | undefined { return this.toks[this.pos + offset]; }
	private take(): Tok { return this.toks[this.pos++]; }
	private peekIsOp(value: string, offset = 0): boolean {
		const t = this.peek(offset);
		return t?.kind === "op" && t.value === value;
	}

	/** A run of expressions until `stop` says so (end of input, closing bracket or comma). */
	private sequence(stop: () => boolean): string {
		const parts: string[] = [];
		while (!stop() && this.pos < this.toks.length) {
			const t = this.peek()!;
			if (t.kind === "close" || t.kind === "comma") break;
			parts.push(this.fraction());
		}
		return parts.join(" ");
	}

	/** intermediate ('/' intermediate)* — a/b becomes \frac{a}{b}. */
	private fraction(): string {
		let left = this.intermediate();
		while (this.peekIsOp("/")) {
			this.take();
			const right = this.intermediate();
			left = `\\frac{${strip(left)}}{${strip(right)}}`;
		}
		return left;
	}

	/** simple with optional _sub and ^sup, in either order. */
	private intermediate(): string {
		let base = this.simple();
		let sub: string | null = null;
		let sup: string | null = null;
		for (let i = 0; i < 2; i++) {
			if (this.peekIsOp("_") && sub === null) { this.take(); sub = this.script(); }
			else if (this.peekIsOp("^") && sup === null) { this.take(); sup = this.script(); }
			else break;
		}
		if (sub !== null) base += `_{${sub}}`;
		if (sup !== null) base += `^{${sup}}`;
		return base;
	}

	/** Argument of ^ or _: a sign in front travels with it, so e^-x is e^{-x}. */
	private script(): string {
		let sign = "";
		if (this.peekIsOp("-") || this.peekIsOp("+")) sign = this.take().value;
		return sign + strip(this.simple());
	}

	private simple(): string {
		const t = this.take();
		if (!t) return "";
		switch (t.kind) {
			case "num": return t.value;
			case "text": return this.spacedText(t.value);
			case "comma": return ",";
			case "open": return this.group(t.value);
			case "close": return "";
			case "op":
				if (t.value === "|") return this.bars();
				return SYMBOLS[t.value] ?? (t.value === "'" ? "'" : escapeOp(t.value));
			case "id": return this.word(t.value);
		}
	}

	/** Words need air around them in maths mode, where the source spaces vanish. */
	private spacedText(value: string): string {
		const next = this.peek();
		const followed = next && next.kind !== "close" && next.kind !== "comma";
		return `\\text{${value}}${followed ? "\\;" : ""}`;
	}

	/**
	 * A `|` opens an absolute value when it follows nothing, an operator, a
	 * bracket or a comma, and closes one when it follows an operand; that is how
	 * | |x| - 1 | nests and |x| + |y| pairs up, while {x | x > 0} stays a bar.
	 */
	private bars(): string {
		if (this.barCloses(this.pos - 1)) return "|";
		const inner = this.sequence(() => this.peekIsOp("|") && this.barCloses(this.pos));
		if (this.peekIsOp("|")) { this.take(); return `\\left|${inner}\\right|`; }
		return `\\left|${inner}\\right.`;
	}

	private barCloses(index: number): boolean {
		const prev = this.toks[index - 1];
		return !!prev && prev.kind !== "op" && prev.kind !== "open" && prev.kind !== "comma";
	}

	private word(w: string): string {
		if (w in SYMBOLS) return SYMBOLS[w];
		if (GREEK.includes(w)) return `\\${w}`;
		if (FUNCTIONS.includes(w)) {
			// sin(x) and sin x bind their argument, so sin(x)/cos(x) divides whole terms.
			const next = this.peek();
			const bindable = next && (next.kind === "open" || next.kind === "num" || (next.kind === "id" && !(next.value in SYMBOLS) && !FUNCTIONS.includes(next.value)));
			return bindable ? `\\${w} ${this.simple()}` : `\\${w}`;
		}
		if (w === "text") {
			const next = this.peek();
			if (next?.kind === "open") { this.take(); return this.spacedText(this.rawUntilClose(next.value)); }
			return "\\text";
		}
		if (w in UNARY) {
			const arg = strip(this.simple());
			switch (UNARY[w]) {
				case "abs": return `\\left|${arg}\\right|`;
				case "norm": return `\\left\\|${arg}\\right\\|`;
				case "floor": return `\\left\\lfloor ${arg}\\right\\rfloor`;
				case "ceil": return `\\left\\lceil ${arg}\\right\\rceil`;
				default: return `${UNARY[w]}{${arg}}`;
			}
		}
		if (w in BINARY) {
			const a = strip(this.simple());
			const b = strip(this.simple());
			switch (w) {
				case "frac": return `\\frac{${a}}{${b}}`;
				case "root": return `\\sqrt[${a}]{${b}}`;
				case "overset": return `\\overset{${a}}{${b}}`;
				case "underset": return `\\underset{${a}}{${b}}`;
				default: return `\\textcolor{${a}}{${b}}`;
			}
		}
		return w;
	}

	/** Cells separated by commas up to a closing bracket, which is consumed. */
	private cells(): string[] {
		const cells: string[] = [];
		for (;;) {
			cells.push(this.sequence(() => false));
			if (this.peek()?.kind === "comma") { this.take(); continue; }
			break;
		}
		if (this.peek()?.kind === "close") this.take();
		return cells;
	}

	/** Bracketed group; [[a,b],[c,d]] is a matrix, ((n),(k)) a binomial, {(a,b),(c,d):} cases. */
	private group(open: string): string {
		if (open === "[" && this.peek()?.kind === "open" && this.peek()!.value === "[") {
			const rows: string[][] = [];
			while (this.peek()?.kind === "open" && this.peek()!.value === "[") {
				this.take();
				rows.push(this.cells());
				if (this.peek()?.kind === "comma") this.take();
			}
			if (this.peek()?.kind === "close") this.take();
			return `\\begin{pmatrix} ${rows.map(r => r.join(" & ")).join(" \\\\ ")} \\end{pmatrix}`;
		}
		if (open === "{" && this.peek()?.kind === "open" && this.peek()!.value === "(") {
			const rows: string[][] = [];
			while (this.peek()?.kind === "open" && this.peek()!.value === "(") {
				this.take();
				rows.push(this.cells());
				if (this.peek()?.kind === "comma") this.take();
			}
			const cases = this.peekIsOp(":") && this.peek(1)?.kind === "close";
			if (cases) this.take();
			if (this.peek()?.kind === "close") this.take();
			if (cases) return `\\begin{cases} ${rows.map(r => r.join(" & ")).join(" \\\\ ")} \\end{cases}`;
			return `\\{${rows.map(r => `\\left(${r.join(", ")}\\right)`).join(", ")}\\}`;
		}
		const parts: string[] = [];
		for (;;) {
			parts.push(this.sequence(() => false));
			if (this.peek()?.kind === "comma") { this.take(); parts.push(","); continue; }
			break;
		}
		// The bracket that actually closes the group: [0, 1) keeps its round end.
		const closer = this.peek()?.kind === "close" ? this.take().value : "";
		if (open === "(" && parts.length === 3 && parts[1] === "," && isParenthesised(parts[0]) && isParenthesised(parts[2])) {
			return `\\binom{${strip(parts[0])}}{${strip(parts[2])}}`;
		}
		const inner = parts.join(" ").replace(/\s+,\s+/g, ", ");
		if (open === "{" && (closer === "}" || closer === "")) return `\\{${inner}\\}`;
		const left = open === "(" ? "(" : open === "[" ? "[" : "\\{";
		const right = closer === ")" ? ")" : closer === "]" ? "]" : closer === "}" ? "\\}" : ".";
		return `\\left${left}${inner}\\right${right}`;
	}

	private rawUntilClose(open: string): string {
		const close = open === "(" ? ")" : open === "[" ? "]" : "}";
		const words: string[] = [];
		while (this.pos < this.toks.length) {
			const t = this.take();
			if (t.kind === "close" && t.value === close) break;
			words.push(t.value);
		}
		return words.join(" ");
	}
}

function isParenthesised(value: string): boolean {
	return /^\\left\(.*\\right\)$/.test(value.trim());
}

/** Removes a \left(…\right) wrapper so \frac{}{} and ^{} arguments stay clean. */
function strip(value: string): string {
	const m = /^\\left\((.*)\\right\)$/.exec(value.trim());
	return m ? m[1].trim() : value.trim();
}

/** Primes and factorials sit on their operand; a comma hugs what precedes it. */
function tidy(value: string): string {
	return value.replace(/\s+(['!])/g, "$1").replace(/\s+,/g, ",").replace(/,(?=\S)/g, ", ");
}

function escapeOp(op: string): string {
	if (op === "&") return "\\&";
	if (op === "#") return "\\#";
	if (op === "$") return "\\$";
	if (op === "_" || op === "^") return "";
	return op;
}

export function asciiToLatex(src: string): string {
	const text = normalize(src).trim();
	if (!text) return "";
	// Line breaks become LaTeX line breaks so multi-line input renders as several lines.
	return text.split(/\r?\n/).filter(line => line.trim()).map(line => new Converter(tokenize(line)).convert()).join(" \\\\ ");
}

/** LaTeX to render for user input: pass through real LaTeX, convert the easy notation otherwise. */
export function toRenderableLatex(src: string): string {
	return looksLikeLatex(src) ? src : asciiToLatex(src);
}
