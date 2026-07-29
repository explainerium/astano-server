import type { NextFunction, Request, Response } from "express"
import { DEFAULT_LOCALE, isSupportedLocale } from "../../config/locales"

/**
 * Resolves the request locale, in priority order:
 *   1. an explicit ?lang= query parameter   (useful for testing and for links)
 *   2. the first URL segment                (/de/products -> de)
 *   3. the X-Locale header                  (sent by the Next.js frontend)
 *   4. Accept-Language                      (first supported match)
 *   5. DEFAULT_LOCALE
 *
 * When the first segment is a locale it is stripped from req.url, so routers
 * mount once at /api/... and never need to know about languages.
 */
export const resolveLocale = (req: Request, _res: Response, next: NextFunction): void => {
	const fromQuery = req.query.lang
	if (isSupportedLocale(fromQuery)) {
		req.locale = fromQuery
		return next()
	}

	const [, first] = req.url.split("/")
	if (isSupportedLocale(first)) {
		req.locale = first
		req.url = req.url.slice(first.length + 1) || "/"
		return next()
	}

	const fromHeader = req.get("x-locale")
	if (isSupportedLocale(fromHeader)) {
		req.locale = fromHeader
		return next()
	}

	const accept = req.get("accept-language")
	if (accept) {
		const preferred = accept
			.split(",")
			.map((part) => part.split(";")[0]?.trim().slice(0, 2).toLowerCase())
			.find((code) => isSupportedLocale(code))

		if (isSupportedLocale(preferred)) {
			req.locale = preferred
			return next()
		}
	}

	req.locale = DEFAULT_LOCALE
	next()
}
