import { toRenderableLatex } from "./asciimath.mjs";
const cases = [
	"x^2/2 + sqrt(x)", "sum_(i=1)^n i = (n(n+1))/2", "int_0^1 x^2 dx", "lim_(x->oo) 1/x = 0", "[[a,b],[c,d]]",
	"(a+b)^2 = a^2 + 2ab + b^2", "f(x) = sin(x)/cos(x) != tan x", "alpha + beta <= pi", "abs(x-1) < epsilon", "E = mc^2",
	"\\frac{a}{b}", "x_1^2 + text(velocidad) v", "2/3 pi r^3", "root 3 x + frac a b", "a/b/c", "x = (-b +- sqrt(b^2-4ac))/(2a)"
];
for (const s of cases) console.log(s.padEnd(36), "=>", toRenderableLatex(s));
