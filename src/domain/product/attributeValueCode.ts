/**
 * A code for a value typed straight into a product, unique within its
 * attribute.
 *
 * Codes are what the dashboard and the importers match on, and they have to be
 * unique per attribute (`@@unique([attributeId, code])`). A typed value gets
 * its code from its label — "Kupfer matt" → "kupfer-matt" — and a number when
 * that is taken, so two labels that slug the same ("Kupfer matt", "Kupfer-Matt")
 * are still two values rather than a database error.
 */
export const uniqueValueCode = (slug: string, taken: Iterable<string>, fallback = "wert"): string => {
	const base = (slug || fallback).slice(0, 55)
	const used = new Set(taken)
	if (!used.has(base)) return base

	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`
		if (!used.has(candidate)) return candidate
	}
}

/** Whether a typed label is one the attribute already has, ignoring case and spacing. */
export const sameLabel = (a: string, b: string): boolean =>
	a.trim().replace(/\s+/g, " ").toLocaleLowerCase("de") === b.trim().replace(/\s+/g, " ").toLocaleLowerCase("de")
