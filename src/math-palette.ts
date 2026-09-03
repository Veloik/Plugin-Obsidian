/**
 * The symbol palette, shared by the formula box's format bar and the equation
 * dialog's keyboard tab. One list, so a symbol added for one of them shows up
 * in the other.
 *
 * Each key is [what the button shows, what it is called, what it types]. The
 * snippets are written in the easy notation, not LaTeX: `toRenderableLatex`
 * converts them, and a student who opens the box later reads something they
 * could have typed themselves.
 */

export interface MathKey {
	/** The glyph on the button. */
	glyph: string;
	/** Its name, translated where it is painted. */
	name: string;
	/** What gets typed. `()` or a double space marks where the caret lands. */
	snippet: string;
}

export interface MathGroup {
	/** Tab name, translated where it is painted. */
	name: string;
	keys: MathKey[];
}

const key = (glyph: string, name: string, snippet: string): MathKey => ({ glyph, name, snippet });

export const MATH_GROUPS: MathGroup[] = [
	{
		name: "Básico",
		keys: [
			key("a/b", "Fracción", "(a)/(b)"), key("√", "Raíz cuadrada", "sqrt(x)"), key("ⁿ√", "Raíz enésima", "root(n)(x)"),
			key("xⁿ", "Potencia", "x^(n)"), key("xₙ", "Subíndice", "x_(n)"), key("·", "Producto", "*"), key("÷", "División", "-:"),
			key("±", "Más menos", "+-"), key("∓", "Menos más", "-+"), key("|x|", "Valor absoluto", "abs(x)"),
			key("( )", "Paréntesis", "()"), key("[ ]", "Corchetes", "[]"), key("{ }", "Llaves", "{}"), key("↵", "Nueva línea", "\n")
		]
	},
	{
		name: "Cálculo",
		keys: [
			key("Σ", "Sumatorio", "sum_(i=1)^n "), key("Π", "Productorio", "prod_(i=1)^n "),
			key("∫", "Integral", "int_a^b  dx"), key("∬", "Integral doble", "int int  dA"), key("∮", "Integral de contorno", "oint  ds"),
			key("lim", "Límite", "lim_(x->oo) "), key("d/dx", "Derivada", "(d)/(dx) "), key("∂", "Derivada parcial", "(del)/(del x) "),
			key("∇", "Nabla", "grad "), key("∞", "Infinito", "oo"), key("→", "Tiende a", "->"), key("Δ", "Incremento", "Delta")
		]
	},
	{
		name: "Griego",
		keys: [
			key("α", "Alfa", "alpha"), key("β", "Beta", "beta"), key("γ", "Gamma", "gamma"), key("δ", "Delta", "delta"),
			key("ε", "Épsilon", "epsilon"), key("θ", "Theta", "theta"), key("λ", "Lambda", "lambda"), key("μ", "Mu", "mu"),
			key("π", "Pi", "pi"), key("ρ", "Rho", "rho"), key("σ", "Sigma", "sigma"), key("τ", "Tau", "tau"),
			key("φ", "Fi", "phi"), key("ω", "Omega", "omega"), key("Ω", "Omega mayúscula", "Omega")
		]
	},
	{
		name: "Relaciones",
		keys: [
			key("=", "Igual", "="), key("≠", "Distinto", "!="), key("≈", "Aproximado", "~~"), key("≡", "Idéntico", "=="),
			key("≤", "Menor o igual", "<="), key("≥", "Mayor o igual", ">="), key("≪", "Mucho menor", "<<"), key("≫", "Mucho mayor", ">>"),
			key("∝", "Proporcional", "prop"), key("→", "Implica", "->"), key("⇒", "Entonces", "=>"), key("⇔", "Si y solo si", "<=>")
		]
	},
	{
		name: "Conjuntos",
		keys: [
			key("∈", "Pertenece", "in"), key("∉", "No pertenece", "notin"), key("⊂", "Subconjunto", "sub"), key("⊆", "Subconjunto o igual", "sube"),
			key("∪", "Unión", "uu"), key("∩", "Intersección", "nn"), key("∅", "Vacío", "emptyset"), key("∀", "Para todo", "AA"),
			key("∃", "Existe", "EE"), key("¬", "Negación", "not"), key("∧", "Y", "and"), key("∨", "O", "or"),
			key("ℝ", "Reales", "RR"), key("ℕ", "Naturales", "NN"), key("ℤ", "Enteros", "ZZ"), key("ℚ", "Racionales", "QQ")
		]
	},
	{
		name: "Matrices",
		keys: [
			key("[2×2]", "Matriz 2×2", "[[a,b],[c,d]]"), key("[3×3]", "Matriz 3×3", "[[a,b,c],[d,e,f],[g,h,i]]"),
			key("(vec)", "Vector columna", "[[x],[y]]"), key("det", "Determinante", "det [[a,b],[c,d]]"),
			key("(ⁿₖ)", "Coeficiente binomial", "((n),(k))"), key("{…", "Definición a trozos", "{(a, x>=0), (b, x<0):}"),
			key("x̄", "Media", "bar x"), key("x̂", "Sombrero", "hat x"), key("x⃗", "Vector", "vec x"), key("ẋ", "Punto", "dot x")
		]
	}
];

/**
 * Inserts a snippet into a text field and leaves the caret where the argument
 * goes: `()` puts it between the brackets, a double space in the middle of an
 * operator (`int_a^b  dx`) puts it in the gap.
 */
export function insertMathSnippet(field: HTMLInputElement | HTMLTextAreaElement, snippet: string): void {
	const start = field.selectionStart ?? field.value.length;
	const end = field.selectionEnd ?? start;
	field.setRangeText(snippet, start, end, "end");
	const slot = snippet.indexOf("()") >= 0 ? snippet.indexOf("()") + 1
		: snippet.indexOf("  ") >= 0 ? snippet.indexOf("  ") + 1
			: -1;
	if (slot >= 0) field.setSelectionRange(start + slot, start + slot);
	field.focus();
}
