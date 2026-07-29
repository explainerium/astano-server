import bcrypt from "bcrypt"
import type { User } from "@prisma/client"
import { env } from "../../../config"
import { httpStatus } from "../../../shared/httpStatus"
import { signAccessToken } from "../../../shared/jwtHelper"
import { logger } from "../../../shared/logger"
import { prisma } from "../../../shared/prisma"
import { durationToMs, generateToken, hashToken } from "../../../shared/token"
import ApiError from "../../errors/ApiError"
import { BCRYPT_ROUNDS, RESET_TOKEN_TTL } from "./auth.constant"
import { type AuthResult, type PublicUser, toPublicUser } from "./auth.interface"

interface DeviceInfo {
	userAgent?: string
	ipAddress?: string
}

/** Issue an access token plus a fresh refresh token row. */
const issueTokens = async (user: User, device: DeviceInfo): Promise<AuthResult> => {
	const accessToken = signAccessToken({
		sub: user.id,
		role: user.role,
		status: user.status,
	})

	const refreshToken = generateToken()

	await prisma.refreshToken.create({
		data: {
			userId: user.id,
			tokenHash: hashToken(refreshToken),
			expiresAt: new Date(Date.now() + durationToMs(env.JWT_REFRESH_EXPIRES_IN)),
			userAgent: device.userAgent ?? null,
			ipAddress: device.ipAddress ?? null,
		},
	})

	return { accessToken, refreshToken, user: toPublicUser(user) }
}

const register = async (
	payload: {
		email: string
		password: string
		firstName?: string
		lastName?: string
		company?: string
		phone?: string
		locale?: string
	},
	device: DeviceInfo
): Promise<AuthResult> => {
	const existing = await prisma.user.findUnique({ where: { email: payload.email } })
	if (existing) {
		throw new ApiError(httpStatus.CONFLICT, "Email already registered", {
			messageKey: "auth.emailTaken",
		})
	}

	// Self-registration always produces an ACTIVE B2C account. Becoming a
	// RESELLER is a separate, admin-approved flow (§4.4) — it is never something
	// a request body can ask for.
	const user = await prisma.user.create({
		data: {
			email: payload.email,
			passwordHash: await bcrypt.hash(payload.password, BCRYPT_ROUNDS),
			role: "B2C",
			status: "ACTIVE",
			firstName: payload.firstName ?? null,
			lastName: payload.lastName ?? null,
			company: payload.company ?? null,
			phone: payload.phone ?? null,
			locale: payload.locale ?? "en",
		},
	})

	return issueTokens(user, device)
}

const login = async (
	payload: { email: string; password: string },
	device: DeviceInfo
): Promise<AuthResult> => {
	const user = await prisma.user.findUnique({ where: { email: payload.email } })

	// Same error whether the address is unknown or the password is wrong —
	// otherwise this endpoint becomes a way to enumerate customers.
	const invalid = new ApiError(httpStatus.UNAUTHORIZED, "Invalid email or password", {
		messageKey: "auth.invalidCredentials",
	})

	if (!user) {
		// Spend comparable time on a miss so response timing does not leak
		// whether the account exists.
		await bcrypt.compare(payload.password, "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva")
		throw invalid
	}

	if (!(await bcrypt.compare(payload.password, user.passwordHash))) throw invalid

	if (user.status === "REJECTED") {
		throw new ApiError(httpStatus.FORBIDDEN, "This account has been rejected", {
			messageKey: "auth.rejected",
		})
	}

	// PENDING accounts may sign in — they need to see their application status —
	// but the auth() guard keeps them out of protected routes, and R5b prices
	// them as a guest.
	await prisma.user.update({
		where: { id: user.id },
		data: { lastLoginAt: new Date() },
	})

	return issueTokens(user, device)
}

/** Rotate: the presented refresh token is revoked and a new one issued. */
const refresh = async (token: string, device: DeviceInfo): Promise<AuthResult> => {
	const stored = await prisma.refreshToken.findUnique({
		where: { tokenHash: hashToken(token) },
		include: { user: true },
	})

	const invalid = new ApiError(httpStatus.UNAUTHORIZED, "Invalid refresh token", {
		messageKey: "auth.invalidToken",
	})

	if (!stored || stored.revokedAt || stored.expiresAt < new Date()) throw invalid
	if (stored.user.status === "REJECTED") throw invalid

	await prisma.refreshToken.update({
		where: { id: stored.id },
		data: { revokedAt: new Date() },
	})

	return issueTokens(stored.user, device)
}

const logout = async (token: string | undefined): Promise<void> => {
	if (!token) return

	// updateMany, not update — logging out twice must not throw.
	await prisma.refreshToken.updateMany({
		where: { tokenHash: hashToken(token), revokedAt: null },
		data: { revokedAt: new Date() },
	})
}

const me = async (userId: string): Promise<PublicUser> => {
	const user = await prisma.user.findUnique({ where: { id: userId } })
	if (!user) {
		throw new ApiError(httpStatus.NOT_FOUND, "User not found", {
			messageKey: "auth.userNotFound",
		})
	}
	return toPublicUser(user)
}

/**
 * Always resolves, whether or not the address exists — otherwise the endpoint
 * confirms which emails are registered.
 */
const forgotPassword = async (email: string): Promise<{ resetToken?: string }> => {
	const user = await prisma.user.findUnique({ where: { email } })
	if (!user) return {}

	const resetToken = generateToken()

	await prisma.passwordResetToken.create({
		data: {
			userId: user.id,
			tokenHash: hashToken(resetToken),
			expiresAt: new Date(Date.now() + durationToMs(RESET_TOKEN_TTL)),
		},
	})

	// TODO(Phase 3): send this by email instead. Until the mailer exists the
	// token is logged in development only, so the flow is testable.
	if (env.NODE_ENV === "development") {
		logger.info({ email }, `password reset token: ${resetToken}`)
		return { resetToken }
	}

	return {}
}

const resetPassword = async (token: string, newPassword: string): Promise<void> => {
	const stored = await prisma.passwordResetToken.findUnique({
		where: { tokenHash: hashToken(token) },
	})

	if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
		throw new ApiError(httpStatus.BAD_REQUEST, "Invalid or expired reset token", {
			messageKey: "auth.invalidResetToken",
		})
	}

	// Changing a password logs every device out — that is the point of a reset.
	await prisma.$transaction([
		prisma.user.update({
			where: { id: stored.userId },
			data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
		}),
		prisma.passwordResetToken.update({
			where: { id: stored.id },
			data: { usedAt: new Date() },
		}),
		prisma.refreshToken.updateMany({
			where: { userId: stored.userId, revokedAt: null },
			data: { revokedAt: new Date() },
		}),
	])
}

const changePassword = async (
	userId: string,
	currentPassword: string,
	newPassword: string
): Promise<void> => {
	const user = await prisma.user.findUnique({ where: { id: userId } })
	if (!user) {
		throw new ApiError(httpStatus.NOT_FOUND, "User not found", {
			messageKey: "auth.userNotFound",
		})
	}

	if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
		throw new ApiError(httpStatus.UNAUTHORIZED, "Current password is incorrect", {
			messageKey: "auth.invalidCredentials",
		})
	}

	await prisma.$transaction([
		prisma.user.update({
			where: { id: userId },
			data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
		}),
		prisma.refreshToken.updateMany({
			where: { userId, revokedAt: null },
			data: { revokedAt: new Date() },
		}),
	])
}

export const AuthService = {
	register,
	login,
	refresh,
	logout,
	me,
	forgotPassword,
	resetPassword,
	changePassword,
}
