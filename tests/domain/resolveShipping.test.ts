import { describe, expect, it } from "vitest"
import Decimal from "decimal.js"
import {
	availableQuotes,
	findBand,
	resolveShipping,
	type ShippingMethodInput,
} from "../../src/domain/shipping/resolveShipping"

const bands = [
	{ minValue: "0.1", maxValue: "15", cost: "8.50" },
	{ minValue: "15", maxValue: "30", cost: "18.00" },
	{ minValue: "30", maxValue: "45", cost: "28.00" },
	{ minValue: "320", maxValue: null, cost: "190.00" },
]

const weightMethod: ShippingMethodInput = {
	id: "m1",
	code: "de-standard",
	name: "Versand Deutschland",
	type: "WEIGHT_BANDED",
	taxable: true,
	sortOrder: 0,
	bands,
}

describe("findBand — half-open intervals", () => {
	it("matches at the lower bound", () => {
		expect(findBand(bands, new Decimal("15"))?.cost).toBe("18.00")
	})

	it("excludes the upper bound, so adjacent bands never both match", () => {
		// The old shop had two rules claiming exactly 320 kg. With half-open
		// intervals a boundary value belongs to exactly one band.
		expect(findBand(bands, new Decimal("14.999"))?.cost).toBe("8.50")
		expect(findBand(bands, new Decimal("15"))?.cost).toBe("18.00")
		expect(findBand(bands, new Decimal("29.999"))?.cost).toBe("18.00")
		expect(findBand(bands, new Decimal("30"))?.cost).toBe("28.00")
	})

	it("treats a null maximum as open-ended", () => {
		expect(findBand(bands, new Decimal("100000"))?.cost).toBe("190.00")
	})

	it("returns nothing below the first band", () => {
		expect(findBand(bands, new Decimal("0.05"))).toBeNull()
	})

	it("returns nothing in a gap between bands", () => {
		expect(findBand(bands, new Decimal("100"))).toBeNull()
	})
})

describe("resolveShipping", () => {
	it("quotes a weight-banded method", () => {
		const [q] = resolveShipping({ weightKg: 10, subtotal: 500, methods: [weightMethod] })
		expect(q?.cost).toBe("8.50")
		expect(q?.unavailableReason).toBeUndefined()
	})

	it("reports why a method cannot quote rather than dropping it", () => {
		// Silently offering no shipping is the worst checkout failure there is.
		const [q] = resolveShipping({ weightKg: 100, subtotal: 500, methods: [weightMethod] })
		expect(q?.unavailableReason).toBe("NO_MATCHING_BAND")
		expect(availableQuotes([q!])).toHaveLength(0)
	})

	it("quotes a flat rate whatever the weight", () => {
		const flat: ShippingMethodInput = {
			id: "m2", code: "flat", name: "Flat", type: "FLAT_RATE",
			flatCost: "12.00", taxable: true, sortOrder: 0,
		}
		expect(resolveShipping({ weightKg: 999, subtotal: 1, methods: [flat] })[0]?.cost).toBe("12.00")
	})

	it("flags a flat rate with no cost configured", () => {
		const flat: ShippingMethodInput = {
			id: "m3", code: "flat", name: "Flat", type: "FLAT_RATE",
			taxable: true, sortOrder: 0,
		}
		expect(resolveShipping({ weightKg: 1, subtotal: 1, methods: [flat] })[0]?.unavailableReason).toBe("NOT_CONFIGURED")
	})

	it("honours a free-shipping threshold", () => {
		const free: ShippingMethodInput = {
			id: "m4", code: "free", name: "Free over 200", type: "FREE_SHIPPING",
			freeAboveSubtotal: "200", taxable: false, sortOrder: 0,
		}
		expect(resolveShipping({ weightKg: 5, subtotal: 199.99, methods: [free] })[0]?.unavailableReason).toBe("BELOW_FREE_THRESHOLD")
		expect(resolveShipping({ weightKg: 5, subtotal: 200, methods: [free] })[0]?.cost).toBe("0.00")
	})

	it("bands on order value when asked to", () => {
		const priced: ShippingMethodInput = {
			id: "m5", code: "byvalue", name: "By value", type: "PRICE_BANDED",
			taxable: true, sortOrder: 0,
			bands: [
				{ minValue: "0", maxValue: "100", cost: "9.90" },
				{ minValue: "100", maxValue: null, cost: "4.90" },
			],
		}
		expect(resolveShipping({ weightKg: 50, subtotal: 99.99, methods: [priced] })[0]?.cost).toBe("9.90")
		expect(resolveShipping({ weightKg: 50, subtotal: 100, methods: [priced] })[0]?.cost).toBe("4.90")
	})

	it("returns methods in the admin's chosen order", () => {
		const a = { ...weightMethod, id: "a", code: "a", sortOrder: 2 }
		const b = { ...weightMethod, id: "b", code: "b", sortOrder: 1 }
		expect(resolveShipping({ weightKg: 1, subtotal: 1, methods: [a, b] }).map((q) => q.code)).toEqual(["b", "a"])
	})

	it("picks the most specific band if an admin enters overlapping ones", () => {
		const overlapping = [
			{ minValue: "0", maxValue: "100", cost: "10.00" },
			{ minValue: "50", maxValue: "100", cost: "5.00" },
		]
		expect(findBand(overlapping, new Decimal("60"))?.cost).toBe("5.00")
	})
})
