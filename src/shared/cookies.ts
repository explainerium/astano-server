import type { CookieOptions } from "express"
import { env } from "../config/env"

/**
 * Attributes for every cookie this API sets — the guest-session tokens (cart,
 * quote basket, wishlist, configurator) and the refresh token.
 *
 * Centralised because the correct value depends on where the site and the API
 * are deployed relative to each other, and getting it wrong fails silently.
 * A `SameSite=Lax` cookie is simply not sent on a cross-site request: the
 * basket empties itself between page loads, nothing is logged, and the bug
 * looks like a caching problem for a day.
 *
 * See COOKIE_SAMESITE in config/env.ts for which value to use.
 */
export const cookieOptions = (maxAgeMs?: number): CookieOptions => ({
	httpOnly: true,
	secure: env.COOKIE_SECURE,
	sameSite: env.COOKIE_SAMESITE,
	path: "/",
	...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
	...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
})

/**
 * Clearing must repeat the attributes the cookie was written with. A browser
 * matches on name, domain and path, so a `clearCookie` that omits the domain
 * leaves the original in place.
 */
export const clearCookieOptions = (): CookieOptions => ({
	path: "/",
	...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
})
