import Decimal from "decimal.js"
import { prisma } from "../../../shared/prisma"

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

/** Applies a bundle discount to an already-tiered unit price. */
export const applyBundleDiscount = (unitPrice: Decimal, discount: Decimal): Decimal => {
	const discounted = unitPrice.mul(new Decimal(100).minus(discount)).div(100)
	return discounted.lessThan(0) ? new Decimal(0) : discounted
}
