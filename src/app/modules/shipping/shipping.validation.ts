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

export const createZoneSchema = z.object({
	body: z.object({
		code,
		sortOrder: z.number().int().default(0),
		isActive: z.boolean().default(true),
		countries: z.array(countryCode).default([]),
		translations: z.array(z.object({ locale, name: z.string().trim().min(1).max(120) })).min(1),
	}),
})

export const updateZoneSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		code: code.optional(),
		sortOrder: z.number().int().optional(),
		isActive: z.boolean().optional(),
		countries: z.array(countryCode).optional(),
		translations: z.array(z.object({ locale, name: z.string().trim().min(1).max(120) })).optional(),
	}),
})

const bandSchema = z
	.object({
		minValue: decimal,
		maxValue: decimal.nullable().optional(),
		cost: decimal,
	})
	.refine(
		(b) =>
			b.maxValue === null ||
			b.maxValue === undefined ||
			Number(b.maxValue) > Number(b.minValue),
		{ message: "maxValue must be greater than minValue" }
	)

export const createMethodSchema = z.object({
	body: z.object({
		zoneId: z.string().uuid(),
		code,
		type: z.enum(["WEIGHT_BANDED", "FLAT_RATE", "FREE_SHIPPING", "PRICE_BANDED"]).default("WEIGHT_BANDED"),
		flatCost: decimal.nullable().optional(),
		freeAboveSubtotal: decimal.nullable().optional(),
		taxable: z.boolean().default(true),
		isActive: z.boolean().default(true),
		sortOrder: z.number().int().default(0),
		translations: z
			.array(
				z.object({
					locale,
					name: z.string().trim().min(1).max(160),
					description: z.string().trim().max(500).optional(),
				})
			)
			.min(1),
		bands: z.array(bandSchema).default([]),
	}),
})

export const updateMethodSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		code: code.optional(),
		type: z.enum(["WEIGHT_BANDED", "FLAT_RATE", "FREE_SHIPPING", "PRICE_BANDED"]).optional(),
		flatCost: decimal.nullable().optional(),
		freeAboveSubtotal: decimal.nullable().optional(),
		taxable: z.boolean().optional(),
		isActive: z.boolean().optional(),
		sortOrder: z.number().int().optional(),
		translations: z
			.array(
				z.object({
					locale,
					name: z.string().trim().min(1).max(160),
					description: z.string().trim().max(500).optional(),
				})
			)
			.optional(),
		/// Supplying bands replaces the whole ladder — it is edited as a unit.
		bands: z.array(bandSchema).optional(),
	}),
})

export const idSchema = z.object({ params: z.object({ id: z.string().uuid() }) })

export const quoteSchema = z.object({
	query: z.object({
		countryCode,
		weightKg: z.coerce.number().min(0).default(0),
		subtotal: z.coerce.number().min(0).default(0),
	}),
})

export const ShippingValidation = {
	createZoneSchema,
	updateZoneSchema,
	createMethodSchema,
	updateMethodSchema,
	idSchema,
	quoteSchema,
}
