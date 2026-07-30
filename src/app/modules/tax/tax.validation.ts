import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"

const locale = z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]])
const decimal = z.union([z.string().regex(/^\d+(\.\d{1,4})?$/), z.number().nonnegative()])

/** ISO 3166-1 alpha-2, never a display name. */
const countryCode = z
	.string()
	.trim()
	.toUpperCase()
	.length(2, "Use a 2-letter ISO country code, e.g. DE")

const code = z
	.string()
	.trim()
	.min(1)
	.max(60)
	.regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, "Use lowercase letters, digits, - or _")

export const createTaxClassSchema = z.object({
	body: z.object({
		code,
		isDefault: z.boolean().default(false),
		sortOrder: z.number().int().default(0),
		translations: z.array(z.object({ locale, name: z.string().trim().min(1).max(120) })).min(1),
	}),
})

export const updateTaxClassSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		code: code.optional(),
		isDefault: z.boolean().optional(),
		sortOrder: z.number().int().optional(),
		translations: z.array(z.object({ locale, name: z.string().trim().min(1).max(120) })).optional(),
	}),
})

export const createTaxRateSchema = z.object({
	body: z.object({
		taxClassId: z.string().uuid(),
		countryCode,
		state: z.string().trim().max(60).nullable().optional(),
		name: z.string().trim().min(1).max(120),
		rate: decimal,
		appliesToShipping: z.boolean().default(true),
		priority: z.number().int().min(1).default(1),
		reverseChargeWithVatId: z.boolean().default(false),
		isActive: z.boolean().default(true),
	}),
})

export const updateTaxRateSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		countryCode: countryCode.optional(),
		state: z.string().trim().max(60).nullable().optional(),
		name: z.string().trim().min(1).max(120).optional(),
		rate: decimal.optional(),
		appliesToShipping: z.boolean().optional(),
		priority: z.number().int().min(1).optional(),
		reverseChargeWithVatId: z.boolean().optional(),
		isActive: z.boolean().optional(),
	}),
})

export const idSchema = z.object({ params: z.object({ id: z.string().uuid() }) })

export const TaxValidation = {
	createTaxClassSchema,
	updateTaxClassSchema,
	createTaxRateSchema,
	updateTaxRateSchema,
	idSchema,
}
