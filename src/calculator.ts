import { setIcon } from "obsidian";
import { makeDraggable } from "./panels";

/**
 * Scientific calculator engine and panel. The engine compiles expressions
 * into closures, which makes variables, `a = 5` assignments, percentages,
 * unit conversions, statistics over lists, sums and products with an index,
 * numeric integrals and derivatives, and equation solving possible without
 * ever touching eval.
 */

export type AngleUnit = "deg" | "rad";

interface Env {
	unit: AngleUnit;
	ans: number;
	vars: Map<string, number>;
	memory: number;
}

type Fn = (env: Env) => number;

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

function toRad(x: number, unit: AngleUnit): number { return unit === "deg" ? x * Math.PI / 180 : x; }
function fromRad(x: number, unit: AngleUnit): number { return unit === "deg" ? x * 180 / Math.PI : x; }
function gcd(a: number, b: number): number { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
function factorial(n: number): number {
	if (n < 0 || !Number.isFinite(n)) return NaN;
	if (n > 170) return Infinity;
	if (Number.isInteger(n)) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
	return gamma(n + 1);
}
/** Lanczos approximation so 0.5! and friends also work. */
function gamma(z: number): number {
	const g = 7;
	const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
	if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
	z -= 1;
	let x = c[0];
	for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
	const t = z + g + 0.5;
	return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
function isPrime(n: number): boolean {
	if (!Number.isInteger(n) || n < 2) return false;
	for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
	return true;
}
function median(values: number[]): number {
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(values: number[]): number { return values.reduce((n, v) => n + v, 0) / values.length; }
function variance(values: number[], sample: boolean): number {
	const m = mean(values);
	return values.reduce((n, v) => n + (v - m) ** 2, 0) / Math.max(1, values.length - (sample ? 1 : 0));
}
function mode(values: number[]): number {
	const counts = new Map<number, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	let best = values[0], bestCount = 0;
	for (const [v, count] of counts) if (count > bestCount) { best = v; bestCount = count; }
	return best;
}

const FUNCTIONS: Record<string, (args: number[], env: Env) => number> = {
	sin: ([x], e) => Math.sin(toRad(x, e.unit)), cos: ([x], e) => Math.cos(toRad(x, e.unit)), tan: ([x], e) => Math.tan(toRad(x, e.unit)),
	asin: ([x], e) => fromRad(Math.asin(x), e.unit), acos: ([x], e) => fromRad(Math.acos(x), e.unit), atan: ([x], e) => fromRad(Math.atan(x), e.unit),
	atan2: ([y, x], e) => fromRad(Math.atan2(y, x), e.unit),
	sec: ([x], e) => 1 / Math.cos(toRad(x, e.unit)), csc: ([x], e) => 1 / Math.sin(toRad(x, e.unit)), cot: ([x], e) => 1 / Math.tan(toRad(x, e.unit)),
	sinh: ([x]) => Math.sinh(x), cosh: ([x]) => Math.cosh(x), tanh: ([x]) => Math.tanh(x),
	asinh: ([x]) => Math.asinh(x), acosh: ([x]) => Math.acosh(x), atanh: ([x]) => Math.atanh(x),
	ln: ([x]) => Math.log(x), log: ([x, b]) => b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b), log2: ([x]) => Math.log2(x), log10: ([x]) => Math.log10(x),
	exp: ([x]) => Math.exp(x), sqrt: ([x]) => Math.sqrt(x), cbrt: ([x]) => Math.cbrt(x), root: ([x, n]) => Math.sign(x) * Math.pow(Math.abs(x), 1 / n),
	abs: ([x]) => Math.abs(x), sign: ([x]) => Math.sign(x), floor: ([x]) => Math.floor(x), ceil: ([x]) => Math.ceil(x), trunc: ([x]) => Math.trunc(x),
	round: ([x, d]) => { const f = Math.pow(10, d ?? 0); return Math.round(x * f) / f; }, frac: ([x]) => x - Math.trunc(x),
	fact: ([x]) => factorial(x), gamma: ([x]) => gamma(x), hypot: (a) => Math.hypot(...a),
	min: (a) => Math.min(...a), max: (a) => Math.max(...a), pow: ([a, b]) => Math.pow(a, b),
	ncr: ([n, r]) => factorial(n) / (factorial(r) * factorial(n - r)), comb: ([n, r]) => factorial(n) / (factorial(r) * factorial(n - r)),
	npr: ([n, r]) => factorial(n) / factorial(n - r), perm: ([n, r]) => factorial(n) / factorial(n - r),
	gcd: ([a, b]) => gcd(a, b), mcd: ([a, b]) => gcd(a, b), lcm: ([a, b]) => Math.abs(a * b) / gcd(a, b), mcm: ([a, b]) => Math.abs(a * b) / gcd(a, b),
	isprime: ([n]) => isPrime(n) ? 1 : 0, fib: ([n]) => { let a = 0, b = 1; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a; },
	deg: ([x]) => x * 180 / Math.PI, rad: ([x]) => x * Math.PI / 180,
	sum: (a) => a.reduce((n, v) => n + v, 0), prod: (a) => a.reduce((n, v) => n * v, 1),
	mean: (a) => mean(a), avg: (a) => mean(a), media: (a) => mean(a), median: (a) => median(a), mediana: (a) => median(a), mode: (a) => mode(a), moda: (a) => mode(a),
	stdev: (a) => Math.sqrt(variance(a, true)), std: (a) => Math.sqrt(variance(a, true)), stdevp: (a) => Math.sqrt(variance(a, false)),
	variance: (a) => variance(a, true), varianza: (a) => variance(a, true), range: (a) => Math.max(...a) - Math.min(...a), count: (a) => a.length,
	mod: ([a, b]) => ((a % b) + b) % b, rem: ([a, b]) => a % b,
	dms: ([d]) => { const deg = Math.trunc(d); const m = Math.trunc((d - deg) * 60); const s = ((d - deg) * 60 - m) * 60; return deg + m / 100 + s / 10000; }
};

const CONSTANTS: Record<string, number> = {
	pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2,
	c: 299792458, g: 9.80665, gconst: 6.6743e-11, h: 6.62607015e-34, hbar: 1.054571817e-34, na: 6.02214076e23, kb: 1.380649e-23,
	rgas: 8.314462618, qe: 1.602176634e-19, me: 9.1093837015e-31, mp: 1.67262192369e-27, eps0: 8.8541878128e-12, mu0: 1.25663706212e-6
};

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

type UnitDef = { factor: number; kind: string };
const UNITS: Record<string, UnitDef> = {};
function unit(kind: string, entries: Record<string, number>): void { for (const [name, factor] of Object.entries(entries)) UNITS[name.toLowerCase()] = { factor, kind }; }
unit("length", { mm: 0.001, cm: 0.01, dm: 0.1, m: 1, km: 1000, in: 0.0254, inch: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852, au: 1.495978707e11, ly: 9.4607e15 });
unit("mass", { mg: 1e-6, g: 0.001, kg: 1, t: 1000, lb: 0.45359237, oz: 0.028349523125, st: 6.35029318 });
unit("time", { ms: 0.001, s: 1, seg: 1, min: 60, h: 3600, hr: 3600, d: 86400, day: 86400, dia: 86400, week: 604800, semana: 604800, month: 2629800, mes: 2629800, year: 31557600, ano: 31557600, y: 31557600 });
unit("data", { bit: 1 / 8, b: 1, byte: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 });
unit("speed", { "m/s": 1, "km/h": 1 / 3.6, kmh: 1 / 3.6, mph: 0.44704, kn: 0.514444, "ft/s": 0.3048 });
unit("area", { mm2: 1e-6, cm2: 1e-4, m2: 1, km2: 1e6, ha: 1e4, ft2: 0.09290304, in2: 0.00064516, acre: 4046.8564224 });
unit("volume", { ml: 0.001, cl: 0.01, dl: 0.1, l: 1, m3: 1000, cm3: 0.001, gal: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625, tsp: 0.00492892159, tbsp: 0.01478676478 });
unit("angle", { deg: Math.PI / 180, rad: 1, grad: Math.PI / 200, turn: Math.PI * 2 });
unit("energy", { j: 1, kj: 1e3, mj: 1e6, cal: 4.184, kcal: 4184, wh: 3600, kwh: 3.6e6, ev: 1.602176634e-19, btu: 1055.05585 });
unit("pressure", { pa: 1, kpa: 1e3, mpa: 1e6, bar: 1e5, mbar: 100, atm: 101325, mmhg: 133.322, torr: 133.322, psi: 6894.757 });
unit("power", { w: 1, kw: 1e3, mw: 1e6, hp: 745.699872, cv: 735.49875 });
unit("frequency", { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 });
unit("force", { n: 1, kn: 1e3, kgf: 9.80665, lbf: 4.4482216 });
const TEMPERATURE: Record<string, [(x: number) => number, (k: number) => number]> = {
	c: [x => x + 273.15, k => k - 273.15], degc: [x => x + 273.15, k => k - 273.15], celsius: [x => x + 273.15, k => k - 273.15],
	f: [x => (x + 459.67) * 5 / 9, k => k * 9 / 5 - 459.67], degf: [x => (x + 459.67) * 5 / 9, k => k * 9 / 5 - 459.67], fahrenheit: [x => (x + 459.67) * 5 / 9, k => k * 9 / 5 - 459.67],
	k: [x => x, k => k], kelvin: [x => x, k => k]
};

function normalizeUnit(raw: string): string {
	const base = raw.trim().toLowerCase().replace(/°/g, "deg").replace(/º/g, "deg").replace(/²/g, "2").replace(/³/g, "3");
	if (base in UNITS || base in TEMPERATURE) return base;
	// "days", "hours" → "day", "hour" style plurals.
	const singular = base.replace(/s$/, "");
	return singular in UNITS || singular in TEMPERATURE ? singular : base;
}

export function convertUnits(value: number, fromRaw: string, toRaw: string): number {
	const from = normalizeUnit(fromRaw);
	const to = normalizeUnit(toRaw);
	if (from in TEMPERATURE && to in TEMPERATURE) return TEMPERATURE[to][1](TEMPERATURE[from][0](value));
	const a = UNITS[from];
	const b = UNITS[to];
	if (!a || !b) throw new Error(`Unidad desconocida: ${!a ? fromRaw : toRaw}`);
	if (a.kind !== b.kind) throw new Error(`No se puede convertir ${fromRaw} a ${toRaw}`);
	return value * a.factor / b.factor;
}

// ---------------------------------------------------------------------------
// Parser → closures
// ---------------------------------------------------------------------------

type Token = { kind: "num"; value: number } | { kind: "id"; name: string } | { kind: "op"; value: string };

function tokenize(src: string): Token[] {
	const tokens: Token[] = [];
	const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/π/g, "pi").replace(/√/g, "sqrt").replace(/²/g, "^2").replace(/³/g, "^3").replace(/∞/g, "inf");
	let i = 0;
	while (i < s.length) {
		const ch = s[i];
		if (/\s/.test(ch)) { i++; continue; }
		const based = /^0(x[0-9a-f]+|b[01]+|o[0-7]+)/i.exec(s.slice(i));
		if (based) { tokens.push({ kind: "num", value: Number(based[0]) }); i += based[0].length; continue; }
		if (/[0-9.]/.test(ch)) {
			// Mixed numbers: "1 1/2" or "2 3/4" (an integer, a space, then a fraction).
			const mixed = /^(\d+)\s+(\d+)\/(\d+)(?![\d.\w])/.exec(s.slice(i));
			if (mixed && Number(mixed[3]) !== 0) {
				tokens.push({ kind: "num", value: Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) });
				i += mixed[0].length;
				continue;
			}
			const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
			if (!m) throw new Error("Número no válido");
			tokens.push({ kind: "num", value: parseFloat(m[0]) });
			i += m[0].length;
			continue;
		}
		if (/[a-zA-Z_]/.test(ch)) {
			const m = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(s.slice(i))!;
			tokens.push({ kind: "id", name: m[0].toLowerCase() });
			i += m[0].length;
			continue;
		}
		if ("+-*/^%!(),=".includes(ch)) { tokens.push({ kind: "op", value: ch }); i++; continue; }
		throw new Error(`Símbolo no reconocido: ${ch}`);
	}
	return tokens;
}

/** Functions whose first argument is an expression in a named variable: sum(i^2, i, 1, 10), integral(x^2, x, 0, 1)… */
const LAZY = new Set(["sum", "prod", "integral", "integrate", "deriv", "derivative", "solve"]);

class Parser {
	private pos = 0;
	/** Set by postfix() when the last term ended with %; expr() reads it for 200 + 10%. */
	private lastPercent = false;

	constructor(private tokens: Token[]) {}

	parse(): { fn: Fn; assign?: string } {
		if (this.tokens.length === 0) throw new Error("Escribe una expresión");
		const first = this.tokens[0];
		const second = this.tokens[1];
		if (first.kind === "id" && second && second.kind === "op" && second.value === "=" && !(first.name in FUNCTIONS) && !(first.name in CONSTANTS)) {
			this.pos = 2;
			const fn = this.expr();
			if (this.pos < this.tokens.length) throw new Error("Expresión incompleta");
			return { fn, assign: first.name };
		}
		const fn = this.expr();
		if (this.pos < this.tokens.length) throw new Error("Expresión incompleta");
		return { fn };
	}

	private peek(): Token | undefined { return this.tokens[this.pos]; }
	private isOp(v: string): boolean { const t = this.peek(); return !!t && t.kind === "op" && t.value === v; }
	private isId(v: string): boolean { const t = this.peek(); return !!t && t.kind === "id" && t.name === v; }
	private take(): Token { return this.tokens[this.pos++]; }

	private expr(): Fn {
		let left = this.term();
		while (this.isOp("+") || this.isOp("-")) {
			const op = (this.take() as { value: string }).value;
			this.lastPercent = false;
			const right = this.term();
			const percent = this.lastPercent;
			const l = left, r = right;
			// 200 + 10% adds ten percent; 200 - 10% takes it away.
			left = percent
				? (env) => l(env) * (1 + (op === "+" ? 1 : -1) * r(env))
				: (env) => op === "+" ? l(env) + r(env) : l(env) - r(env);
		}
		return left;
	}

	private term(): Fn {
		let left = this.unary();
		for (;;) {
			if (this.isOp("*") || this.isOp("/") || this.isId("mod")) {
				const t = this.take();
				const op = t.kind === "op" ? t.value : "mod";
				const l = left, r = this.unary();
				if (op === "*") left = (env) => l(env) * r(env);
				else if (op === "/") left = (env) => { const d = r(env); if (d === 0) throw new Error("División entre cero"); return l(env) / d; };
				else left = (env) => { const d = r(env); return ((l(env) % d) + d) % d; };
				continue;
			}
			// Implicit multiplication: 2pi, 3(4), 2sin(30), (1+2)(3+4)
			const t = this.peek();
			if (t && (t.kind === "num" || (t.kind === "id" && !this.isId("mod")) || (t.kind === "op" && t.value === "("))) {
				const l = left, r = this.unary();
				left = (env) => l(env) * r(env);
				continue;
			}
			return left;
		}
	}

	private unary(): Fn {
		if (this.isOp("-")) { this.take(); const v = this.unary(); return (env) => -v(env); }
		if (this.isOp("+")) { this.take(); return this.unary(); }
		return this.power();
	}

	private power(): Fn {
		const base = this.postfix();
		if (this.isOp("^")) { this.take(); const exp = this.unary(); return (env) => Math.pow(base(env), exp(env)); }
		return base;
	}

	private postfix(): Fn {
		let v = this.primary();
		this.lastPercent = false;
		for (;;) {
			if (this.isOp("!")) { this.take(); const inner = v; v = (env) => factorial(inner(env)); continue; }
			if (this.isOp("%")) { this.take(); const inner = v; v = (env) => inner(env) / 100; this.lastPercent = true; continue; }
			return v;
		}
	}

	private primary(): Fn {
		const t = this.take();
		if (!t) throw new Error("Falta un valor");
		if (t.kind === "num") { const value = t.value; return () => value; }
		if (t.kind === "op" && t.value === "(") {
			const v = this.expr();
			if (!this.isOp(")")) throw new Error("Falta cerrar un paréntesis");
			this.take();
			return v;
		}
		if (t.kind === "id") {
			const name = t.name;
			if (name === "ans") return (env) => env.ans;
			if (name === "m" || name === "mem") return (env) => env.memory;
			if (name === "inf" || name === "infinity") return () => Infinity;
			if (LAZY.has(name) && this.isOp("(")) return this.lazyCall(name);
			const fn = FUNCTIONS[name];
			if (fn) {
				const args = this.args();
				return (env) => fn(args.map(a => a(env)), env);
			}
			// Variables win over constants so a student can define their own g.
			return (env) => {
				if (env.vars.has(name)) return env.vars.get(name)!;
				if (name in CONSTANTS) return CONSTANTS[name];
				throw new Error(`Variable desconocida: ${name}`);
			};
		}
		throw new Error("Expresión no válida");
	}

	/** Function arguments: (a, b, c) or a single following value as in sin 30. */
	private args(): Fn[] {
		const args: Fn[] = [];
		if (this.isOp("(")) {
			this.take();
			if (!this.isOp(")")) {
				args.push(this.expr());
				while (this.isOp(",")) { this.take(); args.push(this.expr()); }
			}
			if (!this.isOp(")")) throw new Error("Falta cerrar un paréntesis");
			this.take();
		} else {
			args.push(this.unary());
		}
		return args;
	}

	/** sum(expr, i, from, to) · prod(…) · integral(expr, x, a, b) · deriv(expr, x, at) · solve(expr, x, guess) */
	private lazyCall(name: string): Fn {
		const open = this.pos;
		this.take(); // (
		const body = this.expr();
		// Without "expr, variable, …" the call is a plain list: sum(1, 2, 3).
		const next = this.tokens[this.pos];
		const afterComma = this.tokens[this.pos + 1];
		const afterVar = this.tokens[this.pos + 2];
		const indexed = next && next.kind === "op" && next.value === "," && afterComma && afterComma.kind === "id"
			&& !(afterComma.name in FUNCTIONS) && !(afterComma.name in CONSTANTS)
			&& afterVar && afterVar.kind === "op" && (afterVar.value === "," || afterVar.value === ")");
		if (!indexed) {
			this.pos = open;
			const fn = FUNCTIONS[name];
			if (!fn) throw new Error(`${name}(expresión, variable, …)`);
			const args = this.args();
			return (env) => fn(args.map(a => a(env)), env);
		}
		this.take(); // ,
		const variable = (this.take() as { name: string }).name;
		const rest: Fn[] = [];
		while (this.isOp(",")) { this.take(); rest.push(this.expr()); }
		if (!this.isOp(")")) throw new Error("Falta cerrar un paréntesis");
		this.take();
		const withVar = (env: Env, value: number): number => {
			const scoped: Env = { ...env, vars: new Map(env.vars) };
			scoped.vars.set(variable, value);
			return body(scoped);
		};
		if (name === "sum" || name === "prod") {
			if (rest.length < 2) throw new Error(`${name}(expresión, variable, desde, hasta)`);
			return (env) => {
				const from = Math.round(rest[0](env)), to = Math.round(rest[1](env));
				if (to - from > 1e6) throw new Error("Demasiadas iteraciones");
				let acc = name === "sum" ? 0 : 1;
				for (let i = from; i <= to; i++) acc = name === "sum" ? acc + withVar(env, i) : acc * withVar(env, i);
				return acc;
			};
		}
		if (name === "integral" || name === "integrate") {
			if (rest.length < 2) throw new Error("integral(expresión, variable, desde, hasta)");
			return (env) => {
				const a = rest[0](env), b = rest[1](env);
				const n = 2000;
				const h = (b - a) / n;
				let acc = withVar(env, a) + withVar(env, b);
				for (let i = 1; i < n; i++) acc += withVar(env, a + i * h) * (i % 2 ? 4 : 2);
				return acc * h / 3;
			};
		}
		if (name === "deriv" || name === "derivative") {
			if (rest.length < 1) throw new Error("deriv(expresión, variable, punto)");
			return (env) => {
				const x = rest[0](env);
				const h = Math.max(1e-6, Math.abs(x) * 1e-6);
				return (withVar(env, x + h) - withVar(env, x - h)) / (2 * h);
			};
		}
		return (env) => {
			let x = rest.length ? rest[0](env) : 1;
			// Newton with a numeric derivative, then bisection over a scan if it fails.
			for (let i = 0; i < 60; i++) {
				const f = withVar(env, x);
				if (Math.abs(f) < 1e-12) return x;
				const h = Math.max(1e-7, Math.abs(x) * 1e-7);
				const d = (withVar(env, x + h) - withVar(env, x - h)) / (2 * h);
				if (!Number.isFinite(d) || d === 0) break;
				const next = x - f / d;
				if (!Number.isFinite(next)) break;
				if (Math.abs(next - x) < 1e-12) return next;
				x = next;
			}
			let prev = -1000, prevF = withVar(env, prev);
			for (let s = -999; s <= 1000; s++) {
				const f = withVar(env, s);
				if (Number.isFinite(f) && Number.isFinite(prevF) && Math.sign(f) !== Math.sign(prevF)) {
					let lo = prev, hi = s;
					for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (Math.sign(withVar(env, mid)) === Math.sign(withVar(env, lo))) lo = mid; else hi = mid; }
					return (lo + hi) / 2;
				}
				prev = s; prevF = f;
			}
			throw new Error("No se encontró una solución");
		};
	}
}

export interface EvalResult {
	value: number;
	/** Variable that was assigned, if the input was `name = …`. */
	assigned?: string;
	/** Unit of the result after a conversion. */
	unit?: string;
}

const CONVERSION = /^(.*?)\s*([a-zA-Z°º²³/]+)\s+(?:to|in|a|en|->|→)\s+([a-zA-Z°º²³/]+)\s*$/i;

/** Full evaluation with variables and unit conversions; mutates env.vars on assignment. */
export function evaluateFull(src: string, env: Env): EvalResult {
	const conversion = CONVERSION.exec(src.trim());
	if (conversion && (normalizeUnit(conversion[2]) in UNITS || normalizeUnit(conversion[2]) in TEMPERATURE)
		&& (normalizeUnit(conversion[3]) in UNITS || normalizeUnit(conversion[3]) in TEMPERATURE)) {
		const amount = conversion[1].trim() ? new Parser(tokenize(conversion[1])).parse().fn(env) : 1;
		return { value: convertUnits(amount, conversion[2], conversion[3]), unit: conversion[3] };
	}
	const parsed = new Parser(tokenize(src)).parse();
	const value = parsed.fn(env);
	if (parsed.assign) env.vars.set(parsed.assign, value);
	return { value, assigned: parsed.assign };
}

/** Evaluates an expression; `vars` supplies variables such as x for function plots. */
export function evaluate(src: string, unit: AngleUnit, ans = 0, vars: Record<string, number> = {}): number {
	return evaluateFull(src, { unit, ans, vars: new Map(Object.entries(vars)), memory: 0 }).value;
}

export function formatNumber(v: number): string {
	if (!Number.isFinite(v)) return Number.isNaN(v) ? "indefinido" : (v > 0 ? "∞" : "-∞");
	if (Math.abs(v) < 1e-12) return "0";
	const abs = Math.abs(v);
	if (abs >= 1e15 || abs < 1e-6) return v.toExponential(8).replace(/\.?0+e/, "e");
	// Eleven significant digits hide the float noise of numeric derivatives (11.9999999997 → 12).
	return parseFloat(v.toPrecision(11)).toString();
}

/** Rational approximation with a small denominator, or null when the value is not a neat fraction. */
export function asFraction(v: number, maxDenominator = 10000): { n: number; d: number } | null {
	if (!Number.isFinite(v) || Number.isInteger(v) || Math.abs(v) >= 1e9) return null;
	let h1 = 1, h0 = 0, k1 = 0, k0 = 1, x = Math.abs(v);
	for (let i = 0; i < 24; i++) {
		const a = Math.floor(x);
		[h1, h0] = [a * h1 + h0, h1];
		[k1, k0] = [a * k1 + k0, k1];
		if (Math.abs(Math.abs(v) - h1 / k1) < 1e-10 || k1 > maxDenominator) break;
		x = 1 / (x - a);
		if (!Number.isFinite(x)) break;
	}
	if (k1 > 1 && k1 <= maxDenominator && Math.abs(Math.abs(v) - h1 / k1) < 1e-9) return { n: v < 0 ? -h1 : h1, d: k1 };
	return null;
}

/** "7/4" plus the mixed form "1 3/4" when the fraction is improper. */
export function formatFraction(f: { n: number; d: number }): { plain: string; mixed: string | null } {
	const plain = `${f.n}/${f.d}`;
	const whole = Math.trunc(f.n / f.d);
	const rest = Math.abs(f.n) - Math.abs(whole) * f.d;
	return { plain, mixed: whole !== 0 && rest > 0 ? `${whole} ${rest}/${f.d}` : null };
}

/** Same number in other useful shapes: fraction, scientific, and hex/binary when asked for. */
export function describeNumber(v: number, bases = false): string[] {
	const out: string[] = [];
	if (!Number.isFinite(v) || v === 0) return out;
	const fraction = asFraction(v);
	if (fraction) {
		const f = formatFraction(fraction);
		out.push(f.plain);
		if (f.mixed) out.push(f.mixed);
	}
	if (bases && Number.isInteger(v) && Math.abs(v) <= 0xffffffff) {
		out.push(`0x${Math.abs(v).toString(16).toUpperCase()}`);
		if (Math.abs(v) <= 0xffff) out.push(`0b${Math.abs(v).toString(2)}`);
	}
	if (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-3) out.push(v.toExponential(4));
	return out;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface CalculatorHost {
	insertCalculation(expression: string, result: string): void;
	calculatorUnit: AngleUnit;
	setCalculatorUnit(unit: AngleUnit): void;
}

interface HistoryEntry { expression: string; result: string }

type Key = { label: string; insert?: string; action?: () => void; cls?: string; title?: string };

export function createCalculatorPanel(host: CalculatorHost, container: HTMLElement): { toggle: () => void; isOpen: () => boolean } {
	const panel = container.createDiv({ cls: "notelens-calculator hidden" });
	for (const type of ["pointerdown", "pointerup", "dblclick"]) panel.addEventListener(type, (e) => e.stopPropagation());
	panel.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
	panel.addEventListener("keydown", (e) => e.stopPropagation());

	const header = panel.createDiv({ cls: "notelens-calculator-header" });
	setIcon(header.createSpan({ cls: "notelens-calculator-icon" }), "calculator");
	header.createSpan({ cls: "notelens-calculator-title", text: "Calculadora" });
	const unitBtn = header.createEl("button", { cls: "notelens-calculator-unit" });
	unitBtn.title = "Grados o radianes para las funciones trigonométricas";
	const closeBtn = header.createEl("button", { cls: "notelens-embed-close" });
	setIcon(closeBtn, "x");
	makeDraggable(panel, header, container, "notelens-calculator-pos");

	const display = panel.createDiv({ cls: "notelens-calculator-display" });
	const input = display.createEl("input", { cls: "notelens-calculator-input" });
	input.type = "text";
	input.placeholder = "p. ej. 2sin(30)^2, 200 + 15%, 5 km to mi, a = 3, sum(i^2, i, 1, 10)";
	input.spellcheck = false;
	const output = display.createDiv({ cls: "notelens-calculator-output", text: "0" });
	const alt = display.createDiv({ cls: "notelens-calculator-alt" });

	const env: Env = { unit: host.calculatorUnit, ans: 0, vars: new Map(), memory: 0 };
	const history: HistoryEntry[] = [];

	const refreshUnit = () => { unitBtn.setText(host.calculatorUnit === "deg" ? "DEG" : "RAD"); env.unit = host.calculatorUnit; };
	unitBtn.onclick = () => { host.setCalculatorUnit(host.calculatorUnit === "deg" ? "rad" : "deg"); refreshUnit(); preview(); };
	refreshUnit();
	const fractionBtn = header.createEl("button", { cls: "notelens-calculator-unit" });
	fractionBtn.setText("a/b");
	fractionBtn.title = "Mostrar los resultados como fracción siempre (si no, solo cuando operas con fracciones)";
	fractionBtn.onclick = () => { fractionMode = !fractionMode; fractionBtn.toggleClass("active", fractionMode); preview(); };
	header.insertBefore(fractionBtn, closeBtn);

	let fractionMode = false;
	const showResult = (result: EvalResult) => {
		output.removeClass("is-error");
		const decimal = formatNumber(result.value) + (result.unit ? ` ${result.unit}` : "");
		const fraction = result.unit ? null : asFraction(result.value);
		// Fractions in, fractions out: 2/3 + 1/6 shows 5/6 first and 0.8333… underneath.
		const wantsFraction = fraction && (fractionMode || (/[\d)]\s*\/\s*[\d(]/.test(input.value) && !/\d\.\d/.test(input.value)));
		if (wantsFraction && fraction) {
			const f = formatFraction(fraction);
			output.setText(f.plain + (f.mixed ? `  (${f.mixed})` : ""));
			const extra = describeNumber(result.value, /0x|0b|0o|hex|bin/i.test(input.value)).filter(x => x !== f.plain && x !== f.mixed);
			alt.setText(`= ${[decimal, ...extra].join("  ·  ")}`);
			return;
		}
		output.setText(decimal);
		// Hex and binary only when the input used them (0xFF, 0b101) or asks for them.
		const extra = describeNumber(result.value, /0x|0b|0o|hex|bin/i.test(input.value));
		alt.setText(extra.length ? `= ${extra.join("  ·  ")}` : "");
	};

	const preview = () => {
		const src = input.value.trim();
		if (!src) { output.setText(formatNumber(env.ans)); output.removeClass("is-error"); alt.setText(""); return; }
		try {
			// Preview must not create variables; evaluate on a copy.
			const scratch: Env = { ...env, vars: new Map(env.vars) };
			showResult(evaluateFull(src, scratch));
		} catch (e) {
			output.setText((e as Error).message);
			output.addClass("is-error");
			alt.setText("");
		}
	};

	const insertText = (text: string) => {
		const start = input.selectionStart ?? input.value.length;
		const end = input.selectionEnd ?? start;
		input.value = input.value.slice(0, start) + text + input.value.slice(end);
		const slot = text.indexOf("()") >= 0 ? text.indexOf("()") + 1 : text.indexOf("(, ") >= 0 ? text.indexOf("(, ") + 1 : -1;
		const caret = slot >= 0 ? start + slot : start + text.length;
		input.setSelectionRange(caret, caret);
		input.focus();
		preview();
	};

	/**
	 * Fraction key. With "2" just typed it becomes "(2)/()" and the caret waits
	 * in the denominator; with nothing before the caret it inserts "()/()".
	 */
	const insertFraction = () => {
		const start = input.selectionStart ?? input.value.length;
		const before = input.value.slice(0, start);
		const after = input.value.slice(input.selectionEnd ?? start);
		const m = /(\d+(?:\.\d+)?|[a-zA-Z_]\w*|\([^()]*\))\s*$/.exec(before);
		if (m) {
			const head = before.slice(0, m.index);
			const numerator = m[1].startsWith("(") ? m[1] : `(${m[1]})`;
			input.value = `${head}${numerator}/()${after}`;
			const caret = head.length + numerator.length + 2;
			input.setSelectionRange(caret, caret);
			input.focus();
			preview();
			return;
		}
		insertText("()/()");
	};

	const currentValue = (): number => {
		const src = input.value.trim();
		if (!src) return env.ans;
		try { return evaluateFull(src, { ...env, vars: new Map(env.vars) }).value; } catch { return env.ans; }
	};

	// --- memory and variables
	const memoryRow = panel.createDiv({ cls: "notelens-calculator-memory" });
	const memoryLabel = memoryRow.createSpan({ cls: "notelens-calculator-memory-label" });
	const refreshMemory = () => { memoryLabel.setText(env.memory ? `M = ${formatNumber(env.memory)}` : "M vacía"); };
	const memKey = (label: string, title: string, action: () => void) => {
		const b = memoryRow.createEl("button", { cls: "notelens-calculator-key muted small", text: label });
		b.title = title;
		b.onclick = () => { action(); refreshMemory(); preview(); };
	};
	memKey("MC", "Borrar memoria", () => { env.memory = 0; });
	memKey("MR", "Insertar la memoria (también puedes escribir M)", () => insertText("M"));
	memKey("M+", "Sumar el resultado actual a la memoria", () => { env.memory += currentValue(); });
	memKey("M−", "Restar el resultado actual de la memoria", () => { env.memory -= currentValue(); });
	refreshMemory();

	const varsEl = panel.createDiv({ cls: "notelens-calculator-vars" });
	const refreshVars = () => {
		varsEl.empty();
		if (env.vars.size === 0) return;
		for (const [name, value] of env.vars) {
			const chip = varsEl.createEl("button", { cls: "notelens-calculator-var", text: `${name} = ${formatNumber(value)}` });
			chip.title = "Insertar la variable. Escribe «nombre = valor» para definir otra.";
			chip.onclick = () => insertText(name);
		}
		const clear = varsEl.createEl("button", { cls: "notelens-calculator-var muted", text: "borrar variables" });
		clear.onclick = () => { env.vars.clear(); refreshVars(); preview(); };
	};

	// --- history
	const historyEl = panel.createDiv({ cls: "notelens-calculator-history" });
	const renderHistory = () => {
		historyEl.empty();
		if (history.length === 0) {
			historyEl.createDiv({ cls: "notelens-calculator-empty", text: "Los cálculos que hagas quedan aquí." });
			return;
		}
		for (const entry of [...history].reverse()) {
			const row = historyEl.createDiv({ cls: "notelens-calculator-entry" });
			row.createSpan({ cls: "notelens-calculator-entry-expr", text: entry.expression });
			row.createSpan({ cls: "notelens-calculator-entry-result", text: `= ${entry.result}` });
			row.title = "Volver a usar";
			row.onclick = () => { input.value = entry.expression; preview(); input.focus(); };
			const insert = row.createEl("button", { cls: "notelens-table-control" });
			setIcon(insert, "arrow-down-to-line");
			insert.title = "Insertar en la pizarra";
			insert.onclick = (e) => { e.stopPropagation(); host.insertCalculation(entry.expression, entry.result); };
		}
	};

	const commit = () => {
		const src = input.value.trim();
		if (!src) return;
		try {
			const result = evaluateFull(src, env);
			env.ans = result.value;
			const fraction = result.unit ? null : asFraction(result.value);
			const useFraction = fraction && (fractionMode || (/[\d)]\s*\/\s*[\d(]/.test(src) && !/\d\.\d/.test(src)));
			const text = useFraction && fraction ? formatFraction(fraction).plain : formatNumber(result.value) + (result.unit ? ` ${result.unit}` : "");
			history.push({ expression: src, result: text });
			if (history.length > 60) history.shift();
			renderHistory();
			refreshVars();
			showResult(result);
			input.value = "";
		} catch (e) {
			output.setText((e as Error).message);
			output.addClass("is-error");
		}
	};

	input.addEventListener("input", preview);
	input.addEventListener("keydown", (e) => {
		if (e.key === "Tab" && !e.shiftKey) {
			// Inside a fraction template, Tab moves to the next empty () slot.
			const from = input.selectionStart ?? 0;
			const next = input.value.indexOf("()", from);
			if (next >= 0) { e.preventDefault(); input.setSelectionRange(next + 1, next + 1); return; }
			const close = input.value.indexOf(")", from);
			if (close >= 0) { e.preventDefault(); input.setSelectionRange(close + 1, close + 1); return; }
		}
		if (e.key === "Enter") { e.preventDefault(); commit(); }
		else if (e.key === "Escape") { e.preventDefault(); toggle(); }
		else if (e.key === "ArrowUp" && history.length) { e.preventDefault(); input.value = history[history.length - 1].expression; preview(); }
	});

	// --- keys in tabs
	const tabs = panel.createDiv({ cls: "notelens-calculator-tabs" });
	const keys = panel.createDiv({ cls: "notelens-calculator-keys" });
	const pages: Record<string, Key[]> = {
		"Básica": [
			{ label: "sin", insert: "sin()", cls: "fn" }, { label: "cos", insert: "cos()", cls: "fn" }, { label: "tan", insert: "tan()", cls: "fn" }, { label: "(", insert: "(" }, { label: ")", insert: ")" }, { label: "⌫", action: () => { input.value = input.value.slice(0, -1); preview(); input.focus(); }, cls: "muted", title: "Borrar" },
			{ label: "ln", insert: "ln()", cls: "fn" }, { label: "log", insert: "log()", cls: "fn" }, { label: "√", insert: "sqrt()", cls: "fn" }, { label: "7", insert: "7" }, { label: "8", insert: "8" }, { label: "9", insert: "9" },
			{ label: "x²", insert: "^2", cls: "fn" }, { label: "xʸ", insert: "^", cls: "fn" }, { label: "n!", insert: "!", cls: "fn" }, { label: "4", insert: "4" }, { label: "5", insert: "5" }, { label: "6", insert: "6" },
			{ label: "π", insert: "pi", cls: "fn" }, { label: "e", insert: "e", cls: "fn" }, { label: "ans", insert: "ans", cls: "fn" }, { label: "1", insert: "1" }, { label: "2", insert: "2" }, { label: "3", insert: "3" },
			{ label: "÷", insert: "/", cls: "op" }, { label: "×", insert: "*", cls: "op" }, { label: "−", insert: "-", cls: "op" }, { label: "0", insert: "0" }, { label: ".", insert: "." }, { label: "+", insert: "+", cls: "op" },
			{ label: "C", action: () => { input.value = ""; preview(); input.focus(); }, cls: "muted", title: "Limpiar" }, { label: "%", insert: "%", cls: "op", title: "Porcentaje: 200 + 15%, 30% * 80" }, { label: "a/b", action: () => insertFraction(), cls: "fn fraction", title: "Fracción: escribe el numerador, luego el denominador. 2/3 + 1/6 da 5/6; el botón a/b de arriba fuerza el resultado en fracción" }, { label: "exp", insert: "exp()", cls: "fn" }, { label: "=", action: commit, cls: "equals" }, { label: "Insertar", action: () => { commit(); const last = history[history.length - 1]; if (last) host.insertCalculation(last.expression, last.result); }, cls: "insert", title: "Calcular e insertar en la pizarra" }
		],
		"Avanzada": [
			{ label: "sin⁻¹", insert: "asin()", cls: "fn" }, { label: "cos⁻¹", insert: "acos()", cls: "fn" }, { label: "tan⁻¹", insert: "atan()", cls: "fn" }, { label: "sinh", insert: "sinh()", cls: "fn" }, { label: "cosh", insert: "cosh()", cls: "fn" }, { label: "tanh", insert: "tanh()", cls: "fn" },
			{ label: "log₂", insert: "log2()", cls: "fn" }, { label: "logₙ", insert: "log(, )", cls: "fn", title: "log(x, base)" }, { label: "ⁿ√", insert: "root(, )", cls: "fn", title: "root(x, n)" }, { label: "|x|", insert: "abs()", cls: "fn" }, { label: "⌊x⌋", insert: "floor()", cls: "fn" }, { label: "⌈x⌉", insert: "ceil()", cls: "fn" },
			{ label: "nCr", insert: "ncr(, )", cls: "fn" }, { label: "nPr", insert: "npr(, )", cls: "fn" }, { label: "mod", insert: " mod ", cls: "op" }, { label: "gcd", insert: "gcd(, )", cls: "fn" }, { label: "lcm", insert: "lcm(, )", cls: "fn" }, { label: "primo", insert: "isprime()", cls: "fn" },
			{ label: "media", insert: "mean()", cls: "fn", title: "mean(1, 2, 3)" }, { label: "mediana", insert: "median()", cls: "fn" }, { label: "σ", insert: "stdev()", cls: "fn", title: "Desviación típica muestral: stdev(1, 2, 3)" }, { label: "σ²", insert: "variance()", cls: "fn" }, { label: "moda", insert: "mode()", cls: "fn" }, { label: "hypot", insert: "hypot(, )", cls: "fn" },
			{ label: "Σ", insert: "sum(, i, 1, 10)", cls: "fn", title: "sum(expresión, i, desde, hasta)" }, { label: "Π", insert: "prod(, i, 1, 10)", cls: "fn", title: "prod(expresión, i, desde, hasta)" }, { label: "∫", insert: "integral(, x, 0, 1)", cls: "fn", title: "integral(expresión, x, desde, hasta)" }, { label: "d/dx", insert: "deriv(, x, 1)", cls: "fn", title: "deriv(expresión, x, punto)" }, { label: "solve", insert: "solve(, x, 1)", cls: "fn", title: "solve(expresión = 0, x, valor inicial)" }, { label: "x =", insert: "x = ", cls: "fn", title: "Definir una variable: x = 5" },
			{ label: "0x", insert: "0x", cls: "fn", title: "Hexadecimal" }, { label: "0b", insert: "0b", cls: "fn", title: "Binario" }, { label: "M", insert: "M", cls: "fn", title: "Valor guardado en memoria" }, { label: "c", insert: "c", cls: "fn", title: "Velocidad de la luz" }, { label: "g", insert: "g", cls: "fn", title: "Gravedad 9,80665" }, { label: "Nₐ", insert: "NA", cls: "fn", title: "Número de Avogadro" }
		],
		"Unidades": [
			{ label: "km→mi", insert: " km to mi" }, { label: "mi→km", insert: " mi to km" }, { label: "m→ft", insert: " m to ft" }, { label: "cm→in", insert: " cm to in" }, { label: "kg→lb", insert: " kg to lb" }, { label: "lb→kg", insert: " lb to kg" },
			{ label: "°C→°F", insert: " C to F" }, { label: "°F→°C", insert: " F to C" }, { label: "K→°C", insert: " K to C" }, { label: "l→gal", insert: " l to gal" }, { label: "km/h→m/s", insert: " km/h to m/s" }, { label: "mph→km/h", insert: " mph to km/h" },
			{ label: "h→min", insert: " h to min" }, { label: "días→h", insert: " day to h" }, { label: "GB→MB", insert: " GB to MB" }, { label: "kWh→J", insert: " kWh to J" }, { label: "atm→Pa", insert: " atm to Pa" }, { label: "hp→kW", insert: " hp to kW" },
			{ label: "deg→rad", insert: " deg to rad" }, { label: "rad→deg", insert: " rad to deg" }, { label: "ha→m²", insert: " ha to m2" }, { label: "cal→J", insert: " cal to J" }, { label: "eV→J", insert: " eV to J" }, { label: "psi→bar", insert: " psi to bar" }
		]
	};
	const renderKeys = (page: string) => {
		keys.empty();
		for (const key of pages[page]) {
			const b = keys.createEl("button", { cls: `notelens-calculator-key ${key.cls ?? ""}`, text: key.label });
			if (key.title) b.title = key.title;
			b.onclick = () => { if (key.action) key.action(); else if (key.insert) insertText(key.insert); };
		}
		for (const tab of Array.from(tabs.children)) tab.toggleClass("active", tab.textContent === page);
	};
	for (const page of Object.keys(pages)) {
		const tab = tabs.createEl("button", { cls: "notelens-calculator-tab", text: page });
		tab.onclick = () => renderKeys(page);
	}
	renderKeys("Básica");

	panel.createDiv({ cls: "notelens-calculator-help", text: "Escribe con naturalidad: 2pi r, 200 + 15%, 30% * 80, a = 3 y luego 2a, 5 km to mi, 20 C to F, sum(i^2, i, 1, 10), integral(x^2, x, 0, 1), solve(x^2 - 2, x, 1), 0xFF + 0b101, mean(4, 7, 9). Enter calcula, ↑ repite, Esc cierra." });
	renderHistory();

	let open = false;
	const toggle = () => {
		open = !open;
		panel.toggleClass("hidden", !open);
		if (open) { refreshUnit(); input.focus(); preview(); }
	};
	closeBtn.onclick = toggle;
	return { toggle, isOpen: () => open };
}
