import rateLimit from "express-rate-limit"

/**
 * Rate limits for the endpoints that do real work on someone else's behalf.
 *
 * Credential endpoints have their own tighter limit in auth.routes.ts. These
 * cover the rest: placing orders, submitting quotes, and calling VIES — the
 * last especially, because that is the European Commission's service to abuse,
 * not ours.
 *
 * express-rate-limit v8 API. Do not copy a v7 config into this.
 */
const make = (limit: number, windowMs: number, message: string) =>
	rateLimit({
		windowMs,
		limit,
		standardHeaders: "draft-7",
		legacyHeaders: false,
		message: { success: false, statusCode: 429, message },
	})

/** Checkout and quote submission: generous for a human, useless for a script. */
export const writeLimiter = make(
	30,
	15 * 60 * 1000,
	"Too many requests. Please slow down and try again shortly."
)

/** VIES is a third-party service — this protects them as much as us. */
export const externalLimiter = make(
	10,
	15 * 60 * 1000,
	"Too many validation attempts. Please try again later."
)

/**
 * Uploads, which cost money rather than merely time.
 *
 * Every other endpoint here writes rows; this one writes 10 MB objects into the
 * bucket the shop is billed for, and it was the one path with no limit at all —
 * any signed-in customer could fill it as fast as their connection allowed.
 * Sixty in a quarter of an hour is far beyond the six files a product accepts
 * and nowhere near enough to be worth attempting.
 */
export const uploadLimiter = make(
	60,
	15 * 60 * 1000,
	"Too many uploads. Please wait a moment and try again."
)

/**
 * The media library, which only staff can reach.
 *
 * Sixty per quarter hour was the customer figure applied to a staff-only route,
 * where it protects nobody — a customer cannot reach this endpoint at all, so
 * the only person it ever stopped was the shop filling its own library. It
 * stopped the WordPress import at file sixty-one, and it would stop the client
 * the first time they select a folder's worth of photographs.
 *
 * Still limited rather than unlimited: a runaway script is a real way to spend
 * a storage bill, and a ceiling nobody reaches by hand is free. Two thousand is
 * roughly twice the whole of the old shop's media library.
 */
export const mediaLibraryLimiter = make(
	2000,
	15 * 60 * 1000,
	"Too many uploads. Please wait a moment and try again."
)
