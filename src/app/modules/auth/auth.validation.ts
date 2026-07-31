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

const countryCode = z.string().trim().toUpperCase().length(2, "Use a 2-letter ISO country code")

/**
 * B2C self-registration — the native form on My Account (§4.4).
 *
 * Deliberately the same 16 fields as the dealer form. astano sells to bakeries,
 * so company and a full address are required here too; the difference between
 * the two forms is the outcome, not the questions. This one produces an ACTIVE
 * B2C account immediately, the dealer form a PENDING RESELLER.
 */
export const registerSchema = z.object({
	body: z.object({
		// Account
		email,
		password,
		locale,

		// Contact
		salutation: z.string().trim().max(40).optional(),
		firstName: z.string().trim().min(1, "First name is required").max(100),
		lastName: z.string().trim().min(1, "Last name is required").max(100),
		phone: z.string().trim().max(50).optional(),

		// Business
		company: z.string().trim().min(1, "Company is required").max(200),
		foundingDate: z.coerce.date().optional(),
		vatNumber: z.string().trim().max(40).optional(),
		psiMember: z.boolean().default(false),

		// Address — becomes the customer's first address-book entry.
		street: z.string().trim().min(1, "Street is required").max(200),
		street2: z.string().trim().max(200).optional(),
		postcode: z.string().trim().min(1, "Postcode is required").max(30),
		city: z.string().trim().min(1, "City is required").max(120),
		countryCode: countryCode.default("DE"),

		/// Must be true, not merely present — an unchecked box is a refusal.
		acceptedTerms: z.literal(true, {
			message: "The terms and privacy policy must be accepted",
		}),

		/// Honeypot. Named after the trap field on the old form (`email_2`).
		/// Permissive on purpose: a validation error would tell a bot exactly
		/// which field gave it away, so the handler decides instead.
		email2: z.string().max(500).optional(),
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
