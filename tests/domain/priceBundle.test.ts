import { describe, expect, it } from "vitest"
import {
	priceBundle,
	startingQuantityFor,
	type ConfigurableLine,
} from "../../src/domain/bundle/priceBundle"

const cutter: ConfigurableLine = {
	variantId: "v-main",
	sku: "1-SCC-1",
	name: "Custom Cookie Cutter",
	quantity: 50,
	productMoq: 50,
	productPrices: [
		{
			role: "B2C",
			basePrice: "10.00",
			tiers: [
				{ minQuantity: 100, type: "FIXED_PRICE", value: "9.00" },
				{ minQuantity: 500, type: "FIXED_PRICE", value: "8.00" },
			],
		},
	],
}

/** Engraving comes in units of 500 — its own ladder, its own minimum. */
const engraving: ConfigurableLine = {
	variantId: "v-eng",
	sku: "1-CCGC-1",
	name: "Gold Coating",
	quantity: 500,
	productMoq: 500,
	productPrices: [
		{
			role: "B2C",
			basePrice: "1.00",
			tiers: [{ minQuantity: 1000, type: "FIXED_PRICE", value: "0.80" }],
		},
	],
}

describe("priceBundle (§4.6)", () => {
	it("prices the main product alone when nothing is selected", () => {
		const r = priceBundle({ role: "B2C", main: cutter, options: [] })
		expect(r.main.lineTotal).toBe("500.00")
		expect(r.subtotal).toBe("500.00")
		expect(r.addable).toBe(true)
	})

	it("prices every option independently, on its own ladder", () => {
		const r = priceBundle({ role: "B2C", main: cutter, options: [engraving] })
		// 50 cutters at 10.00 (below the 100 rung) + 500 engravings at 1.00
		expect(r.main.lineTotal).toBe("500.00")
		expect(r.options[0]?.lineTotal).toBe("500.00")
		expect(r.subtotal).toBe("1000.00")
	})

	it("lets an option reach its own tier while the main product does not", () => {
		const r = priceBundle({
			role: "B2C",
			main: cutter,
			options: [{ ...engraving, quantity: 1000 }],
		})
		expect(r.main.unitPrice).toBe("10.00") // still below its 100 rung
		expect(r.options[0]?.unitPrice).toBe("0.80") // reached its 1000 rung
	})

	it("applies a bundle discount on top of the tier price", () => {
		const r = priceBundle({
			role: "B2C",
			main: cutter,
			options: [{ ...engraving, quantity: 1000, discountPercent: "10" }],
		})
		// 0.80 tier price, then 10% off
		expect(r.options[0]?.discountedFrom).toBe("0.80")
		expect(r.options[0]?.unitPrice).toBe("0.72")
	})

	it("never lets a discount produce a negative price", () => {
		const r = priceBundle({
			role: "B2C",
			main: cutter,
			options: [{ ...engraving, discountPercent: "500" }],
		})
		expect(r.options[0]?.unitPrice).toBe("0.00")
	})

	describe("MOQ per line — the bug the old code had (risk #17)", () => {
		it("flags an option below ITS OWN minimum, not the main product's", () => {
			const r = priceBundle({
				role: "B2C",
				main: cutter,
				options: [{ ...engraving, quantity: 50 }],
			})
			expect(r.options[0]?.belowMoq).toBe(true)
			expect(r.issues).toContainEqual({ line: "1-CCGC-1", problem: "BELOW_MOQ", moq: 500 })
			expect(r.addable).toBe(false)
		})

		it("flags the main product below its own minimum", () => {
			const r = priceBundle({ role: "B2C", main: { ...cutter, quantity: 10 }, options: [] })
			expect(r.issues).toContainEqual({ line: "1-SCC-1", problem: "BELOW_MOQ", moq: 50 })
			expect(r.addable).toBe(false)
		})

		it("is addable only when every single line passes", () => {
			const good = priceBundle({ role: "B2C", main: cutter, options: [engraving] })
			expect(good.addable).toBe(true)

			const bad = priceBundle({
				role: "B2C",
				main: cutter,
				options: [engraving, { ...engraving, variantId: "v2", sku: "1-BAD-1", quantity: 1 }],
			})
			expect(bad.addable).toBe(false)
		})
	})

	it("refuses a quote-only line", () => {
		const r = priceBundle({
			role: "B2C",
			main: cutter,
			options: [{ ...engraving, quoteEnabled: true }],
		})
		expect(r.issues).toContainEqual({ line: "1-CCGC-1", problem: "QUOTE_ONLY" })
		expect(r.addable).toBe(false)
	})

	it("refuses a line with no price for this role", () => {
		const r = priceBundle({
			role: "RESELLER",
			main: cutter,
			options: [{ ...engraving, productPrices: [] }],
		})
		expect(r.issues).toContainEqual({ line: "1-CCGC-1", problem: "NO_PRICE" })
		expect(r.addable).toBe(false)
	})

	it("prices a Reseller below B2C across the whole bundle", () => {
		const withReseller = {
			...cutter,
			productPrices: [
				...cutter.productPrices,
				{ role: "RESELLER" as const, basePrice: "7.00" },
			],
		}
		const b2c = priceBundle({ role: "B2C", main: withReseller, options: [] })
		const res = priceBundle({ role: "RESELLER", main: withReseller, options: [] })
		expect(Number(res.subtotal)).toBeLessThan(Number(b2c.subtotal))
	})
})

describe("startingQuantityFor", () => {
	it("starts an option at its own MOQ, not at 1", () => {
		expect(startingQuantityFor(500)).toBe(500)
	})

	it("prefers a variant override", () => {
		expect(startingQuantityFor(500, 100)).toBe(100)
	})

	it("falls back to 1 when there is no minimum", () => {
		expect(startingQuantityFor(0)).toBe(1)
	})
})
