/**
 * THE LANGUAGE REGISTRY.
 *
 * This is the only file that knows which languages exist. To add one:
 *   1. add an entry to LOCALES below
 *   2. add src/i18n/messages/<code>.json
 *   3. add translation rows in the database
 * No module, route or service is touched.
 *
 * English is primary and is served at the site root. Every other locale is
 * served under its own prefix (German at /de/). If that decision is ever
 * reversed, change DEFAULT_LOCALE here — nothing else.
 */

export type LocaleCode = (typeof LOCALES)[number]["code"]

export interface LocaleDefinition {
	/** ISO 639-1 code. Also the URL prefix for non-default locales. */
	code: string
	/** Human label, in the language itself — for language switchers. */
	label: string
	/** Value for <html lang> and hreflang. */
	hreflang: string
	/** Intl locale used for number/date formatting. */
	intl: string
	/**
	 * Character replacements applied before slugification.
	 * German must not lose its umlauts to a naive strip: "Ausstechformen für
	 * Kühlakkus" has to become "ausstechformen-fuer-kuehlakkus", not
	 * "ausstechformen-fr-khlakkus".
	 */
	slugReplacements: Record<string, string>
}

export const LOCALES = [
	{
		code: "en",
		label: "English",
		hreflang: "en",
		intl: "en-GB",
		slugReplacements: {},
	},
	{
		code: "de",
		label: "Deutsch",
		hreflang: "de",
		intl: "de-DE",
		slugReplacements: {
			ä: "ae",
			ö: "oe",
			ü: "ue",
			Ä: "Ae",
			Ö: "Oe",
			Ü: "Ue",
			ß: "ss",
		},
	},
] as const satisfies readonly LocaleDefinition[]

/** Served at the root path. */
export const DEFAULT_LOCALE: LocaleCode = "en"

export const SUPPORTED_LOCALES: readonly LocaleCode[] = LOCALES.map((l) => l.code)

export const isSupportedLocale = (value: unknown): value is LocaleCode =>
	typeof value === "string" && SUPPORTED_LOCALES.includes(value as LocaleCode)

export const getLocale = (code: LocaleCode): LocaleDefinition =>
	LOCALES.find((l) => l.code === code) ?? LOCALES.find((l) => l.code === DEFAULT_LOCALE)!

/** URL prefix for a locale — "" for the default, "/de" for the rest. */
export const localePrefix = (code: LocaleCode): string =>
	code === DEFAULT_LOCALE ? "" : `/${code}`
