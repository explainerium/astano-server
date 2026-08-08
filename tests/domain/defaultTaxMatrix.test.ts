import { describe, expect, it } from "vitest"
import { DEFAULT_RATES, RATE_NAME, REVERSE_CHARGEABLE_EU } from "../../src/domain/tax/defaultMatrix"
import { resolveTax } from "../../src/domain/tax/resolveTax"

/**
 * The matrix a fresh shop starts with, pinned against spec §3.7 / R10.
 *
 * These are the figures astano charges. A change here changes what customers
 * are billed and what the shop owes, so the numbers are asserted rather than
 * described — a quiet edit that turns 19 % into 0 % for France should fail a
 * test, not surface in a quarterly return.
 */

const rates = DEFAULT_RATES.map((rate, index) => ({
	id: String(index),
	countryCode: rate.countryCode,
	state: null,
	name: RATE_NAME,
	rate: rate.rate,
	appliesToShipping: rate.appliesToShipping,
	priority: 1,
	reverseChargeWithVatId: rate.reverseChargeWithVatId,
	isActive: true,
}))

const tax = (countryCode: string, hasValidatedVatId = false) =>
	resolveTax({ countryCode, netAmount: "1000", shippingAmount: "0", rates, hasValidatedVatId })

describe("the default tax matrix", () => {
	it("charges Germany 19%", () => {
		expect(tax("DE").totalTax).toBe("190.00")
	})

	it("still charges Germany 19% with a validated VAT ID", () => {
		/*
		 * The rule most easily got wrong. Reverse charge is for cross-border EU
		 * supply; a German customer buying from a German shop pays German VAT
		 * whatever their VAT ID says. Zeroing it would under-collect on every
		 * domestic B2B order — the shop's largest customers.
		 */
		const result = tax("DE", true)
		expect(result.totalTax).toBe("190.00")
		expect(result.reverseCharged).toBe(false)
	})

	it("charges other EU countries 19% without a validated VAT ID", () => {
		expect(tax("FR").totalTax).toBe("190.00")
		expect(tax("AT").totalTax).toBe("190.00")
	})

	it("reverse charges other EU countries with a validated VAT ID", () => {
		const result = tax("FR", true)
		expect(result.totalTax).toBe("0.00")
		// The flag matters as much as the figure: the invoice has to carry the
		// reverse-charge note, and that is what tells it to.
		expect(result.reverseCharged).toBe(true)
	})

	it("charges Switzerland nothing, as a decision rather than an omission", () => {
		const result = tax("CH")
		expect(result.totalTax).toBe("0.00")
		// Not `unconfigured` — CH has a real 0% row, so checkout proceeds. An
		// absent rate would refuse the order instead.
		expect(result.unconfigured).toBe(false)
	})

	it("reports anywhere else as unconfigured rather than charging nothing", () => {
		// Better to refuse than to invoice at 0% because nobody entered a rate.
		expect(tax("US").unconfigured).toBe(true)
	})

	it("never marks Germany as reverse chargeable", () => {
		expect(REVERSE_CHARGEABLE_EU).not.toContain("DE")
		expect(DEFAULT_RATES.find((r) => r.countryCode === "DE")?.reverseChargeWithVatId).toBe(false)
	})

	it("has exactly one rate per country", () => {
		// resolveTax sums every matching rate, so a duplicate would double the VAT.
		const codes = DEFAULT_RATES.map((r) => r.countryCode)
		expect(new Set(codes).size).toBe(codes.length)
	})
})
