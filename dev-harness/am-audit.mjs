// Audit of the easy-notation → LaTeX converter: prints what every realistic
// student input becomes, so weak spots show up before touching MathJax.
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(path.join(tmpdir(), "notelens-am-"));
const out = path.join(dir, "asciimath.mjs");
await build({ entryPoints: ["src/asciimath.ts"], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent" });
const { toRenderableLatex, looksLikeLatex } = await import(pathToFileURL(out).href);

const CASES = [
	"x^2/2 + sqrt(x)",
	"sum_(i=1)^n i = (n(n+1))/2",
	"int_0^1 x^2 dx",
	"lim_(x->oo) 1/x = 0",
	"[[a,b],[c,d]]",
	"x = (-b +- sqrt(b^2-4ac))/(2a)",
	"f'(x) = 2x",
	"e^(i pi) + 1 = 0",
	"d/dx (x^2) = 2x",
	"dy/dx",
	"(a+b)^2 = a^2 + 2ab + b^2",
	"sin^2 x + cos^2 x = 1",
	"|x| < 3",
	"abs(x-1) <= 2",
	"a/b/c",
	"1/2 x",
	"x_1, x_2, ..., x_n",
	"vec v = (1, 2, 3)",
	"lim_(h->0) (f(x+h)-f(x))/h",
	"sum_(n=1)^oo 1/n^2 = pi^2/6",
	"int_a^b f(x) dx = F(b) - F(a)",
	"x in RR",
	"alpha + beta = gamma",
	"2x + 3 = 7 => x = 2",
	"root(3)(8) = 2",
	"log_2 8 = 3",
	"ln x",
	"e^-x",
	"10^-3",
	"x^2y",
	"x^(2n)",
	"1/(x+1)",
	"sqrt((a+b)/2)",
	"(x+1)(x-1)",
	"n!",
	"((n),(k)) = (n!)/(k!(n-k)!)",
	"5%",
	"90 deg",
	"30°",
	"hat x + bar y + vec a * vec b",
	"f: RR -> RR",
	"a ~= b, a >= b, a != b",
	"x != y",
	"π + √2",
	"∫ x dx",
	"a ≤ b ≠ c → ∞",
	"3 × 4 · 5 ÷ 6",
	"α + β = γ",
	"text(si) x > 0",
	"\"velocidad\" = d/t",
	"f(x) = {(x, x>=0), (-x, x<0):}",
	"a := b",
	"x^2 + y^2 = r^2\ny = mx + n",
	"\\frac{a}{b} + \\sqrt{2}",
	"x^2 + \\alpha",
	"cos(2x) = 1 - 2sin^2 x",
	"sin(x)/cos(x) = tan(x)",
	"e^(x^2)",
	"a_(ij)",
	"det [[1,2],[3,4]] = -2",
	"sum_(k=0)^n ((n),(k)) x^k",
	"(1+1/n)^n -> e",
	"oint_C F * dr",
	"grad f = (del f)/(del x) i + (del f)/(del y) j",
	"P(A nn B) = P(A) P(B)",
	"A uu B, A sub B, x notin A",
	"AA x EE y : y > x",
	"{1, 2, 3}",
	"[0, 1)",
	"|A| = 3",
	"x = 2, y = 3",
	"m = (y_2 - y_1)/(x_2 - x_1)",
	"E = mc^2",
	"F = G (m_1 m_2)/r^2",
	"v = v_0 + a t",
	"x(t) = x_0 + v_0 t + 1/2 a t^2",
	"S = 4 pi r^2",
	"V = 4/3 pi r^3",
	"ohm",
	"Δx / Δt",
	"x̄",
	"3.14 * 2",
	"a^2+b^2=c^2",
];

for (const src of CASES) {
	const tex = toRenderableLatex(src);
	console.log(JSON.stringify(src).padEnd(52), looksLikeLatex(src) ? "[TeX]" : "     ", tex);
}
rmSync(dir, { recursive: true, force: true });
