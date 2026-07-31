import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"

const locale = z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]])

const code = z
	.string()
	.trim()
	.min(1)
	.max(60)
	.regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, "Use lowercase letters, digits, - or _")

const valueInput = z.object({
	id: z.string().uuid().optional(),
	code,
	sortOrder: z.number().int().default(0),
	translations: z.array(z.object({ locale, label: z.string().trim().min(1).max(200) })).min(1),
})

export const createAttributeSchema = z.object({
	body: z.object({
		code,
		sortOrder: z.number().int().default(0),
		translations: z.array(z.object({ locale, name: z.string().trim().min(1).max(200) })).min(1),
		values: z.array(valueInput).default([]),
	}),
})

export const updateAttributeSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		code: code.optional(),
		sortOrder: z.number().int().optional(),
		translations: z.array(z.object({ locale, name: z.string().trim().min(1).max(200) })).optional(),
		values: z.array(valueInput).optional(),
	}),
})

export const attributeIdSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
})

export const AttributeValidation = {
	createAttributeSchema,
	updateAttributeSchema,
	attributeIdSchema,
}
