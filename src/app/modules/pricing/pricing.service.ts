import type { PriceRole, TierType } from "@prisma/client"
import { DEFAULT_TIER_PRIORITY, type TierSource } from "../../../domain/pricing/resolvePrice"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"

/**
 * The ladders that are not part of a product.
 *
 * Both are edited the same way: the caller sends the complete ladder for one
 * scope and it replaces what is stored. Not a patch — a ladder is read as a
 * whole by the resolver, so editing it a rung at a time would let a half-saved
 * screen leave a shape nobody intended.
 */

interface RungInput {
	minQuantity: number
	type: TierType
	value: string | number
}

const view = (row: { id: string; minQuantity: number; type: TierType; value: unknown }) => ({
	id: row.id,
	minQuantity: row.minQuantity,
	type: row.type,
	value: String(row.value),
})

// ─── Category ────────────────────────────────────────────────────────────────

const listCategoryTiers = async (categoryId: string) => {
	const category = await prisma.category.findUnique({
		where: { id: categoryId },
		select: { id: true },
	})
	if (!category) {
		throw new ApiError(httpStatus.NOT_FOUND, "Category not found", {
			messageKey: "category.notFound",
		})
	}

	const rows = await prisma.categoryPriceTier.findMany({
		where: { categoryId },
		orderBy: [{ role: "asc" }, { minQuantity: "asc" }],
	})

	// Grouped by role, because that is how the screen edits them and it saves
	// every caller writing the same reduce.
	return {
		GUEST: rows.filter((r) => r.role === "GUEST").map(view),
		B2C: rows.filter((r) => r.role === "B2C").map(view),
		RESELLER: rows.filter((r) => r.role === "RESELLER").map(view),
	}
}

const setCategoryTiers = async (categoryId: string, role: PriceRole, tiers: RungInput[]) => {
	const category = await prisma.category.findUnique({
		where: { id: categoryId },
		select: { id: true },
	})
	if (!category) {
		throw new ApiError(httpStatus.NOT_FOUND, "Category not found", {
			messageKey: "category.notFound",
		})
	}

	// Delete-then-create inside one transaction. The rungs carry no identity a
	// caller would want preserved — a ladder is the unit of meaning, not a row.
	await prisma.$transaction([
		prisma.categoryPriceTier.deleteMany({ where: { categoryId, role } }),
		...(tiers.length
			? [
					prisma.categoryPriceTier.createMany({
						data: tiers.map((t) => ({
							categoryId,
							role,
							minQuantity: t.minQuantity,
							type: t.type,
							value: String(t.value),
						})),
					}),
				]
			: []),
	])

	return listCategoryTiers(categoryId)
}

// ─── Customer ────────────────────────────────────────────────────────────────

const customerView = (row: {
	id: string
	productId: string | null
	minQuantity: number
	type: TierType
	value: unknown
	note: string | null
}) => ({ ...view(row), productId: row.productId, note: row.note })

const listCustomerTiers = async (userId: string) => {
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
	if (!user) {
		throw new ApiError(httpStatus.NOT_FOUND, "Customer not found", {
			messageKey: "auth.userNotFound",
		})
	}

	const rows = await prisma.customerPriceTier.findMany({
		where: { userId },
		orderBy: [{ productId: "asc" }, { minQuantity: "asc" }],
		include: {
			product: { select: { id: true, translations: { select: { locale: true, name: true } } } },
		},
	})

	/**
	 * One entry per scope — the "all products" ladder, then one per product.
	 *
	 * The screen edits a ladder at a time, so returning the flat rows would make
	 * every caller regroup them. The product name travels with the group because
	 * a page listing ids would be unreadable.
	 */
	const groups = new Map<
		string,
		{ productId: string | null; productName: string | null; note: string | null; tiers: ReturnType<typeof view>[] }
	>()

	for (const row of rows) {
		const key = row.productId ?? "__all__"
		const group = groups.get(key) ?? {
			productId: row.productId,
			productName:
				row.product?.translations.find((t) => t.locale === "en")?.name ??
				row.product?.translations[0]?.name ??
				null,
			note: row.note,
			tiers: [],
		}
		group.tiers.push(view(row))
		groups.set(key, group)
	}

	return [...groups.values()]
}

const setCustomerTiers = async (
	userId: string,
	productId: string | null,
	note: string | null | undefined,
	tiers: RungInput[]
) => {
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
	if (!user) {
		throw new ApiError(httpStatus.NOT_FOUND, "Customer not found", {
			messageKey: "auth.userNotFound",
		})
	}

	if (productId) {
		const product = await prisma.product.findUnique({
			where: { id: productId },
			select: { id: true },
		})
		if (!product) {
			throw new ApiError(httpStatus.NOT_FOUND, "Product not found", {
				messageKey: "product.notFound",
			})
		}
	}

	await prisma.$transaction([
		prisma.customerPriceTier.deleteMany({ where: { userId, productId } }),
		...(tiers.length
			? [
					prisma.customerPriceTier.createMany({
						data: tiers.map((t) => ({
							userId,
							productId,
							note: note ?? null,
							minQuantity: t.minQuantity,
							type: t.type,
							value: String(t.value),
						})),
					}),
				]
			: []),
	])

	return listCustomerTiers(userId)
}

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * The order tier sources are tried in, and what the choices mean.
 *
 * Served alongside the current value so the settings screen does not have to
 * hardcode the vocabulary — adding a source later should not need a frontend
 * release to become selectable.
 */
const getTierPriority = async () => {
	const row = await prisma.setting.findUnique({ where: { key: "pricing.tierPriority" } })
	const raw = typeof row?.value === "string" ? row.value : ""

	const parsed = raw
		.split(",")
		.map((p) => p.trim())
		.filter((p): p is TierSource => (DEFAULT_TIER_PRIORITY as string[]).includes(p))

	const unique = [...new Set(parsed)]
	const order = unique.length === DEFAULT_TIER_PRIORITY.length ? unique : DEFAULT_TIER_PRIORITY

	return {
		order,
		isDefault: order === DEFAULT_TIER_PRIORITY,
		sources: [
			{
				value: "customer",
				label: "Customer",
				description: "A ladder negotiated with one customer. The most specific rule there is.",
			},
			{
				value: "catalogue",
				label: "Product",
				description: "The ladder set on the product itself, or on one of its variants.",
			},
			{
				value: "category",
				label: "Category",
				description:
					"A ladder inherited from a category. Measured against everything the customer has from that category, not one line.",
			},
		],
	}
}

const setTierPriority = async (order: TierSource[]) => {
	const unique = [...new Set(order)]
	if (unique.length !== DEFAULT_TIER_PRIORITY.length) {
		throw new ApiError(httpStatus.BAD_REQUEST, "Name every source exactly once", {
			messageKey: "common.validationFailed",
		})
	}

	await prisma.setting.upsert({
		where: { key: "pricing.tierPriority" },
		create: { key: "pricing.tierPriority", value: unique.join(","), isPublic: false },
		update: { value: unique.join(",") },
	})

	return getTierPriority()
}

export const PricingService = {
	listCategoryTiers,
	setCategoryTiers,
	listCustomerTiers,
	setCustomerTiers,
	getTierPriority,
	setTierPriority,
}
