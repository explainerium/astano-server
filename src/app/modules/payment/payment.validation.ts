import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"

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

export const createMethodSchema = z.object({
	body: z.object({
		code,
		type: z.enum(["BANK_TRANSFER", "INVOICE", "CASH_ON_DELIVERY", "OTHER"]).default("BANK_TRANSFER"),
		isActive: z.boolean().default(true),
		sortOrder: z.number().int().default(0),
		...rules,
		/// Method-specific settings — bank account details, for instance.
		config: z.record(z.string(), z.unknown()).nullable().optional(),
		translations: z.array(translation).min(1),
	}),
})

export const updateMethodSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		code: code.optional(),
		type: z.enum(["BANK_TRANSFER", "INVOICE", "CASH_ON_DELIVERY", "OTHER"]).optional(),
		isActive: z.boolean().optional(),
		sortOrder: z.number().int().optional(),
		allowedCountries: z.array(countryCode).optional(),
		allowedRoles: z.array(z.enum(["GUEST", "B2C", "RESELLER", "SHOP_MANAGER", "ADMIN"])).optional(),
		requiresLogin: z.boolean().optional(),
		minCompletedOrders: z.number().int().min(0).optional(),
		minOrderTotal: decimal.nullable().optional(),
		maxOrderTotal: decimal.nullable().optional(),
		requiresValidatedVatId: z.boolean().optional(),
		config: z.record(z.string(), z.unknown()).nullable().optional(),
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
	createMethodSchema,
	updateMethodSchema,
	idSchema,
	availableSchema,
}
