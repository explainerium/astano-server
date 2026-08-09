import { describe, expect, it } from "vitest"
import { canSellTo, readSellingRule } from "../../src/domain/shop/sellingLocations"

/**
 * Which countries the shop will take an order from.
 *
 * The checkout filters its country field with this and the API refuses with it,
 * from the same rule — so the two can only disagree if this changes without the
 * frontend copy following. Pinned here for that reason.
 */
describe("sellingLocations", () => {
	const all = { mode: "all" as const, countries: [] }
	const only = { mode: "specific" as const, countries: ["DE", "AT"] }
	const except = { mode: "all_except" as const, countries: ["CH"] }

	it("sells everywhere by default", () => {
		expect(canSellTo(all, "US")).toBe(true)
		expect(canSellTo(all, "CH")).toBe(true)
	})

	it("sells only to the listed countries", () => {
		expect(canSellTo(only, "DE")).toBe(true)
		expect(canSellTo(only, "CH")).toBe(false)
	})

	it("sells everywhere but the listed countries", () => {
		expect(canSellTo(except, "CH")).toBe(false)
		expect(canSellTo(except, "US")).toBe(true)
	})

	it("is case-insensitive about country codes", () => {
		expect(canSellTo(only, "de")).toBe(true)
	})

	it("does not refuse before a country is known", () => {
		// The checkout asks what it may sell before anybody has typed an address.
		// A refusal there would empty the country field it is about to render.
		expect(canSellTo(only, null)).toBe(true)
		expect(canSellTo(only, undefined)).toBe(true)
	})

	describe("readSellingRule", () => {
		it("reads a configured rule", () => {
			const rule = readSellingRule({
				"selling.locations": "specific",
				"selling.countries": ["DE", "AT"],
			})
			expect(rule).toEqual({ mode: "specific", countries: ["DE", "AT"] })
		})

		it("falls back to selling everywhere on rubbish", () => {
			/*
			 * Deliberately asymmetric. A bad value that refuses every country stops
			 * the shop trading with no visible cause; one that sells too widely
			 * shows up in the orders that arrive.
			 */
			expect(readSellingRule({ "selling.locations": 42 }).mode).toBe("all")
			expect(readSellingRule({ "selling.countries": "nope" }).countries).toEqual([])
			expect(readSellingRule({}).mode).toBe("all")
		})
	})
})
