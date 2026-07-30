import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"

const locale = z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]])
const money = z.union([z.string().regex(/^\d+(\.\d{1,4})?$/), z.number().nonnegative()])
const priceRole = z.enum(["GUEST", "B2C", "RESELLER"])

const translation = z.object({
	locale,
	name: z.string().trim().min(1).max(300),
	slug: z
		.string()
		.trim()
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase words separated by hyphens")
		.optional(),
	shortDescription: z.string().trim().max(2000).optional(),
	description: z.string().trim().max(50000).optional(),
	metaTitle: z.string().trim().max(200).optional(),
	metaDescription: z.string().trim().max(500).optional(),
})

/** One rung of a quantity ladder. Admins may add as many as they like. */
const tier = z.object({
	role: priceRole,
	minQuantity: z.number().int().min(1),
	type: z.enum(["FIXED_PRICE", "PERCENTAGE", "FIXED_AMOUNT"]).default("FIXED_PRICE"),
	value: money,
})

const price = z.object({
	role: priceRole,
	basePrice: money,
	salePrice: money.nullable().optional(),
	saleStartsAt: z.coerce.date().nullable().optional(),
	saleEndsAt: z.coerce.date().nullable().optional(),
})

const variant = z.object({
	id: z.string().uuid().optional(),
	sku: z.string().trim().min(1).max(100),
	isDefault: z.boolean().default(false),
	isActive: z.boolean().default(true),
	sortOrder: z.number().int().default(0),
	/// Null means inherit the product MOQ; 0 disables the minimum for this variant.
	moq: z.number().int().min(0).nullable().optional(),
	manageStock: z.boolean().default(true),
	stock: z.number().int().default(0),
	allowBackorder: z.boolean().default(false),
	lowStockThreshold: z.number().int().min(0).nullable().optional(),
	weightKg: money.nullable().optional(),
	lengthCm: money.nullable().optional(),
	widthCm: money.nullable().optional(),
	heightCm: money.nullable().optional(),
	imageAssetId: z.string().uuid().nullable().optional(),
	attributeValueIds: z.array(z.string().uuid()).default([]),
	prices: z.array(price).default([]),
	tiers: z.array(tier).default([]),
})

/** Direct option assignment — no bundle entity to create first. */
const option = z.object({
	optionProductId: z.string().uuid(),
	sortOrder: z.number().int().default(0),
	groupLabel: z.string().trim().max(120).nullable().optional(),
	preselected: z.boolean().default(false),
	discountPercent: money.nullable().optional(),
})

const productBody = z.object({
	/// Admin-only dashboard label. Never exposed publicly, never affects behaviour.
	kind: z.enum(["MAIN", "OPTION"]).default("MAIN"),
	status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
	/// Always the admin's explicit choice.
	visibility: z
		.enum(["SHOP_AND_SEARCH", "SHOP_ONLY", "SEARCH_ONLY", "HIDDEN"])
		.default("SHOP_AND_SEARCH"),
	quoteEnabled: z.boolean().default(false),
	moq: z.number().int().min(0).default(0),
	sortOrder: z.number().int().default(0),
	featuredAssetId: z.string().uuid().nullable().optional(),
	categoryIds: z.array(z.string().uuid()).default([]),
	assetIds: z.array(z.string().uuid()).default([]),
	translations: z.array(translation).min(1),
	variants: z.array(variant).min(1),
	prices: z.array(price).default([]),
	tiers: z.array(tier).default([]),
	options: z.array(option).default([]),
})

export const createProductSchema = z.object({ body: productBody })

/**
 * Written out in full rather than derived with `productBody.partial()`.
 *
 * Zod's `.partial()` makes a field optional but does NOT strip its `.default()`,
 * so a PATCH carrying only `{ moq: 1000 }` came back from validation with
 * `status: "DRAFT"`, `prices: []`, `tiers: []`, `options: []` and
 * `categoryIds: []` filled in — and the service, seeing those keys present,
 * would unpublish the product and delete its prices, tier ladder, options and
 * category links.
 *
 * Every field here is optional with NO default, so anything the caller omits
 * stays untouched. A partial update must never be able to destroy data the
 * caller never mentioned.
 */
export const updateProductSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		kind: z.enum(["MAIN", "OPTION"]).optional(),
		status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
		visibility: z
			.enum(["SHOP_AND_SEARCH", "SHOP_ONLY", "SEARCH_ONLY", "HIDDEN"])
			.optional(),
		quoteEnabled: z.boolean().optional(),
		moq: z.number().int().min(0).optional(),
		sortOrder: z.number().int().optional(),
		taxClassId: z.string().uuid().nullable().optional(),
		featuredAssetId: z.string().uuid().nullable().optional(),
		categoryIds: z.array(z.string().uuid()).optional(),
		assetIds: z.array(z.string().uuid()).optional(),
		translations: z.array(translation).optional(),
		variants: z.array(variant).optional(),
		prices: z.array(price).optional(),
		tiers: z.array(tier).optional(),
		options: z.array(option).optional(),
	}),
})

export const productIdSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
})

export const listProductsSchema = z.object({
	query: z.object({
		category: z.string().trim().optional(),
		search: z.string().trim().max(200).optional(),
		quantity: z.coerce.number().int().min(1).default(1),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(100).default(24),
		sort: z.enum(["default", "newest", "name", "price_asc", "price_desc"]).default("default"),
	}),
})

export const adminListProductsSchema = z.object({
	query: z.object({
		kind: z.enum(["MAIN", "OPTION"]).optional(),
		status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
		visibility: z
			.enum(["SHOP_AND_SEARCH", "SHOP_ONLY", "SEARCH_ONLY", "HIDDEN"])
			.optional(),
		search: z.string().trim().max(200).optional(),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(200).default(50),
	}),
})

export const ProductValidation = {
	createProductSchema,
	updateProductSchema,
	productIdSchema,
	listProductsSchema,
	adminListProductsSchema,
}
