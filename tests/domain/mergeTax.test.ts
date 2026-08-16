import { describe, expect, it } from "vitest"
import { mergeTax, resolveTax, type TaxRateInput } from "../../src/domain/tax/resolveTax"

/**
 * A basket can need several resolutions — standard-rate goods, reduced-rate
 * goods, and the delivery charge — and the customer is owed one set of totals.
 */

const standard: TaxRateInput = {
	countryCode: "DE", name: "MwSt", rate: "19", appliesToShipping: true,
	priority: 1, reverseChargeWithVatId: false, isActive: true,
}

const reduced: TaxRateInput = { ...standard, name: "MwSt ermäßigt", rate: "7" }

const reverse: TaxRateInput = {
	...standard, countryCode: "AT", reverseChargeWithVatId: true,
}

describe("mergeTax", () => {
	it("sums the tax across every part", () => {
		const merged = mergeTax([
			resolveTax({ countryCode: "DE", netAmount: "100.00", rates: [standard] }),
			resolveTax({ countryCode: "DE", netAmount: "100.00", rates: [reduced] }),
		])

		expect(merged.totalTax).toBe("26.00")
	})

	it("keeps different rates as separate invoice lines", () => {
		const merged = mergeTax([
			resolveTax({ countryCode: "DE", netAmount: "400.00", rates: [standard] }),
			resolveTax({ countryCode: "DE", netAmount: "120.00", rates: [reduced] }),
		])

		expect(merged.lines).toHaveLength(2)
		expect(merged.lines.map((l) => l.amount)).toEqual(["76.00", "8.40"])
	})

	it("adds together lines that share a name and a rate", () => {
		// Two classes can both carry "MwSt 19%" — printing it twice on one
		// invoice reads as a mistake even when both rows are right.
		const merged = mergeTax([
			resolveTax({ countryCode: "DE", netAmount: "100.00", rates: [standard] }),
			resolveTax({ countryCode: "DE", netAmount: "50.00", rates: [standard] }),
		])

		expect(merged.lines).toHaveLength(1)
		expect(merged.lines[0]?.taxableBase).toBe("150.00")
		expect(merged.lines[0]?.amount).toBe("28.50")
	})

	it("carries reverse charge through if any part was reverse-charged", () => {
		const merged = mergeTax([
			resolveTax({ countryCode: "AT", netAmount: "100.00", hasValidatedVatId: true, rates: [reverse] }),
		])

		expect(merged.reverseCharged).toBe(true)
		expect(merged.totalTax).toBe("0.00")
	})

	it("refuses the whole order if any destination has no rate", () => {
		const merged = mergeTax([
			resolveTax({ countryCode: "DE", netAmount: "100.00", rates: [standard] }),
			resolveTax({ countryCode: "DE", netAmount: "100.00", rates: [] }),
		])

		expect(merged.unconfigured).toBe(true)
	})

	it("treats a basket with nothing taxable as an answer, not a missing one", () => {
		const merged = mergeTax([])

		expect(merged.unconfigured).toBe(false)
		expect(merged.totalTax).toBe("0.00")
		expect(merged.lines).toEqual([])
	})

	it("counts the delivery charge exactly once across several classes", () => {
		// Goods resolved per class with no shipping, then shipping resolved alone
		// — which is how orderTax.ts calls it, and why a two-class basket cannot
		// tax the same postage twice.
		const merged = mergeTax([
			resolveTax({ countryCode: "DE", netAmount: "100.00", shippingAmount: 0, shippingTaxable: false, rates: [standard] }),
			resolveTax({ countryCode: "DE", netAmount: "100.00", shippingAmount: 0, shippingTaxable: false, rates: [reduced] }),
			resolveTax({ countryCode: "DE", netAmount: 0, shippingAmount: "10.00", shippingTaxable: true, rates: [standard] }),
		])

		// 19 + 7 + 1.90
		expect(merged.totalTax).toBe("27.90")
	})
})
