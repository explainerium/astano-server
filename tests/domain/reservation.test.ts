import { describe, expect, it } from "vitest"
import { DEFAULT_STOCK_RULES, type StockRules } from "../../src/domain/stock/availability"
import { reservationFor } from "../../src/domain/stock/reservation"

/**
 * The bug this file exists for: checkout checked availability with `canTake`
 * before the transaction opened and then decremented without a condition. Under
 * READ COMMITTED two checkouts for the last unit both passed that read, both
 * decremented, and the variant landed at -1 with two customers promised it.
 */

const tracked = { manageStock: true, allowBackorder: false }
const backorder = { manageStock: true, allowBackorder: true }
const untracked = { manageStock: false, allowBackorder: false }

const withFloor = (outOfStockThreshold: number): StockRules => ({
	...DEFAULT_STOCK_RULES,
	outOfStockThreshold,
})

describe("reservationFor", () => {
	it("does not touch untracked stock at all", () => {
		expect(reservationFor(untracked, 10, DEFAULT_STOCK_RULES)).toEqual({ kind: "untracked" })
	})

	it("guards a tracked variant with the quantity being taken", () => {
		expect(reservationFor(tracked, 10, DEFAULT_STOCK_RULES)).toEqual({
			kind: "guarded",
			minimumStock: 10,
		})
	})

	it("adds the shop's out-of-stock floor on top of the quantity", () => {
		// The threshold is stock that may not be sold, not a display rule: five
		// held back plus ten ordered needs fifteen on hand.
		expect(reservationFor(tracked, 10, withFloor(5))).toEqual({
			kind: "guarded",
			minimumStock: 15,
		})
	})

	it("lets a backorder go past zero, because that is what a backorder is", () => {
		expect(reservationFor(backorder, 10, withFloor(5))).toEqual({ kind: "unguarded" })
	})

	it("still moves the count for a backorder, so the shop knows how far past", () => {
		expect(reservationFor(backorder, 1, DEFAULT_STOCK_RULES).kind).not.toBe("untracked")
	})

	it("guards a single unit the same way as a hundred", () => {
		expect(reservationFor(tracked, 1, DEFAULT_STOCK_RULES)).toEqual({
			kind: "guarded",
			minimumStock: 1,
		})
	})
})
