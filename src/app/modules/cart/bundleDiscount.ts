import Decimal from "decimal.js"
import { prisma } from "../../../shared/prisma"
import { followerQuantities, packSizesOf, type FollowRule } from "../../../domain/bundle/followQuantity"

/**
 * Bundle discounts for option lines, keyed by cart-item id.
 *
 * Shared by the cart and by checkout deliberately. If only one of them applied
 * the discount, the customer would be quoted one price in the basket and
 * charged another on the invoice — the precise class of disagreement risk #1
 * exists to prevent.
 *
 * Derived on every read rather than stored on the line, for the same reason no
 * price is stored: an admin changing the discount must be reflected in carts
 * that already exist.
 */
export interface DiscountableLine {
	id: string
	parentItemId: string | null
	variant: { productId: string }
}

export const loadBundleDiscounts = async (
	items: DiscountableLine[]
): Promise<Map<string, Decimal>> => {
	const optionLines = items.filter((i) => i.parentItemId)
	if (!optionLines.length) return new Map()

	const pairs = optionLines
		.map((line) => {
			const parent = items.find((p) => p.id === line.parentItemId)
			if (!parent) return null
			return {
				lineId: line.id,
				ownerProductId: parent.variant.productId,
				optionProductId: line.variant.productId,
			}
		})
		.filter((p): p is NonNullable<typeof p> => p !== null)

	if (!pairs.length) return new Map()

	const rows = await prisma.productOption.findMany({
		where: {
			OR: pairs.map((p) => ({
				productId: p.ownerProductId,
				optionProductId: p.optionProductId,
			})),
		},
		select: { productId: true, optionProductId: true, discountPercent: true },
	})

	const byPair = new Map(
		rows
			.filter((r) => r.discountPercent !== null)
			.map((r) => [
				`${r.productId}:${r.optionProductId}`,
				new Decimal(r.discountPercent!.toString()),
			])
	)

	const result = new Map<string, Decimal>()
	for (const p of pairs) {
		const discount = byPair.get(`${p.ownerProductId}:${p.optionProductId}`)
		if (discount) result.set(p.lineId, discount)
	}

	return result
}

/**
 * Option lines whose option is set to follow the main product's quantity,
 * mapped to how each is counted — 1 for a pack per cutter, 4 for a box of
 * four, or once per chosen box for a print on the box.
 *
 * Read from `ProductOption` on every call, like the discount above, so an
 * admin ticking the box changes baskets that already exist. Shared by the cart
 * and the inquiry basket: both keep such a line in step with its parent.
 */
export const loadFollowingLines = async (
	items: DiscountableLine[]
): Promise<Map<string, FollowRule>> => {
	const pairs = items
		.filter((i) => i.parentItemId)
		.map((line) => {
			const parent = items.find((p) => p.id === line.parentItemId)
			if (!parent) return null
			return {
				lineId: line.id,
				ownerProductId: parent.variant.productId,
				optionProductId: line.variant.productId,
			}
		})
		.filter((p): p is NonNullable<typeof p> => p !== null)

	if (!pairs.length) return new Map()

	const rows = await prisma.productOption.findMany({
		where: {
			followsMainQuantity: true,
			OR: pairs.map((p) => ({ productId: p.ownerProductId, optionProductId: p.optionProductId })),
		},
		select: {
			productId: true,
			optionProductId: true,
			unitsPerOption: true,
			countsOptionProductIds: true,
		},
	})

	const following = new Map<string, FollowRule>(
		rows.map((r) => [
			`${r.productId}:${r.optionProductId}`,
			{ unitsPerOption: r.unitsPerOption, countsOptions: r.countsOptionProductIds },
		])
	)

	const result = new Map<string, FollowRule>()
	for (const p of pairs) {
		const rule = following.get(`${p.ownerProductId}:${p.optionProductId}`)
		if (rule) result.set(p.lineId, rule)
	}

	return result
}

/**
 * What every following option of one line should now be ordered in.
 *
 * Boxes from the parent's quantity, prints from the boxes. A print whose boxes
 * have all gone comes to 0, and the caller removes it: a print on no box is not
 * something that can be made. Shared by the cart and the inquiry basket, which
 * call it whenever a parent's quantity changes or one of its boxes goes.
 */
export const followerPlan = (
	parentId: string,
	parentQuantity: number,
	items: (DiscountableLine & { quantity: number })[],
	following: Map<string, FollowRule>
): { id: string; quantity: number; current: number }[] => {
	const followers = items.filter((i) => i.parentItemId === parentId && following.has(i.id))
	const quantities = followerQuantities(
		parentQuantity,
		followers.map((f) => ({ id: f.id, productId: f.variant.productId, rule: following.get(f.id)! }))
	)

	return followers.map((f) => ({ id: f.id, quantity: quantities.get(f.id) ?? 0, current: f.quantity }))
}

/** The pack sizes among one line's followers — boxes, not prints. */
export const followerPackSizes = (
	parentId: string,
	items: DiscountableLine[],
	following: Map<string, FollowRule>
): number[] =>
	packSizesOf(
		items
			.filter((i) => i.parentItemId === parentId && following.has(i.id))
			.map((i) => following.get(i.id)!)
	)

/** Applies a bundle discount to an already-tiered unit price. */
export const applyBundleDiscount = (unitPrice: Decimal, discount: Decimal): Decimal => {
	const discounted = unitPrice.mul(new Decimal(100).minus(discount)).div(100)
	return discounted.lessThan(0) ? new Decimal(0) : discounted
}
