import type { NextFunction, Request, Response } from "express"
import type { UserRole, UserStatus } from "@prisma/client"
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

const MESSAGE_FOR: Record<string, string> = {
	PENDING: "auth.pending",
	REJECTED: "auth.rejected",
	SUSPENDED: "auth.suspended",
	DRAFT: "auth.draft",
}

/**
 * The shared body of both guards below.
 *
 * `allowed` is the set of account states this route will serve. Role is checked
 * second and separately: role says what someone is, status says whether they
 * may act, and conflating the two is how a PENDING reseller ends up with
 * wholesale prices.
 */
const guard =
	(allowed: readonly UserStatus[]) =>
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

		if (!allowed.includes(payload.status)) {
			return next(
				new ApiError(httpStatus.FORBIDDEN, "Account is not active", {
					messageKey: MESSAGE_FOR[payload.status] ?? "auth.rejected",
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

/**
 * Route guard for anything that *acts* — carts, checkout, quotes, and every
 * staff route.
 *
 *   auth()                         any authenticated, ACTIVE user
 *   auth("ADMIN", "SHOP_MANAGER")  staff only
 *
 * ACTIVE and nothing else. A RESELLER can exist as PENDING while an admin
 * reviews the application (§4.1), and a suspended customer is deliberately kept
 * out of trading; neither belongs behind this guard.
 */
export const auth = guard(["ACTIVE"])

/**
 * Route guard for a signed-in person looking at *their own* account.
 *
 * Also serves SUSPENDED. Suspension is a commercial measure — it stops someone
 * buying, it does not lock them out of their own invoices, their address book
 * or the ability to correct their details. Locking those away would mostly
 * generate support mail, and would leave a customer unable to fix the very
 * thing the suspension is about.
 *
 * Never use this on anything that spends money or creates an obligation.
 */
export const authAccount = guard(["ACTIVE", "SUSPENDED"])

export default auth
