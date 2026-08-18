import { DEFAULT_LOCALE, type LocaleCode } from "./locales"
import { env } from "./env"

/**
 * Links into the storefront, composed here because the email is composed here.
 *
 * The pages live in the other repository and their slugs are translated, so
 * this file necessarily repeats them. That duplication is the price of sending
 * mail from the API at all — what it must not become is a duplication nobody
 * knows about, so: **keep in step with `pathnames` in
 * frontend/src/i18n/routing.ts.**
 *
 * Was written out at each call site, which is how the email-change link came to
 * be built from `PUBLIC_BASE_URL` — the API's own origin — and arrived pointing
 * at a URL that answers 404 in JSON. One helper, one base, one place to be
 * wrong.
 */

/** Translated slugs, matching the frontend's routing map. */
const PATHS = {
	verifyEmail: { en: "/verify-email", de: "/e-mail-bestaetigen" },
	resetPassword: { en: "/reset-password", de: "/passwort-zuruecksetzen" },
} as const

export type ShopPage = keyof typeof PATHS

/**
 * `SHOP_BASE_URL`, never `PUBLIC_BASE_URL`.
 *
 * The first is where a person can open a page; the second is where this API
 * answers. Media URLs want the API. Everything a human clicks wants the shop.
 *
 * The locale prefix matches the frontend's `localePrefix: "as-needed"` — German
 * is the default and takes no prefix, English is served under /en.
 */
export const shopUrl = (page: ShopPage, locale: LocaleCode, query?: Record<string, string>): string => {
	const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`
	const path = PATHS[page][locale as keyof (typeof PATHS)[ShopPage]] ?? PATHS[page].en
	const search = query ? `?${new URLSearchParams(query).toString()}` : ""

	return `${env.SHOP_BASE_URL}${prefix}${path}${search}`
}
