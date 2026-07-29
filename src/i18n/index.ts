/**
 * UI string translation.
 *
 * This handles *interface* strings only — errors, emails, labels. Content
 * translation (product names, slugs, descriptions) lives in the database as
 * rows, never here. Keeping the two apart is what stops a multilingual
 * codebase from rotting.
 *
 * Message files are loaded eagerly at boot: they are small, and a missing file
 * should fail immediately rather than on the first German request.
 */
import { DEFAULT_LOCALE, type LocaleCode, SUPPORTED_LOCALES } from "../config/locales"

type Catalog = Record<string, string>

const catalogs: Record<string, Catalog> = {}

for (const code of SUPPORTED_LOCALES) {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	catalogs[code] = require(`./messages/${code}.json`) as Catalog
}

/**
 * Translate a key. Falls back to the default locale, then to the key itself —
 * a missing translation degrades to something readable, never to "undefined".
 *
 * Interpolation uses {name} placeholders.
 */
export const t = (
	key: string,
	locale: LocaleCode = DEFAULT_LOCALE,
	vars?: Record<string, string | number>
): string => {
	const message = catalogs[locale]?.[key] ?? catalogs[DEFAULT_LOCALE]?.[key] ?? key

	if (!vars) return message

	return message.replace(/\{(\w+)\}/g, (match, name: string) =>
		name in vars ? String(vars[name]) : match
	)
}

/** Keys present in the default catalog but missing elsewhere — for a health check. */
export const missingTranslations = (): Record<string, string[]> => {
	const base = Object.keys(catalogs[DEFAULT_LOCALE] ?? {})
	const gaps: Record<string, string[]> = {}

	for (const code of SUPPORTED_LOCALES) {
		if (code === DEFAULT_LOCALE) continue
		const missing = base.filter((key) => !(key in (catalogs[code] ?? {})))
		if (missing.length) gaps[code] = missing
	}

	return gaps
}
