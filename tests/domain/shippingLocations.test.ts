import { describe, expect, it } from "vitest"
import {
	canShipTo,
	DEFAULT_SHIPPING_RULE,
	readShippingRule,
	shippingDisabled,
} from "../../src/domain/shop/shippingLocations"
import type { SellingRule } from "../../src/domain/shop/sellingLocations"

/**
 * The relationship with the selling rule is the whole point of this file, so
 * that is what these pin. Shipping can only ever narrow what selling allows.
 */
describe("shippingLocations", () => {
	const sellAll: SellingRule = { mode: "all", countries: [] }
	const sellDeAt: SellingRule = { mode: "specific", countries: ["DE", "AT"] }

	it("follows the selling rule by default", () => {
		const rule = DEFAULT_SHIPPING_RULE

		expect(canShipTo(rule, sellAll, "US")).toBe(true)
		expect(canShipTo(rule, sellDeAt, "DE")).toBe(true)
		expect(canShipTo(rule, sellDeAt, "US")).toBe(false)
	})

	it("cannot widen what the shop sells", () => {
		// The dangerous case: an admin lists a country here that the selling rule
		// refuses. Offering delivery to somewhere an order cannot be placed is
		// not a state worth having.
		const rule = { mode: "specific" as const, countries: ["DE", "US"] }

		expect(canShipTo(rule, sellDeAt, "DE")).toBe(true)
		expect(canShipTo(rule, sellDeAt, "US")).toBe(false)
	})

	it("narrows within what the shop sells", () => {
		const rule = { mode: "specific" as const, countries: ["DE"] }

		expect(canShipTo(rule, sellDeAt, "DE")).toBe(true)
		// Sold to, but not delivered to — pickup or digital.
		expect(canShipTo(rule, sellDeAt, "AT")).toBe(false)
	})

	it("still respects the selling rule when set to all countries", () => {
		const rule = { mode: "all" as const, countries: [] }

		expect(canShipTo(rule, sellAll, "US")).toBe(true)
		expect(canShipTo(rule, sellDeAt, "US")).toBe(false)
	})

	it("refuses everywhere when shipping is switched off", () => {
		const rule = { mode: "disabled" as const, countries: [] }

		expect(canShipTo(rule, sellAll, "DE")).toBe(false)
		expect(canShipTo(rule, sellAll, null)).toBe(false)
		expect(shippingDisabled(rule)).toBe(true)
	})

	it("does not refuse before a country is known", () => {
		// The checkout asks what it may offer before an address exists.
		expect(canShipTo(DEFAULT_SHIPPING_RULE, sellDeAt, null)).toBe(true)
		expect(canShipTo({ mode: "specific", countries: ["DE"] }, sellAll, undefined)).toBe(true)
	})

	it("is case-insensitive", () => {
		expect(canShipTo({ mode: "specific", countries: ["de"] }, sellAll, "DE")).toBe(true)
		expect(canShipTo({ mode: "specific", countries: ["DE"] }, sellAll, "de")).toBe(true)
	})

	describe("readShippingRule", () => {
		it("reads a configured rule", () => {
			expect(
				readShippingRule({ "shipping.locations": "specific", "shipping.countries": ["DE"] })
			).toEqual({ mode: "specific", countries: ["DE"] })
		})

		it("falls back to following the selling rule on rubbish", () => {
			// Same asymmetry as the selling rule: a bad value must not silently
			// stop the shop delivering.
			expect(readShippingRule({ "shipping.locations": 42 }).mode).toBe("selling")
			expect(readShippingRule({ "shipping.countries": "nope" }).countries).toEqual([])
			expect(readShippingRule({})).toEqual(DEFAULT_SHIPPING_RULE)
		})
	})
})
