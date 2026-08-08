import Decimal from "decimal.js"
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

/**
 * A role's price row.
 *
 * `salePrice` may not exceed `basePrice`, and the rule belongs here rather than
 * in the admin UI because nothing downstream questions it. `resolvePrice`
 * charges the sale price whenever one is set and in window — it never compares
 * the two — so a sale of 200 against a list of 100 bills the customer *more*
 * than the product costs, and the storefront strikes through the 100 to
 * advertise it as the discount. Every caller inherits the mistake: cart, order,
 * quote and bundle all price from the same resolver.
 *
 * Equal is allowed. A sale that matches the list price is pointless but not
 * wrong, and it is a normal intermediate state while an admin is editing.
 */
const price = z
	.object({
		role: priceRole,
		basePrice: money,
		salePrice: money.nullable().optional(),
		saleStartsAt: z.coerce.date().nullable().optional(),
		saleEndsAt: z.coerce.date().nullable().optional(),
	})
	.refine(
		(row) =>
			row.salePrice === null ||
			row.salePrice === undefined ||
			new Decimal(row.salePrice).lessThanOrEqualTo(new Decimal(row.basePrice)),
		{
			path: ["salePrice"],
			message: "The sale price cannot be higher than the regular price.",
		}
	)

const variant = z.object({
	id: z.string().uuid().optional(),
	/**
	 * Optional, and blank stays blank.
	 *
	 * Normalised to null rather than "" because the column is unique: two
	 * products without a SKU would collide on the empty string, while any number
	 * of NULLs coexist.
	 */
	sku: z
		.string()
		.trim()
		.max(100)
		.nullable()
		.optional()
		.transform((value) => value || null),
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

/**
 * The variant shape for a PATCH — every field optional, **no defaults**.
 *
 * `variant` above carries `.default()` on stock, prices, tiers and the rest,
 * which is right for a create and catastrophic for a partial update: an omitted
 * `prices` arrives as `[]`, the service sees a truthy value, and deletes the
 * ladder it was never asked to touch. Omitted `stock` arrives as `0` and zeroes
 * live inventory.
 *
 * Same reasoning as updateProductSchema below — a partial update must never
 * destroy data the caller never mentioned.
 */
const variantPatch = z.object({
	id: z.string().uuid().optional(),
	/** Same as `variant.sku` — optional, and blank normalised to null. */
	sku: z
		.string()
		.trim()
		.max(100)
		.nullable()
		.optional()
		.transform((value) => value || null),
	isDefault: z.boolean().optional(),
	isActive: z.boolean().optional(),
	sortOrder: z.number().int().optional(),
	moq: z.number().int().min(0).nullable().optional(),
	manageStock: z.boolean().optional(),
	stock: z.number().int().optional(),
	allowBackorder: z.boolean().optional(),
	lowStockThreshold: z.number().int().min(0).nullable().optional(),
	weightKg: money.nullable().optional(),
	lengthCm: money.nullable().optional(),
	widthCm: money.nullable().optional(),
	heightCm: money.nullable().optional(),
	imageAssetId: z.string().uuid().nullable().optional(),
	attributeValueIds: z.array(z.string().uuid()).optional(),
	prices: z.array(price).optional(),
	tiers: z.array(tier).optional(),
})

/**
 * A product's attributes, grouped the way WooCommerce presents them.
 *
 * The table stores one row per selected value, but `is_visible` and
 * `is_variation` belong to the attribute as a whole — so the payload groups by
 * attribute and the service expands it. Grouping also makes the impossible
 * state unrepresentable: the same attribute cannot arrive twice with
 * contradictory flags.
 */
const productAttribute = z.object({
	attributeId: z.string().uuid(),
	attributeValueIds: z.array(z.string().uuid()).min(1),
	/// Shown in the specification table on the product page.
	isVisible: z.boolean().default(true),
	/// This attribute splits *this* product into variants.
	isVariation: z.boolean().default(false),
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
	/// Whether tax applies at all. The tax *class* decides the rate when it does.
	taxStatus: z.enum(["TAXABLE", "SHIPPING_ONLY", "NONE"]).default("TAXABLE"),
	moq: z.number().int().min(0).default(0),
	sortOrder: z.number().int().default(0),
	featuredAssetId: z.string().uuid().nullable().optional(),
	categoryIds: z.array(z.string().uuid()).default([]),
	assetIds: z.array(z.string().uuid()).default([]),
	attributes: z.array(productAttribute).default([]),
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
		taxStatus: z.enum(["TAXABLE", "SHIPPING_ONLY", "NONE"]).optional(),
		moq: z.number().int().min(0).optional(),
		sortOrder: z.number().int().optional(),
		taxClassId: z.string().uuid().nullable().optional(),
		featuredAssetId: z.string().uuid().nullable().optional(),
		categoryIds: z.array(z.string().uuid()).optional(),
		assetIds: z.array(z.string().uuid()).optional(),
		attributes: z.array(productAttribute).optional(),
		translations: z.array(translation).optional(),
		variants: z.array(variantPatch).optional(),
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
		/// Inclusive bounds on the resolved "from" price.
		minPrice: z.coerce.number().min(0).optional(),
		maxPrice: z.coerce.number().min(0).optional(),
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
		categoryId: z.string().uuid().optional(),
		stockStatus: z.enum(["IN_STOCK", "OUT_OF_STOCK", "ON_BACKORDER"]).optional(),
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
