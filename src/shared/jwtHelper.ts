import jwt, { type JwtPayload, type Secret, type SignOptions } from "jsonwebtoken"
import type { UserRole, UserStatus } from "@prisma/client"
import { env } from "../config"

export interface AccessTokenPayload extends JwtPayload {
	sub: string
	role: UserRole
	status: UserStatus
}

/**
 * Role and status both travel in the access token so a guard can reject a
 * suspended account without a database round trip. The trade-off is that a
 * status change takes effect on the next token refresh rather than instantly —
 * acceptable at a 15-minute access-token lifetime.
 */
export const signAccessToken = (payload: {
	sub: string
	role: UserRole
	status: UserStatus
}): string =>
	jwt.sign(payload, env.JWT_ACCESS_SECRET as Secret, {
		expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
	})

export const verifyAccessToken = (token: string): AccessTokenPayload =>
	jwt.verify(token, env.JWT_ACCESS_SECRET as Secret) as AccessTokenPayload
