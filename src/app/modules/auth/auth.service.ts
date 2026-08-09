import bcrypt from "bcrypt"
import type { User } from "@prisma/client"
import { env } from "../../../config"
import { httpStatus } from "../../../shared/httpStatus"
import { signAccessToken } from "../../../shared/jwtHelper"
import { logger } from "../../../shared/logger"
import { prisma } from "../../../shared/prisma"
import { durationToMs, generateToken, hashToken } from "../../../shared/token"
import ApiError from "../../errors/ApiError"
import type { LocaleCode } from "../../../config/locales"
import { sendAccountWelcome, sendPasswordReset } from "../../../helpers/mailer"
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
		locale?: string
		salutation?: string
		firstName: string
		lastName: string
		phone?: string
		company: string
		foundingDate?: Date
		vatNumber?: string
		psiMember?: boolean
		street: string
		street2?: string
		postcode: string
		city: string
		countryCode: string
	},
	device: DeviceInfo
): Promise<AuthResult> => {
	const existing = await prisma.user.findUnique({ where: { email: payload.email } })
	if (existing) {
		throw new ApiError(httpStatus.CONFLICT, "Email already registered", {
			messageKey: "auth.emailTaken",
		})
	}

	// Hashed before the transaction opens: bcrypt at cost 12 takes hundreds of
	// milliseconds, and holding a database transaction open for that would pin a
	// connection for no reason.
	const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS)

	// Self-registration always produces an ACTIVE B2C account. Becoming a
	// RESELLER is a separate, admin-approved flow (§4.4) — it is never something
	// a request body can ask for.
	//
	// The account and its address are written together. An account that exists
	// with no address would send the customer to checkout with an empty form
	// having already told us where they live.
	const user = await prisma.$transaction(async (tx) => {
		const created = await tx.user.create({
			data: {
				email: payload.email,
				passwordHash,
				role: "B2C",
				status: "ACTIVE",
				salutation: payload.salutation ?? null,
				firstName: payload.firstName,
				lastName: payload.lastName,
				company: payload.company,
				phone: payload.phone ?? null,
				vatNumber: payload.vatNumber ?? null,
				foundingDate: payload.foundingDate ?? null,
				psiMember: payload.psiMember ?? false,
				// Validation already refused anything but an explicit true.
				termsAcceptedAt: new Date(),
				locale: payload.locale ?? "en",
			},
		})

		await tx.address.create({
			data: {
				userId: created.id,
				firstName: payload.firstName,
				lastName: payload.lastName,
				company: payload.company,
				street1: payload.street,
				street2: payload.street2 ?? null,
				postcode: payload.postcode,
				city: payload.city,
				countryCode: payload.countryCode,
				phone: payload.phone ?? null,
				email: payload.email,
				// Their only address, so it is both defaults — otherwise checkout
				// would show an address book with nothing selected.
				isDefaultBilling: true,
				isDefaultShipping: true,
			},
		})

		return created
	})

	// After the account exists, not inside the transaction: a slow mail server
	// must not hold a database connection, and a registration that succeeded is
	// not undone by a welcome that did not arrive.
	await sendAccountWelcome({
		to: user.email,
		locale: (user.locale || "en") as LocaleCode,
		name: user.firstName ?? "",
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

	/*
	 * A deleted account answers exactly like an unknown one.
	 *
	 * Staff can restore it, so the row is still here and the address is still
	 * taken — but saying so would turn deletion into a way to confirm that
	 * somebody was once a customer. The person holding this password has no
	 * account as far as this endpoint is concerned.
	 */
	if (user.deletedAt) throw invalid

	if (user.status === "REJECTED") {
		throw new ApiError(httpStatus.FORBIDDEN, "This account has been rejected", {
			messageKey: "auth.rejected",
		})
	}

	// Prepared by staff, not handed over yet. There is nothing behind this
	// password to sign in to, and the applicant has not been told it exists.
	if (user.status === "DRAFT") {
		throw new ApiError(httpStatus.FORBIDDEN, "This account is not active yet", {
			messageKey: "auth.draft",
		})
	}

	// PENDING and SUSPENDED accounts may sign in. PENDING needs to see its
	// application status; SUSPENDED needs its own invoices and the chance to
	// correct its details. Neither can trade — the auth() guard keeps them off
	// the trading routes and R5b prices them as guests.
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

	/*
	 * The status is re-read here, and this is the moment a staff decision
	 * actually bites.
	 *
	 * An access token carries the status it was minted with, so suspending
	 * someone does not reach into a token already in the wild. Refusing the
	 * refresh — together with revoking their stored tokens at the moment of the
	 * decision — closes the session as soon as the current access token runs
	 * out. The gap is one access-token lifetime, which is the price of not
	 * querying the database on every single request.
	 */
	if (stored.user.deletedAt) throw invalid
	if (stored.user.status === "REJECTED" || stored.user.status === "DRAFT") throw invalid

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

	await sendPasswordReset({
		to: user.email,
		locale: user.locale as never,
		token: resetToken,
	})

	// Also returned in development so the flow stays testable without a mailbox.
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
