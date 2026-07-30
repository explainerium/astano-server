import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"

const countryCode = z.string().trim().toUpperCase().length(2, "Use a 2-letter ISO country code")

/**
 * Email is deliberately absent.
 *
 * Changing the address a customer signs in with is an account-security action,
 * not a profile edit — it needs the current password and a confirmation link to
 * the new address. Letting it through here would mean a stolen session could
 * quietly take the account over.
 */
export const updateProfileSchema = z.object({
	body: z.object({
		firstName: z.string().trim().min(1).max(100).nullable().optional(),
		lastName: z.string().trim().min(1).max(100).nullable().optional(),
		company: z.string().trim().max(200).nullable().optional(),
		phone: z.string().trim().max(50).nullable().optional(),
		locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional(),
	}),
})

const addressBody = {
	label: z.string().trim().max(60).nullable().optional(),
	firstName: z.string().trim().min(1).max(100),
	lastName: z.string().trim().min(1).max(100),
	company: z.string().trim().max(200).nullable().optional(),
	street1: z.string().trim().min(1).max(200),
	street2: z.string().trim().max(200).nullable().optional(),
	city: z.string().trim().min(1).max(120),
	state: z.string().trim().max(120).nullable().optional(),
	postcode: z.string().trim().min(1).max(30),
	countryCode,
	phone: z.string().trim().max(50).nullable().optional(),
	email: z.string().trim().toLowerCase().email().nullable().optional(),
	isDefaultBilling: z.boolean().default(false),
	isDefaultShipping: z.boolean().default(false),
}

export const createAddressSchema = z.object({ body: z.object(addressBody) })

/** Explicit, not `.partial()` — see the note in product.validation.ts. */
export const updateAddressSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		label: z.string().trim().max(60).nullable().optional(),
		firstName: z.string().trim().min(1).max(100).optional(),
		lastName: z.string().trim().min(1).max(100).optional(),
		company: z.string().trim().max(200).nullable().optional(),
		street1: z.string().trim().min(1).max(200).optional(),
		street2: z.string().trim().max(200).nullable().optional(),
		city: z.string().trim().min(1).max(120).optional(),
		state: z.string().trim().max(120).nullable().optional(),
		postcode: z.string().trim().min(1).max(30).optional(),
		countryCode: countryCode.optional(),
		phone: z.string().trim().max(50).nullable().optional(),
		email: z.string().trim().toLowerCase().email().nullable().optional(),
		isDefaultBilling: z.boolean().optional(),
		isDefaultShipping: z.boolean().optional(),
	}),
})

export const idSchema = z.object({ params: z.object({ id: z.string().uuid() }) })

export const AccountValidation = {
	updateProfileSchema,
	createAddressSchema,
	updateAddressSchema,
	idSchema,
}
