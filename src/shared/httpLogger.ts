import type { IncomingMessage, ServerResponse } from "http"
import pinoHttp from "pino-http"
import { DEFAULT_LOCALE } from "../config/locales"
import { logger } from "./logger"

/**
 * Request logging, deliberately terse.
 *
 * pino-http's defaults serialize every request and response header, which
 * produces ~40 lines per request and makes the terminal useless during
 * development. We keep one line per request — method, path, status, duration —
 * and let the error handler carry the detail when something actually fails.
 */
/**
 * resolveLocale rewrites req.url to strip the language prefix, so by the time
 * the response finishes "/de/health" has become "/health". Express keeps the
 * untouched path on originalUrl — log that, or German traffic is invisible.
 */
const originalUrl = (req: IncomingMessage): string =>
	(req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? "/"

/** Only annotate non-default locales, so English traffic stays uncluttered. */
const localeTag = (req: IncomingMessage): string => {
	const locale = (req as IncomingMessage & { locale?: string }).locale
	return locale && locale !== DEFAULT_LOCALE ? ` [${locale}]` : ""
}

export const httpLogger = pinoHttp({
	logger,

	// Browsers request this on every page view; it is never interesting.
	autoLogging: {
		ignore: (req: IncomingMessage) => req.url === "/favicon.ico",
	},

	// Health checks are noise once a monitor starts polling them.
	customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
		if (err || res.statusCode >= 500) return "error"
		if (res.statusCode >= 400) return "warn"
		return "info"
	},

	customSuccessMessage: (req: IncomingMessage, res: ServerResponse, responseTime: number) =>
		`${req.method} ${originalUrl(req)} ${res.statusCode} - ${responseTime}ms${localeTag(req)}`,

	customErrorMessage: (req: IncomingMessage, res: ServerResponse, err: Error) =>
		`${req.method} ${originalUrl(req)} ${res.statusCode} - ${err.message}${localeTag(req)}`,

	// Drop the default req/res objects entirely; the message above says it all.
	// pino omits properties whose serializer returns undefined.
	serializers: {
		req: () => undefined,
		res: () => undefined,
		err: () => undefined,
	},
})

export default httpLogger
