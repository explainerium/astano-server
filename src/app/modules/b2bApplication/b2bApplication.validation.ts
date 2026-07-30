import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"

const countryCode = z.string().trim().toUpperCase().length(2, "Use a 2-letter ISO country code")

/**
 * The dealer registration form.
 *
 * Creates the account AND the application in one step. The account is made
 * RESELLER/PENDING immediately so the applicant can sign in and watch their
 * status — rule R5b keeps them on guest prices until an admin approves, so
 * registering cannot itself unlock wholesale pricing.
 */
export const applySchema = z.object({
	body: z.object({
		// Account
		email: z.string().trim().toLowerCase().email(),
		password: z.string().min(8, "Password must be at least 8 characters"),
		locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional(),

		// Business
		companyName: z.string().trim().min(1).max(200),
		vatNumber: z.string().trim().max(40).optional(),
		registerNumber: z.string().trim().max(60).optional(),
		foundingDate: z.coerce.date().optional(),
		website: z.string().trim().max(200).optional(),
		businessType: z.string().trim().max(120).optional(),
		expectedVolume: z.string().trim().max(200).optional(),
		psiMember: z.boolean().default(false),

		// Address
		street: z.string().trim().min(1).max(200),
		street2: z.string().trim().max(200).optional(),
		postcode: z.string().trim().min(1).max(30),
		city: z.string().trim().min(1).max(120),
		countryCode,

		// Contact
		salutation: z.string().trim().max(40).optional(),
		firstName: z.string().trim().min(1).max(100),
		lastName: z.string().trim().min(1).max(100),
		phone: z.string().trim().max(50).optional(),

		message: z.string().trim().max(2000).optional(),
	}),
})

export const listSchema = z.object({
	query: z.object({
		status: z.enum(["ACTIVE", "PENDING", "REJECTED"]).optional(),
		search: z.string().trim().max(200).optional(),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(100).default(20),
	}),
})

export const idSchema = z.object({ params: z.object({ id: z.string().uuid() }) })

export const decisionSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		approve: z.boolean(),
		note: z.string().trim().max(1000).optional(),
	}),
})

export const B2bValidation = { applySchema, listSchema, idSchema, decisionSchema }
