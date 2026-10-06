import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"

const locale = z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]])

const code = z
	.string()
	.trim()
	.min(1)
	.max(60)
	.regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, "Use lowercase letters, digits, - or _")

/*
 * Codes are optional on the way in. The dashboard no longer asks for them —
 * the client, 6 October, read the box as a "short description" and every
 * umlaut in it as an error — so one is made from the German label, as a value
 * typed into a product always has been. Importers can still send their own.
 */
const valueInput = z.object({
	id: z.string().uuid().optional(),
	code: code.optional(),
	sortOrder: z.number().int().default(0),
	translations: z.array(z.object({ locale, label: z.string().trim().min(1).max(200) })).min(1),
})

export const createAttributeSchema = z.object({
	body: z.object({
		code: code.optional(),
		sortOrder: z.number().int().default(0),
		/// Products start this attribute as typed text rather than a list.
		freeText: z.boolean().optional(),
		translations: z.array(z.object({ locale, name: z.string().trim().min(1).max(200) })).min(1),
		values: z.array(valueInput).default([]),
	}),
})

export const updateAttributeSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		code: code.optional(),
		sortOrder: z.number().int().optional(),
		freeText: z.boolean().optional(),
		translations: z.array(z.object({ locale, name: z.string().trim().min(1).max(200) })).optional(),
		values: z.array(valueInput).optional(),
	}),
})

export const attributeIdSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
})

/** One value typed into a product: just the words. */
export const addValueSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({ label: z.string().trim().min(1).max(200) }),
})

/** An attribute typed into a product: just its name. */
export const addByNameSchema = z.object({
	body: z.object({ name: z.string().trim().min(1).max(200) }),
})

export const AttributeValidation = {
	addValueSchema,
	addByNameSchema,
	createAttributeSchema,
	updateAttributeSchema,
	attributeIdSchema,
}
