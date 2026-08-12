import { describe, expect, it } from "vitest"
import { resolvePrice } from "../../src/domain/pricing/resolvePrice"

/**
 * The client's complaint was that filling three quantity ladders is too much
 * work and guests and retail customers should share one. They already share a
 * *price* through the fallback chain — but not a ladder, so a retail customer
 * with a price row and no rungs paid the single-unit price at any quantity
 * while a guest ordering the same 500 got the discount.
 */
const ladder = [{ minQuantity: 100, type: "PERCENTAGE" as const, value: "10" }]

describe("quantity ladder fallback", () => {
	it("gives a retail customer the guest ladder when they have none", () => {
		const result = resolvePrice({
			quoteEnabled: false,
			role: "B2C",
			quantity: 100,
			productPrices: [
				{ role: "GUEST", basePrice: "10.00", salePrice: null, saleStartsAt: null, saleEndsAt: null, tiers: ladder },
				{ role: "B2C", basePrice: "10.00", salePrice: null, saleStartsAt: null, saleEndsAt: null, tiers: [] },
			],
		})

		// The B2C price row still decides the base — only the rungs are borrowed.
		expect(result.resolvedRole).toBe("B2C")
		expect(result.unitPrice?.toFixed(2)).toBe("9.00")
	})

	it("leaves a role that defined its own ladder alone", () => {
		const result = resolvePrice({
			quoteEnabled: false,
			role: "B2C",
			quantity: 100,
			productPrices: [
				{ role: "GUEST", basePrice: "10.00", salePrice: null, saleStartsAt: null, saleEndsAt: null, tiers: ladder },
				{
					role: "B2C",
					basePrice: "10.00",
					salePrice: null,
					saleStartsAt: null,
					saleEndsAt: null,
					tiers: [{ minQuantity: 100, type: "PERCENTAGE", value: "20" }],
				},
			],
		})

		expect(result.unitPrice?.toFixed(2)).toBe("8.00")
	})

	it("does not invent a ladder where none exists at all", () => {
		const result = resolvePrice({
			quoteEnabled: false,
			role: "B2C",
			quantity: 100,
			productPrices: [
				{ role: "B2C", basePrice: "10.00", salePrice: null, saleStartsAt: null, saleEndsAt: null, tiers: [] },
			],
		})

		expect(result.unitPrice?.toFixed(2)).toBe("10.00")
		expect(result.appliedTier).toBeNull()
	})

	it("does not borrow a cheaper role's ladder for a reseller", () => {
		// FALLBACK.RESELLER runs toward the more expensive roles, so a dealer
		// with no ladder picks up the retail one rather than nothing — but a
		// guest never picks up the dealer's.
		const result = resolvePrice({
			quoteEnabled: false,
			role: "GUEST",
			quantity: 100,
			productPrices: [
				{ role: "GUEST", basePrice: "10.00", salePrice: null, saleStartsAt: null, saleEndsAt: null, tiers: [] },
				{
					role: "RESELLER",
					basePrice: "6.00",
					salePrice: null,
					saleStartsAt: null,
					saleEndsAt: null,
					tiers: [{ minQuantity: 100, type: "PERCENTAGE", value: "50" }],
				},
			],
		})

		expect(result.unitPrice?.toFixed(2)).toBe("10.00")
	})
})
