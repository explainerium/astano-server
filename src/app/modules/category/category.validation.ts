import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"

const locale = z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]])

const translation = z.object({
	locale,
	name: z.string().trim().min(1).max(200),
	slug: z
		.string()
		.trim()
		.min(1)
		.max(200)
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase words separated by hyphens")
		.optional(),
	description: z.string().trim().max(5000).optional(),
	metaTitle: z.string().trim().max(200).optional(),
	metaDescription: z.string().trim().max(500).optional(),
})

export const createCategorySchema = z.object({
	body: z.object({
		parentId: z.string().uuid().nullable().optional(),
		sortOrder: z.number().int().default(0),
		isHidden: z.boolean().default(false),
		isOptionCategory: z.boolean().default(false),
		imageAssetId: z.string().uuid().nullable().optional(),
		iconAssetId: z.string().uuid().nullable().optional(),
		// At least one translation, and the default locale must be present so
		// every category always has a name to fall back to.
		translations: z.array(translation).min(1),
	}),
})

export const updateCategorySchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		parentId: z.string().uuid().nullable().optional(),
		sortOrder: z.number().int().optional(),
		isHidden: z.boolean().optional(),
		isOptionCategory: z.boolean().optional(),
		imageAssetId: z.string().uuid().nullable().optional(),
		iconAssetId: z.string().uuid().nullable().optional(),
		translations: z.array(translation).optional(),
	}),
})

export const categoryIdSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
})

export const listCategoriesSchema = z.object({
	query: z.object({
		includeHidden: z.coerce.boolean().default(false),
		tree: z.coerce.boolean().default(true),
	}),
})

export const CategoryValidation = {
	createCategorySchema,
	updateCategorySchema,
	categoryIdSchema,
	listCategoriesSchema,
}
