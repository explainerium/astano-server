/**
 * The naming rules every "Duplicate" action shares.
 *
 * Duplicating is the fastest way to add a product that is nearly like another
 * one — a second size, a variant range, a category with the same settings. What
 * the copy must never do is silently look like the original: two rows with the
 * same name in a list are indistinguishable, and a copy that inherits a live
 * URL or a unique business identifier is worse than no copy at all.
 *
 * So the rules live here rather than three times over: the name says it is a
 * copy, slugs and codes are re-derived rather than reused, and anything unique
 * is either regenerated or left blank for a human to fill in.
 */

/**
 * "Ausstechform Stern" → "Ausstechform Stern (copy)".
 *
 * Names are not unique, so this needs no collision check: duplicating twice
 * gives two rows both called "… (copy)", which is honest — they are both copies
 * and neither is more so than the other. Numbering them would imply an order
 * that means nothing.
 *
 * Copying a copy does not stack the suffix. "X (copy) (copy)" tells the reader
 * nothing "X (copy)" did not, and the string only grows.
 */
export const copyName = (name: string): string =>
	name.endsWith(" (copy)") ? name : `${name} (copy)`

/** The German label, so a copy made in the German editor reads as German. */
export const copyNameDe = (name: string): string =>
	name.endsWith(" (Kopie)") ? name : `${name} (Kopie)`

/** Picks the suffix for a locale, defaulting to English. */
export const copyNameFor = (name: string, locale: string): string =>
	locale === "de" ? copyNameDe(name) : copyName(name)

/**
 * "ausstechform-stern" → "ausstechform-stern-copy".
 *
 * For codes rather than names — an attribute code, anything that has to stay
 * URL- and identifier-safe. The caller still has to make it unique; this only
 * produces the base to search from.
 */
export const copyCode = (code: string): string =>
	code.endsWith("-copy") ? code : `${code}-copy`
