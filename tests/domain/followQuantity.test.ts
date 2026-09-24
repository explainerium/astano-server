import { describe, expect, it } from "vitest"
import { followingQuantity } from "../../src/domain/bundle/followQuantity"

/**
 * The client's own example, 23 September: a set of four, 100 sets wanted.
 * "This is 400 ice cubes and 100 boxes."
 */
describe("followingQuantity", () => {
	it("orders one option per main unit by default", () => {
		expect(followingQuantity(100, 1)).toBe(100)
	})

	it("orders one box per four", () => {
		expect(followingQuantity(400, 4)).toBe(100)
	})

	it("rounds up, because a part-filled box is still a box", () => {
		expect(followingQuantity(401, 4)).toBe(101)
		expect(followingQuantity(1, 4)).toBe(1)
	})

	it("treats a missing or nonsensical box size as one for one", () => {
		expect(followingQuantity(50, 0)).toBe(50)
		expect(followingQuantity(50, -3)).toBe(50)
		expect(followingQuantity(50, 2.5)).toBe(25)
	})
})
