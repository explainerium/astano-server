import Decimal from "decimal.js"
import { describe, expect, it } from "vitest"
import {
	resolvePrice,
	resolvePriceRange,
	type RolePriceInput,
} from "../../src/domain/pricing/resolvePrice"

/**
 * Fixtures modelled on the ladders documented in spec §4.2: standard rungs at
 * 100/250/500/1000, with the Reseller ladder roughly 25–35% below B2C.
 */
const b2c: RolePriceInput = {
	role: "B2C",
	basePrice: "10.0000",
	tiers: [
		{ minQuantity: 100, type: "FIXED_PRICE", value: "9.0000" },
		{ minQuantity: 250, type: "FIXED_PRICE", value: "8.5000" },
		{ minQuantity: 500, type: "FIXED_PRICE", value: "8.0000" },
		{ minQuantity: 1000, type: "FIXED_PRICE", value: "7.5000" },
	],
}

const reseller: RolePriceInput = {
	role: "RESELLER",
	basePrice: "7.0000",
	tiers: [
		{ minQuantity: 100, type: "FIXED_PRICE", value: "6.5000" },
		{ minQuantity: 500, type: "FIXED_PRICE", value: "5.7500" },
	],
}

const guest: RolePriceInput = { role: "GUEST", basePrice: "12.0000" }

const productPrices = [guest, b2c, reseller]

const money = (d: Decimal | null) => d?.toFixed(2)

describe("resolvePrice", () => {
	describe("quote-only products (R2)", () => {
		it("returns no price at all, whatever the role or quantity", () => {
			const r = resolvePrice({ quoteEnabled: true, role: "RESELLER", quantity: 500, productPrices })
			expect(r.quoteOnly).toBe(true)
			expect(r.unitPrice).toBeNull()
			expect(r.lineTotal).toBeNull()
		})
	})

	describe("tier rungs", () => {
		it("uses the base price below the first rung", () => {
			expect(money(resolvePrice({ role: "B2C", quantity: 1, productPrices }).unitPrice)).toBe("10.00")
			expect(money(resolvePrice({ role: "B2C", quantity: 99, productPrices }).unitPrice)).toBe("10.00")
		})

		it("applies a rung exactly at its threshold", () => {
			expect(money(resolvePrice({ role: "B2C", quantity: 100, productPrices }).unitPrice)).toBe("9.00")
			expect(money(resolvePrice({ role: "B2C", quantity: 250, productPrices }).unitPrice)).toBe("8.50")
		})

		it("holds the rung until the next threshold", () => {
			expect(money(resolvePrice({ role: "B2C", quantity: 249, productPrices }).unitPrice)).toBe("9.00")
			expect(money(resolvePrice({ role: "B2C", quantity: 999, productPrices }).unitPrice)).toBe("8.00")
		})

		it("keeps the top rung for any larger quantity", () => {
			expect(money(resolvePrice({ role: "B2C", quantity: 100000, productPrices }).unitPrice)).toBe("7.50")
		})
	})

	describe("roles", () => {
		it("prices each role from its own ladder", () => {
			expect(money(resolvePrice({ role: "GUEST", quantity: 1, productPrices }).unitPrice)).toBe("12.00")
			expect(money(resolvePrice({ role: "B2C", quantity: 1, productPrices }).unitPrice)).toBe("10.00")
			expect(money(resolvePrice({ role: "RESELLER", quantity: 1, productPrices }).unitPrice)).toBe("7.00")
		})

		it("keeps the Reseller ladder below B2C at every rung", () => {
			for (const quantity of [1, 100, 250, 500, 1000, 5000]) {
				const r = resolvePrice({ role: "RESELLER", quantity, productPrices }).unitPrice!
				const b = resolvePrice({ role: "B2C", quantity, productPrices }).unitPrice!
				expect(r.lessThan(b)).toBe(true)
			}
		})

		it("falls back toward the MORE expensive role when a price is missing", () => {
			const noReseller = [guest, b2c]
			const r = resolvePrice({ role: "RESELLER", quantity: 1, productPrices: noReseller })
			expect(r.resolvedRole).toBe("B2C")
			expect(money(r.unitPrice)).toBe("10.00")
		})

		it("never hands out a cheaper role's price when its own is missing", () => {
			const onlyGuest = [guest]
			expect(money(resolvePrice({ role: "RESELLER", quantity: 1, productPrices: onlyGuest }).unitPrice)).toBe("12.00")
		})

		it("returns nothing when no price row exists at all", () => {
			const r = resolvePrice({ role: "B2C", quantity: 1, productPrices: [] })
			expect(r.unitPrice).toBeNull()
			expect(r.resolvedRole).toBeNull()
		})
	})

	describe("tier types", () => {
		it("PERCENTAGE takes a percentage off the base", () => {
			const prices = [
				{ role: "B2C" as const, basePrice: "100.0000", tiers: [{ minQuantity: 10, type: "PERCENTAGE" as const, value: "25" }] },
			]
			expect(money(resolvePrice({ role: "B2C", quantity: 10, productPrices: prices }).unitPrice)).toBe("75.00")
		})

		it("FIXED_AMOUNT subtracts an absolute amount", () => {
			const prices = [
				{ role: "B2C" as const, basePrice: "100.0000", tiers: [{ minQuantity: 10, type: "FIXED_AMOUNT" as const, value: "12.50" }] },
			]
			expect(money(resolvePrice({ role: "B2C", quantity: 10, productPrices: prices }).unitPrice)).toBe("87.50")
		})

		it("never produces a negative price", () => {
			const prices = [
				{ role: "B2C" as const, basePrice: "10.0000", tiers: [{ minQuantity: 1, type: "FIXED_AMOUNT" as const, value: "999" }] },
			]
			expect(money(resolvePrice({ role: "B2C", quantity: 1, productPrices: prices }).unitPrice)).toBe("0.00")
		})
	})

	describe("sale windows", () => {
		const withSale: RolePriceInput = {
			role: "B2C",
			basePrice: "10.0000",
			salePrice: "6.0000",
			saleStartsAt: new Date("2026-01-01"),
			saleEndsAt: new Date("2026-12-31"),
		}

		it("uses the sale price inside the window", () => {
			const r = resolvePrice({ role: "B2C", quantity: 1, productPrices: [withSale], now: new Date("2026-06-01") })
			expect(money(r.unitPrice)).toBe("6.00")
			expect(money(r.listPrice)).toBe("10.00")
			expect(r.onSale).toBe(true)
		})

		it("ignores the sale price outside the window", () => {
			const before = resolvePrice({ role: "B2C", quantity: 1, productPrices: [withSale], now: new Date("2025-06-01") })
			const after = resolvePrice({ role: "B2C", quantity: 1, productPrices: [withSale], now: new Date("2027-06-01") })
			expect(money(before.unitPrice)).toBe("10.00")
			expect(money(after.unitPrice)).toBe("10.00")
			expect(before.onSale).toBe(false)
		})
	})

	describe("variant overrides", () => {
		it("prefers a variant price over the product price", () => {
			const variantPrices = [{ role: "B2C" as const, basePrice: "4.0000" }]
			const r = resolvePrice({ role: "B2C", quantity: 1, productPrices, variantPrices })
			expect(money(r.unitPrice)).toBe("4.00")
			expect(r.source).toBe("variant")
		})

		it("falls back to the product when the variant has no rows", () => {
			const r = resolvePrice({ role: "B2C", quantity: 1, productPrices, variantPrices: [] })
			expect(r.source).toBe("product")
			expect(money(r.unitPrice)).toBe("10.00")
		})
	})

	describe("line totals", () => {
		it("multiplies by quantity and rounds to 2dp at line level", () => {
			const r = resolvePrice({ role: "B2C", quantity: 250, productPrices })
			expect(money(r.lineTotal)).toBe("2125.00")
		})

		it("does not accumulate binary floating-point drift", () => {
			const prices = [{ role: "B2C" as const, basePrice: "0.1000" }]
			const r = resolvePrice({ role: "B2C", quantity: 3, productPrices: prices })
			expect(money(r.lineTotal)).toBe("0.30")
		})
	})

	describe("price range for archives", () => {
		it("spans the quantity-1 price down to the top rung", () => {
			const range = resolvePriceRange({ role: "B2C", productPrices })
			expect(money(range.min)).toBe("7.50")
			expect(money(range.max)).toBe("10.00")
		})

		it("collapses to a single value when there are no tiers", () => {
			const range = resolvePriceRange({ role: "GUEST", productPrices: [guest] })
			expect(money(range.min)).toBe("12.00")
			expect(money(range.max)).toBe("12.00")
		})

		it("reports quote-only products with no range", () => {
			const range = resolvePriceRange({ quoteEnabled: true, role: "B2C", productPrices })
			expect(range.quoteOnly).toBe(true)
			expect(range.min).toBeNull()
		})

		/**
		 * The shop enters one ladder and expects every role to follow it, which
		 * `pickTiers` already arranged for the cart. The range read the picked
		 * row's own rungs instead, so a Retail customer was advertised a single
		 * price on the archive and then charged the guest ladder's discount at
		 * checkout — the two screens disagreeing that risk #1 is about.
		 */
		it("follows the same role fallback for the ladder as the price does", () => {
			const guestWithLadder: RolePriceInput = {
				role: "GUEST",
				basePrice: "12.0000",
				tiers: [{ minQuantity: 500, type: "FIXED_PRICE", value: "9.0000" }],
			}
			// Retail has a price of its own and no rungs — the common case.
			const retailNoLadder: RolePriceInput = { role: "B2C", basePrice: "10.0000" }

			const range = resolvePriceRange({
				role: "B2C",
				productPrices: [guestWithLadder, retailNoLadder],
			})

			expect(money(range.max)).toBe("10.00")
			expect(money(range.min)).toBe("9.00")
		})

		it("reaches the deepest rung a variant ladder defines", () => {
			const range = resolvePriceRange({
				role: "B2C",
				productPrices,
				variantPrices: [
					{
						role: "B2C",
						basePrice: "9.0000",
						tiers: [{ minQuantity: 2000, type: "FIXED_PRICE", value: "6.0000" }],
					},
				],
			})

			expect(money(range.max)).toBe("9.00")
			expect(money(range.min)).toBe("6.00")
		})
	})
})
