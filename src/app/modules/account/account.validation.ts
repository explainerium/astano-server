import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"

const countryCode = z.string().trim().toUpperCase().length(2, "Use a 2-letter ISO country code")

/**
 * Email is deliberately absent.
 *
 * Changing the address a customer signs in with is an account-security action,
 * not a profile edit — it needs the current password and a confirmation link to
 * the new address. Letting it through here would mean a stolen session could
 * quietly take the account over. See requestEmailChangeSchema below.
 */
export const updateProfileSchema = z.object({
	body: z.object({
		salutation: z.string().trim().max(20).nullable().optional(),
		firstName: z.string().trim().min(1).max(100).nullable().optional(),
		lastName: z.string().trim().min(1).max(100).nullable().optional(),
		company: z.string().trim().max(200).nullable().optional(),
		phone: z.string().trim().max(50).nullable().optional(),
		/**
		 * Editable, but editing it un-validates it. Reverse charge depends on the
		 * validated flag, so a fresh number has to be checked against VIES again
		 * before it can zero anyone's tax — see updateProfile.
		 */
		vatNumber: z.string().trim().max(30).nullable().optional(),
		foundingDate: z.coerce.date().nullable().optional(),
		psiMember: z.boolean().optional(),
		locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional(),
	}),
})

/**
 * The current password is required, and this is the point of the endpoint.
 *
 * A confirmation link alone proves that whoever asked can read the *new* mailbox
 * — it says nothing about whether they are the account's owner. Someone with a
 * borrowed session could otherwise point the account at an address of their own
 * and take it over at leisure. The password is what proves the request came from
 * the owner; the link proves the destination is real. Both, or neither is worth
 * much.
 */
export const requestEmailChangeSchema = z.object({
	body: z.object({
		email: z.string().trim().toLowerCase().email("Enter a valid email address"),
		currentPassword: z.string().min(1, "Your current password is required"),
	}),
})

export const verifyEmailChangeSchema = z.object({
	body: z.object({
		token: z.string().min(32, "A valid confirmation token is required"),
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
	requestEmailChangeSchema,
	verifyEmailChangeSchema,
	createAddressSchema,
	updateAddressSchema,
	idSchema,
}
