import { describe, expect, it } from "vitest"
import { splitTaxableLines, type TaxableLine } from "../../src/domain/tax/taxableGroups"

/**
 * The two settings on the admin's product form that governed nothing.
 *
 * Checkout took the default tax class and applied it to the whole subtotal, so
 * a product marked "not taxed" was invoiced at 19% anyway and a reduced-rate
 * class could be entered and never reach a customer.
 */

const goods = (
	net: string,
	taxStatus: TaxableLine["taxStatus"] = "TAXABLE",
	taxClassId: string | null = null
): TaxableLine => ({ net, taxStatus, taxClassId })

describe("splitTaxableLines", () => {
	it("puts everything on the default class when no product names one", () => {
		const split = splitTaxableLines([goods("100.00"), goods("50.00")])

		expect(split.groups).toHaveLength(1)
		expect(split.groups[0]?.taxClassId).toBeNull()
		expect(split.groups[0]?.net.toFixed(2)).toBe("150.00")
	})

	it("keeps a reduced-rate class apart from the standard one", () => {
		const split = splitTaxableLines([
			goods("100.00", "TAXABLE", null),
			goods("40.00", "TAXABLE", "reduced"),
			goods("20.00", "TAXABLE", "reduced"),
		])

		expect(split.groups).toHaveLength(2)
		expect(split.groups.find((g) => g.taxClassId === null)?.net.toFixed(2)).toBe("100.00")
		expect(split.groups.find((g) => g.taxClassId === "reduced")?.net.toFixed(2)).toBe("60.00")
	})

	it("leaves a NONE product out of the taxable base entirely", () => {
		const split = splitTaxableLines([goods("100.00"), goods("500.00", "NONE")])
		expect(split.groups[0]?.net.toFixed(2)).toBe("100.00")
	})

	it("leaves a SHIPPING_ONLY product's goods out of the base", () => {
		const split = splitTaxableLines([goods("100.00", "SHIPPING_ONLY")])
		expect(split.groups).toHaveLength(0)
	})

	it("still taxes delivery for a SHIPPING_ONLY basket — that is what it means", () => {
		const split = splitTaxableLines([goods("100.00", "SHIPPING_ONLY")])
		expect(split.shippingTaxable).toBe(true)
	})

	it("taxes nothing at all when every line is NONE", () => {
		const split = splitTaxableLines([goods("100.00", "NONE"), goods("50.00", "NONE")])
		expect(split.groups).toHaveLength(0)
		expect(split.shippingTaxable).toBe(false)
	})

	it("does not let one untaxed product untax the delivery of the rest", () => {
		const split = splitTaxableLines([goods("100.00"), goods("10.00", "NONE")])
		expect(split.shippingTaxable).toBe(true)
	})

	it("delivers under the class of the largest taxable group", () => {
		const split = splitTaxableLines([
			goods("40.00", "TAXABLE", "reduced"),
			goods("120.00", "TAXABLE", "standard"),
		])
		expect(split.shippingTaxClassId).toBe("standard")
	})

	it("falls back to the default class when there are no taxable goods", () => {
		const split = splitTaxableLines([goods("100.00", "SHIPPING_ONLY", null)])
		expect(split.shippingTaxClassId).toBeNull()
	})

	it("handles an empty basket", () => {
		const split = splitTaxableLines([])
		expect(split.groups).toEqual([])
		expect(split.shippingTaxable).toBe(false)
	})
})
