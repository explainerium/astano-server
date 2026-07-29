import { getLocale, type LocaleCode } from "../config/locales"

/**
 * URL slug generation, locale-aware.
 *
 * German must not lose its umlauts to a naive strip: "Ausstechformen für
 * Kühlakkus" has to become "ausstechformen-fuer-kuehlakkus", not
 * "ausstechformen-fr-khlakkus". The per-locale replacement map lives in
 * config/locales.ts, so adding a language brings its own rules.
 */
export const slugify = (input: string, locale: LocaleCode): string => {
	const { slugReplacements } = getLocale(locale)

	let value = input.trim()

	// Locale-specific transliteration first — before any Unicode normalisation
	// strips the diacritics we are trying to expand.
	for (const [from, to] of Object.entries(slugReplacements)) {
		value = value.split(from).join(to)
	}

	return value
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "") // remaining accents
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 200)
}

/**
 * Appends -2, -3 … until the slug is unique. `exists` is injected so this stays
 * free of database imports and testable.
 */
export const uniqueSlug = async (
	base: string,
	exists: (candidate: string) => Promise<boolean>
): Promise<string> => {
	if (!(await exists(base))) return base

	for (let n = 2; n < 1000; n++) {
		const candidate = `${base}-${n}`
		if (!(await exists(candidate))) return candidate
	}

	throw new Error(`Could not derive a unique slug from "${base}"`)
}
