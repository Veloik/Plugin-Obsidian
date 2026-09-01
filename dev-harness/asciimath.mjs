function looksLikeLatex(src) {
  return /\\[a-zA-Z]+|\\\\|\\[{}()[\]]/.test(src);
}
const GREEK = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "varepsilon",
  "zeta",
  "eta",
  "theta",
  "vartheta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "pi",
  "rho",
  "sigma",
  "tau",
  "upsilon",
  "phi",
  "varphi",
  "chi",
  "psi",
  "omega",
  "Gamma",
  "Delta",
  "Theta",
  "Lambda",
  "Xi",
  "Pi",
  "Sigma",
  "Phi",
  "Psi",
  "Omega"
];
const SYMBOLS = {
  oo: "\\infty",
  inf: "\\infty",
  infty: "\\infty",
  infinity: "\\infty",
  "+-": "\\pm",
  "-+": "\\mp",
  "->": "\\to",
  "=>": "\\Rightarrow",
  "<=>": "\\Leftrightarrow",
  "<=": "\\le",
  ">=": "\\ge",
  "!=": "\\ne",
  "~=": "\\approx",
  "~~": "\\approx",
  "==": "\\equiv",
  "...": "\\ldots",
  "*": "\\cdot",
  "**": "\\ast",
  xx: "\\times",
  "-:": "\\div",
  sum: "\\sum",
  prod: "\\prod",
  int: "\\int",
  oint: "\\oint",
  lim: "\\lim",
  del: "\\partial",
  partial: "\\partial",
  grad: "\\nabla",
  nabla: "\\nabla",
  in: "\\in",
  notin: "\\notin",
  sub: "\\subset",
  sup: "\\supset",
  uu: "\\cup",
  nn: "\\cap",
  and: "\\land",
  or: "\\lor",
  not: "\\neg",
  AA: "\\forall",
  EE: "\\exists",
  RR: "\\mathbb{R}",
  NN: "\\mathbb{N}",
  ZZ: "\\mathbb{Z}",
  QQ: "\\mathbb{Q}",
  CC: "\\mathbb{C}",
  deg: "^{\\circ}",
  "%": "\\%",
  "|": "|",
  prop: "\\propto",
  perp: "\\perp",
  parallel: "\\parallel",
  angle: "\\angle",
  therefore: "\\therefore",
  because: "\\because",
  hbar: "\\hbar",
  ell: "\\ell",
  emptyset: "\\emptyset",
  cdots: "\\cdots",
  vdots: "\\vdots",
  ddots: "\\ddots"
};
const FUNCTIONS = ["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "ln", "log", "exp", "det", "dim", "max", "min", "gcd", "lcm", "mod", "sup", "inf", "arg"];
const UNARY = { sqrt: "\\sqrt", abs: "abs", vec: "\\vec", hat: "\\hat", bar: "\\bar", dot: "\\dot", ddot: "\\ddot", tilde: "\\tilde", ul: "\\underline", bb: "\\mathbf", cal: "\\mathcal", floor: "floor", ceil: "ceil", norm: "norm" };
const BINARY = { frac: "frac", root: "root", overset: "overset", underset: "underset", color: "color" };
const MULTI_OPS = ["<=>", "+-", "-+", "->", "=>", "<=", ">=", "!=", "~=", "~~", "==", "...", "**", "-:"];
function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      const text = end === -1 ? src.slice(i + 1) : src.slice(i + 1, end);
      out.push({ kind: "text", value: text });
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ kind: "num", value: num[0] });
      i += num[0].length;
      continue;
    }
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
      let w = word[0];
      while (w.length > 1 && !(w in SYMBOLS) && !GREEK.includes(w) && !FUNCTIONS.includes(w) && !(w in UNARY) && !(w in BINARY) && w !== "text" && w !== "matrix")
        w = w.slice(0, -1);
      out.push({ kind: "id", value: w });
      i += w.length;
      continue;
    }
    const multi = MULTI_OPS.find((op) => src.startsWith(op, i));
    if (multi) {
      out.push({ kind: "op", value: multi });
      i += multi.length;
      continue;
    }
    if ("([{".includes(ch)) {
      out.push({ kind: "open", value: ch });
      i++;
      continue;
    }
    if (")]}".includes(ch)) {
      out.push({ kind: "close", value: ch });
      i++;
      continue;
    }
    if (ch === ",") {
      out.push({ kind: "comma", value: "," });
      i++;
      continue;
    }
    out.push({ kind: "op", value: ch });
    i++;
  }
  return out;
}
class Converter {
  constructor(toks) {
    this.toks = toks;
    this.pos = 0;
  }
  convert() {
    return this.sequence(() => this.pos >= this.toks.length);
  }
  peek() {
    return this.toks[this.pos];
  }
  take() {
    return this.toks[this.pos++];
  }
  /** A run of expressions until `stop` says so (end of input, closing bracket or comma). */
  sequence(stop) {
    const parts = [];
    while (!stop() && this.pos < this.toks.length) {
      const t = this.peek();
      if (t.kind === "close" || t.kind === "comma")
        break;
      parts.push(this.fraction());
    }
    return parts.join(" ");
  }
  /** intermediate ('/' intermediate)* — a/b becomes \frac{a}{b}. */
  fraction() {
    let left = this.intermediate();
    while (this.peek()?.kind === "op" && this.peek().value === "/") {
      this.take();
      const right = this.intermediate();
      left = `\\frac{${strip(left)}}{${strip(right)}}`;
    }
    return left;
  }
  /** simple with optional _sub and ^sup, in either order. */
  intermediate() {
    let base = this.simple();
    let sub = null;
    let sup = null;
    for (let i = 0; i < 2; i++) {
      const t = this.peek();
      if (t?.kind === "op" && t.value === "_" && sub === null) {
        this.take();
        sub = strip(this.simple());
      } else if (t?.kind === "op" && t.value === "^" && sup === null) {
        this.take();
        sup = strip(this.simple());
      } else
        break;
    }
    if (sub !== null)
      base += `_{${sub}}`;
    if (sup !== null)
      base += `^{${sup}}`;
    return base;
  }
  simple() {
    const t = this.take();
    if (!t)
      return "";
    switch (t.kind) {
      case "num":
        return t.value;
      case "text":
        return `\\text{${t.value}}`;
      case "comma":
        return ",";
      case "open":
        return this.group(t.value);
      case "close":
        return "";
      case "op":
        return SYMBOLS[t.value] ?? (t.value === "'" ? "'" : escapeOp(t.value));
      case "id":
        return this.word(t.value);
    }
  }
  word(w) {
    if (w in SYMBOLS)
      return SYMBOLS[w];
    if (GREEK.includes(w))
      return `\\${w}`;
    if (FUNCTIONS.includes(w)) {
      const next = this.peek();
      const bindable = next && (next.kind === "open" || next.kind === "num" || next.kind === "id" && !(next.value in SYMBOLS) && !FUNCTIONS.includes(next.value));
      return bindable ? `\\${w} ${this.simple()}` : `\\${w}`;
    }
    if (w === "text") {
      const next = this.peek();
      if (next?.kind === "open") {
        this.take();
        return `\\text{${this.rawUntilClose(next.value)}}`;
      }
      return "\\text";
    }
    if (w in UNARY) {
      const arg = strip(this.simple());
      switch (UNARY[w]) {
        case "abs":
          return `\\left|${arg}\\right|`;
        case "norm":
          return `\\left\\|${arg}\\right\\|`;
        case "floor":
          return `\\left\\lfloor ${arg}\\right\\rfloor`;
        case "ceil":
          return `\\left\\lceil ${arg}\\right\\rceil`;
        default:
          return `${UNARY[w]}{${arg}}`;
      }
    }
    if (w in BINARY) {
      const a = strip(this.simple());
      const b = strip(this.simple());
      switch (w) {
        case "frac":
          return `\\frac{${a}}{${b}}`;
        case "root":
          return `\\sqrt[${a}]{${b}}`;
        case "overset":
          return `\\overset{${a}}{${b}}`;
        case "underset":
          return `\\underset{${a}}{${b}}`;
        default:
          return `\\textcolor{${a}}{${b}}`;
      }
    }
    return w;
  }
  /** Bracketed group; [[a,b],[c,d]] becomes a matrix. */
  group(open) {
    const close = open === "(" ? ")" : open === "[" ? "]" : "}";
    if (open === "[" && this.peek()?.kind === "open" && this.peek().value === "[") {
      const rows = [];
      while (this.peek()?.kind === "open" && this.peek().value === "[") {
        this.take();
        const cells = [];
        for (; ; ) {
          cells.push(this.sequence(() => false));
          if (this.peek()?.kind === "comma") {
            this.take();
            continue;
          }
          break;
        }
        if (this.peek()?.kind === "close")
          this.take();
        rows.push(cells);
        if (this.peek()?.kind === "comma")
          this.take();
      }
      if (this.peek()?.kind === "close")
        this.take();
      return `\\begin{pmatrix} ${rows.map((r) => r.join(" & ")).join(" \\\\ ")} \\end{pmatrix}`;
    }
    const parts = [];
    for (; ; ) {
      parts.push(this.sequence(() => false));
      if (this.peek()?.kind === "comma") {
        this.take();
        parts.push(",");
        continue;
      }
      break;
    }
    if (this.peek()?.kind === "close")
      this.take();
    const inner = parts.join(" ").replace(/\s+,\s+/g, ", ");
    if (open === "{")
      return `\\{${inner}\\}`;
    const l = open === "(" ? "(" : "[";
    return `\\left${l}${inner}\\right${close === ")" ? ")" : "]"}`;
  }
  rawUntilClose(open) {
    const close = open === "(" ? ")" : open === "[" ? "]" : "}";
    const words = [];
    while (this.pos < this.toks.length) {
      const t = this.take();
      if (t.kind === "close" && t.value === close)
        break;
      words.push(t.value);
    }
    return words.join(" ");
  }
}
function strip(value) {
  const m = /^\\left\((.*)\\right\)$/.exec(value.trim());
  return m ? m[1].trim() : value.trim();
}
function escapeOp(op) {
  if (op === "&")
    return "\\&";
  if (op === "#")
    return "\\#";
  if (op === "$")
    return "\\$";
  if (op === "_" || op === "^")
    return "";
  return op;
}
function asciiToLatex(src) {
  const text = src.trim();
  if (!text)
    return "";
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => new Converter(tokenize(line)).convert()).join(" \\\\ ");
}
function toRenderableLatex(src) {
  return looksLikeLatex(src) ? src : asciiToLatex(src);
}
export {
  asciiToLatex,
  looksLikeLatex,
  toRenderableLatex
};
