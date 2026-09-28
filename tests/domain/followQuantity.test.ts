import { describe, expect, it } from "vitest"
import {
	followerQuantities,
	followingQuantity,
	packedMainQuantity,
	packSizesOf,
} from "../../src/domain/bundle/followQuantity"

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

/**
 * The client, 25 September: "you buy 100 ice cubes and choose the box for 6
 * pieces… Customer has to take 102 ice cubes instead of 100."
 */
describe("packedMainQuantity", () => {
	it("raises the quantity so the boxes come out whole", () => {
		expect(packedMainQuantity(100, [6])).toBe(102)
		expect(followingQuantity(102, 6)).toBe(17)
	})

	it("leaves a quantity that already fits", () => {
		expect(packedMainQuantity(100, [4])).toBe(100)
		expect(packedMainQuantity(102, [6])).toBe(102)
	})

	it("fits both pack sizes when two are chosen", () => {
		// Four and six both have to come out whole, so twelve is the step.
		expect(packedMainQuantity(100, [4, 6])).toBe(108)
	})

	it("ignores a pack of one, which constrains nothing", () => {
		expect(packedMainQuantity(100, [1])).toBe(100)
		expect(packedMainQuantity(100, [1, 6])).toBe(102)
	})

	it("leaves the quantity alone rather than inventing a huge order", () => {
		// A step past the cap would raise 100 to 1001.
		expect(packedMainQuantity(100, [7, 11, 13])).toBe(100)
	})
})

/**
 * The client, 28 September: "The printing always should be same quantity as
 * the choosen boxes."
 */
describe("followerQuantities", () => {
	const box = (id: string, per: number) => ({
		id,
		productId: `p-${id}`,
		rule: { unitsPerOption: per, countsOptions: [] },
	})
	const print = (counts: string[]) => ({
		id: "print",
		productId: "p-print",
		rule: { unitsPerOption: 1, countsOptions: counts.map((c) => `p-${c}`) },
	})

	it("prints once per box of two", () => {
		const q = followerQuantities(100, [box("two", 2), print(["one", "two", "four"])])
		expect(q.get("two")).toBe(50)
		expect(q.get("print")).toBe(50)
	})

	it("prints once per box of four", () => {
		const q = followerQuantities(100, [print(["one", "two", "four"]), box("four", 4)])
		expect(q.get("four")).toBe(25)
		expect(q.get("print")).toBe(25)
	})

	it("prints on every box chosen, adding them up", () => {
		const q = followerQuantities(100, [box("one", 1), box("four", 4), print(["one", "four"])])
		expect(q.get("print")).toBe(125)
	})

	it("ignores boxes it does not print on", () => {
		const q = followerQuantities(100, [box("metal", 4), print(["one", "two", "four"])])
		expect(q.get("print")).toBe(0)
	})

	it("leaves counters out of the pack sizes", () => {
		expect(packSizesOf([{ unitsPerOption: 4, countsOptions: [] }, { unitsPerOption: 6, countsOptions: ["x"] }])).toEqual([4])
	})
})
