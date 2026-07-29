import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"

const email = z.string().trim().toLowerCase().email("A valid email address is required")

/**
 * Minimum 8 characters. Deliberately no composition rules (upper/digit/symbol):
 * they push people toward "Passw0rd!" and measurably reduce entropy. Length is
 * what matters.
 */
const password = z.string().min(8, "Password must be at least 8 characters")

const locale = z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional()

export const registerSchema = z.object({
	body: z.object({
		email,
		password,
		firstName: z.string().trim().min(1).max(100).optional(),
		lastName: z.string().trim().min(1).max(100).optional(),
		company: z.string().trim().max(200).optional(),
		phone: z.string().trim().max(50).optional(),
		locale,
	}),
})

export const loginSchema = z.object({
	body: z.object({
		email,
		password: z.string().min(1, "Password is required"),
	}),
})

export const refreshSchema = z.object({
	body: z.object({
		refreshToken: z.string().min(1).optional(),
	}),
})

export const forgotPasswordSchema = z.object({
	body: z.object({ email }),
})

export const resetPasswordSchema = z.object({
	body: z.object({
		token: z.string().min(1, "Reset token is required"),
		password,
	}),
})

export const changePasswordSchema = z.object({
	body: z.object({
		currentPassword: z.string().min(1),
		newPassword: password,
	}),
})

export const AuthValidation = {
	registerSchema,
	loginSchema,
	refreshSchema,
	forgotPasswordSchema,
	resetPasswordSchema,
	changePasswordSchema,
}
