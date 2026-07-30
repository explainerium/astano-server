import { describe, expect, it } from "vitest"
import { resolveTax, type TaxRateInput } from "../../src/domain/tax/resolveTax"

/**
 * The rates below are what an admin would enter to reproduce the old shop's
 * arrangement. Nothing in resolveTax knows about Germany, Switzerland or 19% —
 * that is the point.
 */
const de: TaxRateInput = {
	countryCode: "DE", name: "Steuer", rate: "19", appliesToShipping: true,
	priority: 1, reverseChargeWithVatId: false, isActive: true,
}

const at: TaxRateInput = {
	countryCode: "AT", name: "Steuer", rate: "19", appliesToShipping: true,
	priority: 1, reverseChargeWithVatId: true, isActive: true,
}

const ch: TaxRateInput = {
	countryCode: "CH", name: "Steuer", rate: "0", appliesToShipping: false,
	priority: 1, reverseChargeWithVatId: false, isActive: true,
}

const rates = [de, at, ch]

describe("resolveTax", () => {
	it("applies the rate for the destination country", () => {
		const r = resolveTax({ countryCode: "DE", netAmount: "100.00", rates })
		expect(r.totalTax).toBe("19.00")
		expect(r.lines[0]?.name).toBe("Steuer")
	})

	it("charges nothing where the admin entered 0%", () => {
		expect(resolveTax({ countryCode: "CH", netAmount: "100.00", rates }).totalTax).toBe("0.00")
	})

	it("taxes shipping when the rate says to", () => {
		const r = resolveTax({
			countryCode: "DE", netAmount: "100.00", shippingAmount: "8.50",
			shippingTaxable: true, rates,
		})
		// 108.50 * 19%
		expect(r.totalTax).toBe("20.62")
	})

	it("leaves shipping untaxed when the method is not taxable", () => {
		const r = resolveTax({
			countryCode: "DE", netAmount: "100.00", shippingAmount: "8.50",
			shippingTaxable: false, rates,
		})
		expect(r.totalTax).toBe("19.00")
	})

	it("zeroes the tax under reverse charge but still records the line", () => {
		const r = resolveTax({
			countryCode: "AT", netAmount: "100.00", hasValidatedVatId: true, rates,
		})
		expect(r.totalTax).toBe("0.00")
		expect(r.reverseCharged).toBe(true)
		// The invoice has to be able to explain why nothing was charged.
		expect(r.lines).toHaveLength(1)
		expect(r.lines[0]?.amount).toBe("0.00")
	})

	it("charges normally without a validated VAT ID", () => {
		const r = resolveTax({
			countryCode: "AT", netAmount: "100.00", hasValidatedVatId: false, rates,
		})
		expect(r.totalTax).toBe("19.00")
		expect(r.reverseCharged).toBe(false)
	})

	it("does not reverse-charge a country the admin did not mark for it", () => {
		const r = resolveTax({
			countryCode: "DE", netAmount: "100.00", hasValidatedVatId: true, rates,
		})
		expect(r.totalTax).toBe("19.00")
		expect(r.reverseCharged).toBe(false)
	})

	it("reports an unconfigured destination instead of silently charging zero", () => {
		const r = resolveTax({ countryCode: "US", netAmount: "100.00", rates })
		expect(r.unconfigured).toBe(true)
		expect(r.totalTax).toBe("0.00")
	})

	it("reports a missing country the same way", () => {
		expect(resolveTax({ countryCode: null, netAmount: "100.00", rates }).unconfigured).toBe(true)
	})

	it("ignores inactive rates", () => {
		const r = resolveTax({
			countryCode: "DE", netAmount: "100.00",
			rates: [{ ...de, isActive: false }],
		})
		expect(r.unconfigured).toBe(true)
	})

	it("is case-insensitive about country codes", () => {
		expect(resolveTax({ countryCode: "de", netAmount: "100.00", rates }).totalTax).toBe("19.00")
	})

	it("applies several rates in priority order", () => {
		const stacked: TaxRateInput[] = [
			{ ...de, name: "VAT", rate: "10", priority: 1 },
			{ ...de, name: "Eco levy", rate: "5", priority: 2 },
		]
		const r = resolveTax({ countryCode: "DE", netAmount: "100.00", rates: stacked })
		expect(r.lines.map((l) => l.name)).toEqual(["VAT", "Eco levy"])
		expect(r.totalTax).toBe("15.00")
	})

	it("prefers a state-scoped rate and ignores it elsewhere", () => {
		const scoped: TaxRateInput[] = [{ ...de, state: "BY", rate: "20" }]
		expect(resolveTax({ countryCode: "DE", state: "BY", netAmount: "100.00", rates: scoped }).totalTax).toBe("20.00")
		expect(resolveTax({ countryCode: "DE", state: "NRW", netAmount: "100.00", rates: scoped }).unconfigured).toBe(true)
	})

	it("rounds each line to 2dp", () => {
		const r = resolveTax({ countryCode: "DE", netAmount: "33.33", rates })
		expect(r.totalTax).toBe("6.33")
	})
})
