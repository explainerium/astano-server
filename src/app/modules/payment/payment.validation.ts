import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"
import { bankAccountsSchema } from "../../../domain/payment/bankAccounts"

const locale = z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]])
const decimal = z.union([z.string().regex(/^\d+(\.\d{1,4})?$/), z.number().nonnegative()])
const countryCode = z.string().trim().toUpperCase().length(2, "Use a 2-letter ISO country code")
const code = z
	.string()
	.trim()
	.min(1)
	.max(60)
	.regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, "Use lowercase letters, digits, - or _")

const translation = z.object({
	locale,
	title: z.string().trim().min(1).max(160),
	description: z.string().trim().max(2000).optional(),
	/// Shown after ordering and in the confirmation email. Bank details go here.
	instructions: z.string().trim().max(4000).optional(),
})

const rules = {
	allowedCountries: z.array(countryCode).default([]),
	allowedRoles: z.array(z.enum(["GUEST", "B2C", "RESELLER", "SHOP_MANAGER", "ADMIN"])).default([]),
	requiresLogin: z.boolean().default(false),
	minCompletedOrders: z.number().int().min(0).default(0),
	minOrderTotal: decimal.nullable().optional(),
	maxOrderTotal: decimal.nullable().optional(),
	requiresValidatedVatId: z.boolean().default(false),
}

/**
 * Method settings. Still open-ended, but the part the customer sees is typed.
 *
 * `bankAccounts` is validated because it ends up on a thank-you page and in an
 * email — a malformed IBAN saved here is a customer sending money nowhere.
 * Everything else stays free-form so a future provider needs no migration.
 */
const methodConfig = z
	.record(z.string(), z.unknown())
	.and(z.object({ bankAccounts: bankAccountsSchema.optional() }))
	.nullable()
	.optional()

export const updateMethodSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		isActive: z.boolean().optional(),
		sortOrder: z.number().int().optional(),
		allowedCountries: z.array(countryCode).optional(),
		allowedRoles: z.array(z.enum(["GUEST", "B2C", "RESELLER", "SHOP_MANAGER", "ADMIN"])).optional(),
		requiresLogin: z.boolean().optional(),
		minCompletedOrders: z.number().int().min(0).optional(),
		minOrderTotal: decimal.nullable().optional(),
		maxOrderTotal: decimal.nullable().optional(),
		requiresValidatedVatId: z.boolean().optional(),
		config: methodConfig,
		translations: z.array(translation).optional(),
	}),
})

export const idSchema = z.object({ params: z.object({ id: z.string().uuid() }) })

export const availableSchema = z.object({
	query: z.object({
		countryCode: countryCode.optional(),
		orderTotal: z.coerce.number().min(0).default(0),
	}),
})

export const PaymentValidation = {
	updateMethodSchema,
	idSchema,
	availableSchema,
}
