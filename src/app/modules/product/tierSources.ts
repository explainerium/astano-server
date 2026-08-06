import type { PriceRole } from "@prisma/client"
import { DEFAULT_TIER_PRIORITY, type TierInput, type TierSource } from "../../../domain/pricing/resolvePrice"
import type { PricingRole } from "../../../domain/pricing/effectiveRole"
import { prisma } from "../../../shared/prisma"

/**
 * Loads the quantity ladders that live *outside* a product.
 *
 * A product's own ladder travels with the product, so every read already has
 * it. The other two — a category's and a customer's — are separate rows that
 * every pricing surface would otherwise have to remember to fetch. Six surfaces
 * have to agree on what something costs, and the reliable way to make them
 * agree is to give them one function to call rather than one rule to remember.
 *
 * Everything here is a batch load. Pricing a cart of twenty lines must not
 * become forty queries.
 */

/** What `resolvePrice` needs beyond the product's own rows, for one product. */
export interface ExternalTiers {
	customerTiers?: TierInput[]
	categoryTiers?: TierInput[]
	categoryQuantity?: number
	tierPriority?: TierSource[]
}

const toTierInput = (row: { minQuantity: number; type: string; value: unknown }): TierInput => ({
	minQuantity: row.minQuantity,
	type: row.type as TierInput["type"],
	value: row.value as TierInput["value"],
})

/**
 * The order sources are tried in, from the store settings.
 *
 * Stored as a comma-separated string because that is what a settings row holds,
 * and validated on the way out: an unrecognised or half-written value falls
 * back to the default rather than silently dropping a source. A typo in a
 * settings field must not quietly stop honouring customer ladders.
 */
export const loadTierPriority = async (): Promise<TierSource[]> => {
	const row = await prisma.setting.findUnique({ where: { key: "pricing.tierPriority" } })
	const raw = typeof row?.value === "string" ? row.value : ""

	const parsed = raw
		.split(",")
		.map((part) => part.trim())
		.filter((part): part is TierSource =>
			(DEFAULT_TIER_PRIORITY as string[]).includes(part)
		)

	// Every source must appear exactly once, or the order is not an order.
	const unique = [...new Set(parsed)]
	return unique.length === DEFAULT_TIER_PRIORITY.length ? unique : DEFAULT_TIER_PRIORITY
}

/**
 * Category ladders for a set of products, resolved per product.
 *
 * A product in two categories that both carry a ladder for its role gets both
 * ladders merged. That is deliberate and matches how the rungs are picked — the
 * highest threshold the quantity reaches wins, so merging simply means the
 * deeper of two overlapping discounts applies rather than whichever category
 * happened to be listed first.
 */
export const loadCategoryTiers = async (
	productIds: string[],
	role: PricingRole
): Promise<Map<string, TierInput[]>> => {
	const byProduct = new Map<string, TierInput[]>()
	if (!productIds.length) return byProduct

	const links = await prisma.productCategory.findMany({
		where: { productId: { in: productIds } },
		select: { productId: true, categoryId: true },
	})
	if (!links.length) return byProduct

	const tiers = await prisma.categoryPriceTier.findMany({
		where: {
			categoryId: { in: [...new Set(links.map((l) => l.categoryId))] },
			role: role as PriceRole,
		},
		orderBy: { minQuantity: "asc" },
	})
	if (!tiers.length) return byProduct

	const byCategory = new Map<string, TierInput[]>()
	for (const tier of tiers) {
		const list = byCategory.get(tier.categoryId) ?? []
		list.push(toTierInput(tier))
		byCategory.set(tier.categoryId, list)
	}

	for (const link of links) {
		const fromCategory = byCategory.get(link.categoryId)
		if (!fromCategory) continue
		byProduct.set(link.productId, [...(byProduct.get(link.productId) ?? []), ...fromCategory])
	}

	return byProduct
}

/**
 * Customer ladders for a set of products.
 *
 * A row with no `productId` covers everything that customer buys, so it is
 * merged into every product's list. Guests have none — there is no account to
 * hang a negotiated price on — so this returns empty without a query.
 */
export const loadCustomerTiers = async (
	productIds: string[],
	userId?: string | null
): Promise<Map<string, TierInput[]>> => {
	const byProduct = new Map<string, TierInput[]>()
	if (!userId || !productIds.length) return byProduct

	const rows = await prisma.customerPriceTier.findMany({
		where: {
			userId,
			OR: [{ productId: null }, { productId: { in: productIds } }],
		},
		orderBy: { minQuantity: "asc" },
	})
	if (!rows.length) return byProduct

	const global = rows.filter((r) => r.productId === null).map(toTierInput)

	for (const productId of productIds) {
		const scoped = rows.filter((r) => r.productId === productId).map(toTierInput)
		const merged = [...global, ...scoped]
		if (merged.length) byProduct.set(productId, merged)
	}

	return byProduct
}

/**
 * How many units of a category are already in the cart.
 *
 * This is the quantity a category ladder is measured against, and the reason
 * that ladder is worth having: it counts across lines, so ten each of five
 * cutters from one category reaches a threshold of 50 that no single line
 * reaches.
 *
 * `extra` lets a caller ask "what would this cost if I added N more" without
 * writing the line first — which is exactly what a product page needs.
 */
export const categoryCartQuantities = async (
	userId: string | null | undefined,
	cartId?: string | null
): Promise<Map<string, number>> => {
	const totals = new Map<string, number>()

	const cart = cartId
		? await prisma.cart.findUnique({
				where: { id: cartId },
				include: { items: { include: { variant: { select: { productId: true } } } } },
			})
		: userId
			? await prisma.cart.findFirst({
					where: { userId },
					orderBy: { updatedAt: "desc" },
					include: { items: { include: { variant: { select: { productId: true } } } } },
				})
			: null

	if (!cart?.items.length) return totals

	const links = await prisma.productCategory.findMany({
		where: { productId: { in: [...new Set(cart.items.map((i) => i.variant.productId))] } },
		select: { productId: true, categoryId: true },
	})

	const categoriesOf = new Map<string, string[]>()
	for (const link of links) {
		categoriesOf.set(link.productId, [...(categoriesOf.get(link.productId) ?? []), link.categoryId])
	}

	for (const item of cart.items) {
		for (const categoryId of categoriesOf.get(item.variant.productId) ?? []) {
			totals.set(categoryId, (totals.get(categoryId) ?? 0) + item.quantity)
		}
	}

	return totals
}

/**
 * Everything the resolver needs from outside the product, for one batch of
 * products, in one place.
 *
 * Returns a lookup rather than a value: callers price many products from one
 * load, and handing back a map is what keeps that from becoming a query per
 * line.
 */
export const loadExternalTiers = async (params: {
	productIds: string[]
	role: PricingRole
	userId?: string | null
	cartId?: string | null
	/// Skip the cart round-trip where there is no cart to count — an archive.
	withCategoryQuantities?: boolean
}): Promise<(productId: string) => ExternalTiers> => {
	const [tierPriority, categoryTiers, customerTiers, categoryTotals] = await Promise.all([
		loadTierPriority(),
		loadCategoryTiers(params.productIds, params.role),
		loadCustomerTiers(params.productIds, params.userId),
		params.withCategoryQuantities
			? categoryCartQuantities(params.userId, params.cartId)
			: Promise.resolve(new Map<string, number>()),
	])

	/**
	 * The quantity for a product's category ladder is the largest of the counts
	 * of the categories it belongs to — the better of the two, not an arbitrary
	 * one, and not their sum, which would count the product itself twice.
	 *
	 * Resolved up front into a map so the returned lookup stays synchronous and
	 * a caller pricing twenty lines does not issue twenty queries.
	 */
	const quantities = new Map<string, number>()
	if (categoryTotals.size) {
		const links = await prisma.productCategory.findMany({
			where: { productId: { in: params.productIds } },
			select: { productId: true, categoryId: true },
		})
		for (const link of links) {
			const count = categoryTotals.get(link.categoryId) ?? 0
			quantities.set(link.productId, Math.max(quantities.get(link.productId) ?? 0, count))
		}
	}

	return (productId: string): ExternalTiers => ({
		tierPriority,
		categoryTiers: categoryTiers.get(productId),
		customerTiers: customerTiers.get(productId),
		categoryQuantity: quantities.get(productId),
	})
}
