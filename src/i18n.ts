/**
 * Translation for NoteLens.
 *
 * The Spanish text is the message id, so `tr("Guardar")` reads like the string it
 * produces and a Spanish install returns it untouched. Anything a catalogue is
 * missing falls back to the Spanish original instead of showing a raw key.
 */

import { getLanguage } from "obsidian";
import { en } from "./locales/en";

export type Locale = "es" | "en";

/** What the user picked in the settings; "auto" follows Obsidian. */
export type LocaleSetting = "auto" | Locale;

type Catalogue = Partial<Record<string, string>>;

const CATALOGUES: Record<Locale, Catalogue> = { es: {}, en };

/** Spanish is the source language, so it is also the fallback. */
const SOURCE_LOCALE: Locale = "es";

let active: Locale = SOURCE_LOCALE;

/**
 * Obsidian keeps the interface language in localStorage under "language" and
 * uses ISO codes such as "es", "en", "pt-BR". Anything we cannot serve reads as
 * English, which is what an international install expects.
 */
export function detectLocale(): Locale {
	let stored: string | null = null;
	try {
		stored = getLanguage();
	} catch {
		stored = null;
	}
	const code = (stored || "").toLowerCase();
	if (!code) return SOURCE_LOCALE;
	if (code === "es" || code.startsWith("es-")) return "es";
	return "en";
}

export function resolveLocale(setting: LocaleSetting): Locale {
	return setting === "auto" ? detectLocale() : setting;
}

export function setLocale(setting: LocaleSetting): void {
	active = resolveLocale(setting);
}

export function getLocale(): Locale {
	return active;
}

/**
 * Replaces `{name}` placeholders. Values are inserted verbatim, so a translation
 * can move them around without the call site caring about word order.
 */
function fill(text: string, params?: Record<string, string | number>): string {
	if (!params) return text;
	return text.replace(/\{(\w+)\}/g, (match, key: string) =>
		Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
	);
}

/** Translates a message, falling back to the Spanish source. */
export function tr(message: string, params?: Record<string, string | number>): string {
	if (active === SOURCE_LOCALE) return fill(message, params);
	return fill(CATALOGUES[active][message] ?? message, params);
}

/** Every message the English catalogue answers to; used by the coverage test. */
export function catalogueFor(locale: Locale): Catalogue {
	return CATALOGUES[locale];
}
