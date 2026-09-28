// The symbols the classifier can name, and where the handwriting for each one
// comes from. The names are the LaTeX the recogniser writes.
//
// Letters whose lower and upper case are the same shape at a different size
// (c/C, s/S, x/X…) are one class here: the classifier cannot tell them apart
// from the shape, and the layout, which sees the size, picks the case.
// Likewise "0", "o" and "O" are all the class "0".

export const MERGED_CASE = ["c", "k", "p", "s", "u", "v", "w", "x", "z"];

const lower = [..."abcdefghijklmnopqrstuvwxyz"].filter(ch => ch !== "o");
const upper = [..."ABCDEFGHIJKLMNPQRSTUVWXYZ"].filter(ch => !MERGED_CASE.includes(ch.toLowerCase()));

export const CLASSES = [
	..."0123456789",
	...lower,
	...upper,
	"+", "-", "=", "(", ")", "[", "]", "\\{", "\\}", "/", "|", "<", ">", "!",
	"\\int", "\\sum", "\\prod", "\\sqrt", "\\infty", "\\partial", "\\nabla",
	"\\alpha", "\\beta", "\\gamma", "\\delta", "\\Delta", "\\epsilon", "\\theta", "\\lambda", "\\mu",
	"\\pi", "\\rho", "\\sigma", "\\tau", "\\phi", "\\psi", "\\omega", "\\Omega", "\\Gamma", "\\Pi",
	"\\times", "\\div", "\\pm", "\\leq", "\\geq", "\\neq", "\\approx", "\\sim", "\\equiv",
	"\\rightarrow", "\\Rightarrow", "\\Leftrightarrow", "\\in", "\\forall", "\\exists",
	"\\cup", "\\cap", "\\subset", "\\subseteq", "\\emptyset", "\\ast",
	"junk"
];

/** Hand-TeX key → class. */
export const HANDTEX = {
	"latex2e-_int": "\\int", "latex2e-_sum": "\\sum", "latex2e-_Sigma": "\\sum", "latex2e-_prod": "\\prod",
	"latex2e-_sqrt{}": "\\sqrt", "latex2e-_surd": "\\sqrt", "textcomp-_textsurd": "\\sqrt", "latex2e-_infty": "\\infty", "latex2e-_partial": "\\partial",
	"latex2e-_nabla": "\\nabla", "latex2e-_alpha": "\\alpha", "latex2e-_beta": "\\beta", "latex2e-_gamma": "\\gamma",
	"latex2e-_delta": "\\delta", "latex2e-_Delta": "\\Delta", "latex2e-_epsilon": "\\epsilon", "latex2e-_varepsilon": "\\epsilon",
	"latex2e-_theta": "\\theta", "latex2e-_vartheta": "\\theta", "latex2e-_lambda": "\\lambda", "latex2e-_mu": "\\mu",
	"latex2e-_pi": "\\pi", "latex2e-_rho": "\\rho", "latex2e-_varrho": "\\rho", "latex2e-_sigma": "\\sigma", "latex2e-_tau": "\\tau",
	"latex2e-_phi": "\\phi", "latex2e-_varphi": "\\phi", "latex2e-_psi": "\\psi", "latex2e-_omega": "\\omega",
	"latex2e-_Omega": "\\Omega", "latex2e-_Gamma": "\\Gamma", "latex2e-_Pi": "\\Pi",
	"latex2e-_times": "\\times", "latex2e-_div": "\\div", "latex2e-_pm": "\\pm", "amssymb-_leq": "\\leq",
	"amssymb-_geq": "\\geq", "amssymb-_neq": "\\neq", "latex2e-_approx": "\\approx", "latex2e-_sim": "\\sim",
	"latex2e-_equiv": "\\equiv", "latex2e-_rightarrow": "\\rightarrow", "latex2e-_to": "\\rightarrow",
	"latex2e-_Rightarrow": "\\Rightarrow", "latex2e-_Leftrightarrow": "\\Leftrightarrow", "latex2e-_in": "\\in",
	"latex2e-_forall": "\\forall", "latex2e-_exists": "\\exists", "latex2e-_cup": "\\cup", "latex2e-_cap": "\\cap",
	"latex2e-_subset": "\\subset", "latex2e-_subseteq": "\\subseteq", "latex2e-_emptyset": "\\emptyset",
	"amssymb-_varnothing": "\\emptyset", "latex2e-_ast": "\\ast", "latex2e-_{": "\\{", "latex2e-_}": "\\}",
	// Not \S, \P, \L, \l, \o, \O: in LaTeX those are §, ¶, Ł, ł, ø and Ø.
	"latex2e-_mid": "|"
};

/** UJI Pen Characters label → class. */
export function ujiClass(label) {
	if (/^[0-9]$/.test(label)) return label;
	if (label === "o" || label === "O") return "0";
	if (/^[a-z]$/.test(label)) return label;
	if (/^[A-Z]$/.test(label)) return MERGED_CASE.includes(label.toLowerCase()) ? label.toLowerCase() : label;
	return { "(": "(", ")": ")", "-": "-", "<": "<", ">": ">", "!": "!" }[label] ?? null;
}

/** MathWriting symbol label → class (evaluation only). */
export function mathWritingClass(label) {
	const l = label.trim();
	if (/^[0-9]$/.test(l)) return l;
	if (l === "o" || l === "O") return "0";
	if (/^[a-z]$/.test(l)) return l;
	if (/^[A-Z]$/.test(l)) return MERGED_CASE.includes(l.toLowerCase()) ? l.toLowerCase() : l;
	const aliases = { "\\to": "\\rightarrow", "\\varepsilon": "\\epsilon", "\\varphi": "\\phi", "\\vartheta": "\\theta",
		"\\le": "\\leq", "\\ge": "\\geq", "\\ne": "\\neq", "\\lbrace": "\\{", "\\rbrace": "\\}", "\\vert": "|", "\\mid": "|",
		"*": "\\ast", "\\varnothing": "\\emptyset", "\\Sigma": "\\sum", "\\surd": "\\sqrt", "\\{": "\\{", "\\}": "\\}", "\\lt": "<", "\\gt": ">" };
	const mapped = aliases[l] ?? l;
	return CLASSES.includes(mapped) && mapped !== "junk" ? mapped : null;
}
