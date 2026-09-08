import { toRenderableLatex } from "./asciimath";

/** Unwrap copied math, then use the same parser as the equation editor. */
export function tidyFormulaText(raw: string): string {
    let value = raw.trim().replace(/^```(?:latex|tex|math)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
    if (value.startsWith("$$") && value.endsWith("$$")) value = value.slice(2, -2).trim();
    else if (value.startsWith("$") && value.endsWith("$")) value = value.slice(1, -1).trim();
    else if ((value.startsWith("\\[") && value.endsWith("\\]")) || (value.startsWith("\\(") && value.endsWith("\\)"))) value = value.slice(2, -2).trim();
    return toRenderableLatex(value);
}
