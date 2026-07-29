import type { NextFunction, Request, Response } from "express"
import type { UserRole } from "@prisma/client"
import { httpStatus } from "../../shared/httpStatus"
import { verifyAccessToken, type AccessTokenPayload } from "../../shared/jwtHelper"
import ApiError from "../errors/ApiError"

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		interface Request {
			user?: AccessTokenPayload
		}
	}
}

/**
 * Route guard.
 *
 *   auth()                         any authenticated, ACTIVE user
 *   auth("ADMIN", "SHOP_MANAGER")  staff only
 *
 * Two checks, always. Role alone is not enough: a RESELLER can exist with
 * status PENDING while an admin reviews the application (§4.1), and such an
 * account must not reach protected routes.
 */
export const auth =
	(...allowedRoles: UserRole[]) =>
	(req: Request, _res: Response, next: NextFunction): void => {
		const header = req.headers.authorization

		if (!header?.startsWith("Bearer ")) {
			return next(
				new ApiError(httpStatus.UNAUTHORIZED, "Authentication required", {
					messageKey: "auth.required",
				})
			)
		}

		let payload: AccessTokenPayload
		try {
			payload = verifyAccessToken(header.slice(7))
		} catch {
			return next(
				new ApiError(httpStatus.UNAUTHORIZED, "Invalid or expired token", {
					messageKey: "auth.invalidToken",
				})
			)
		}

		if (payload.status !== "ACTIVE") {
			return next(
				new ApiError(httpStatus.FORBIDDEN, "Account is not active", {
					messageKey:
						payload.status === "PENDING" ? "auth.pending" : "auth.rejected",
				})
			)
		}

		if (allowedRoles.length && !allowedRoles.includes(payload.role)) {
			return next(
				new ApiError(httpStatus.FORBIDDEN, "Insufficient permissions", {
					messageKey: "common.forbidden",
				})
			)
		}

		req.user = payload
		next()
	}

export default auth
