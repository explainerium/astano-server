import type { NextFunction, Request, Response } from "express"
import { verifyAccessToken } from "../../shared/jwtHelper"

/**
 * Attaches req.user when a valid token is present, and does nothing otherwise.
 *
 * Public catalogue endpoints need this: a guest, a B2C customer and a Reseller
 * all hit the same URL but must see different prices (§4.2). An invalid or
 * expired token is treated as anonymous rather than as an error — a stale token
 * should show guest prices, not break the shop.
 */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
	const header = req.headers.authorization

	if (header?.startsWith("Bearer ")) {
		try {
			req.user = verifyAccessToken(header.slice(7))
		} catch {
			// Deliberately ignored — carry on as a guest.
		}
	}

	next()
}

export default optionalAuth
