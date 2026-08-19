import { DEFAULT_LOCALE, type LocaleCode } from "./locales"
import { env } from "./env"
import { logger } from "../shared/logger"

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
/**
 * Said once per process, not once per email.
 *
 * A production deployment whose SHOP_BASE_URL still resolves to localhost sends
 * password-reset links nobody outside the server can open — and the failure is
 * entirely silent: the mail arrives, it looks right, and the customer gets a
 * page that will not load. There is no request to attach the warning to and no
 * boot on serverless, so it is raised here, the first time a link is built.
 */
let warned = false

const warnIfUnreachable = (): void => {
	if (warned || env.NODE_ENV !== "production") return
	if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(env.SHOP_BASE_URL)) return

	warned = true
	logger.error(
		{ shopBaseUrl: env.SHOP_BASE_URL },
		"SHOP_BASE_URL points at localhost in production — every link emailed to a customer is unreachable. " +
			"Set SHOP_BASE_URL (or CORS_ORIGINS, which it falls back to) to the storefront's public URL."
	)
}

export const shopUrl = (page: ShopPage, locale: LocaleCode, query?: Record<string, string>): string => {
	warnIfUnreachable()

	const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`
	const path = PATHS[page][locale as keyof (typeof PATHS)[ShopPage]] ?? PATHS[page].en
	const search = query ? `?${new URLSearchParams(query).toString()}` : ""

	return `${env.SHOP_BASE_URL}${prefix}${path}${search}`
}
