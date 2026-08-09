import { describe, expect, it } from "vitest"
import {
	availableOf,
	canTake,
	DEFAULT_STOCK_RULES,
	isInStock,
	isLow,
	readStockRules,
} from "../../src/domain/stock/availability"

/**
 * The out-of-stock threshold is read by five separate guards. These pin that
 * they agree, and that the default reproduces the behaviour that was hardcoded
 * before the setting existed.
 */
describe("stock availability", () => {
	const tracked = { manageStock: true, stock: 5, allowBackorder: false }
	const untracked = { manageStock: false, stock: 0, allowBackorder: false }
	const backorder = { manageStock: true, stock: 0, allowBackorder: true }

	const none = DEFAULT_STOCK_RULES
	const floor3 = { outOfStockThreshold: 3, lowThreshold: 2 }

	it("defaults to the behaviour that was hardcoded", () => {
		expect(none.outOfStockThreshold).toBe(0)
		expect(isInStock({ manageStock: true, stock: 1, allowBackorder: false }, none)).toBe(true)
		expect(isInStock({ manageStock: true, stock: 0, allowBackorder: false }, none)).toBe(false)
	})

	it("holds back the threshold from what may be sold", () => {
		expect(availableOf(tracked, none)).toBe(5)
		expect(availableOf(tracked, floor3)).toBe(2)
	})

	it("never reports negative availability", () => {
		expect(availableOf({ manageStock: true, stock: 1, allowBackorder: false }, floor3)).toBe(0)
	})

	it("treats untracked stock as unlimited, not empty", () => {
		expect(availableOf(untracked, floor3)).toBeNull()
		expect(isInStock(untracked, floor3)).toBe(true)
		expect(canTake(untracked, 9999, floor3)).toBe(true)
	})

	it("keeps backorder variants sellable below the threshold", () => {
		expect(isInStock(backorder, floor3)).toBe(true)
		expect(canTake(backorder, 50, floor3)).toBe(true)
	})

	it("refuses a quantity that would break the floor", () => {
		expect(canTake(tracked, 2, floor3)).toBe(true)
		expect(canTake(tracked, 3, floor3)).toBe(false)
		expect(canTake(tracked, 5, none)).toBe(true)
		expect(canTake(tracked, 6, none)).toBe(false)
	})

	describe("low stock", () => {
		it("uses the variant's own mark before the shop-wide one", () => {
			expect(isLow({ manageStock: true, stock: 4, allowBackorder: false, lowStockThreshold: 5 }, none)).toBe(true)
			expect(isLow({ manageStock: true, stock: 4, allowBackorder: false }, none)).toBe(false)
		})

		it("does not call an untracked variant low", () => {
			expect(isLow({ manageStock: false, stock: 0, allowBackorder: false }, none)).toBe(false)
		})

		it("does not call a sold-out variant low", () => {
			// Sold out is its own state. Reporting both would announce one event twice.
			expect(isLow({ manageStock: true, stock: 0, allowBackorder: false }, none)).toBe(false)
			expect(isLow({ manageStock: true, stock: 3, allowBackorder: false }, floor3)).toBe(false)
		})

		it("measures against sellable stock, not raw stock", () => {
			// 5 on hand, 3 held back, 2 sellable, mark of 2 — low.
			expect(isLow(tracked, floor3)).toBe(true)
		})
	})

	describe("readStockRules", () => {
		it("reads configured values", () => {
			expect(readStockRules({ "stock.outOfStockThreshold": 4, "stock.lowThreshold": 9 })).toEqual({
				outOfStockThreshold: 4,
				lowThreshold: 9,
			})
		})

		it("coerces the strings a JSON column can hand back", () => {
			expect(readStockRules({ "stock.outOfStockThreshold": "4" }).outOfStockThreshold).toBe(4)
		})

		it("falls back rather than accepting a negative floor", () => {
			// A negative floor would sell stock past zero.
			expect(readStockRules({ "stock.outOfStockThreshold": -5 }).outOfStockThreshold).toBe(0)
			expect(readStockRules({ "stock.outOfStockThreshold": "nonsense" }).outOfStockThreshold).toBe(0)
			expect(readStockRules({})).toEqual(DEFAULT_STOCK_RULES)
		})
	})
})
