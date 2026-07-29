import { describe, expect, it } from "vitest"
import {
	applyMoqFloor,
	getEffectiveMoq,
	isBelowMoq,
} from "../../src/domain/moq/getEffectiveMoq"

/** Business rules R3 and R4. */
describe("getEffectiveMoq (R3)", () => {
	it("uses the product minimum when the variant does not override", () => {
		expect(getEffectiveMoq({ productMoq: 500 })).toBe(500)
		expect(getEffectiveMoq({ productMoq: 500, variantMoq: null })).toBe(500)
		expect(getEffectiveMoq({ productMoq: 500, variantMoq: undefined })).toBe(500)
	})

	it("lets a variant override the product minimum", () => {
		expect(getEffectiveMoq({ productMoq: 500, variantMoq: 50 })).toBe(50)
		expect(getEffectiveMoq({ productMoq: 50, variantMoq: 1000 })).toBe(1000)
	})

	it("treats a variant override of 0 as disabling the minimum, not inheriting", () => {
		expect(getEffectiveMoq({ productMoq: 500, variantMoq: 0 })).toBe(0)
	})

	it("treats 0, null and undefined at product level as no minimum", () => {
		expect(getEffectiveMoq({ productMoq: 0 })).toBe(0)
		expect(getEffectiveMoq({ productMoq: null })).toBe(0)
		expect(getEffectiveMoq({ productMoq: undefined })).toBe(0)
	})

	it("handles the values actually used by the old catalogue", () => {
		for (const moq of [50, 100, 500, 1000, 5000]) {
			expect(getEffectiveMoq({ productMoq: moq })).toBe(moq)
		}
	})
})

describe("isBelowMoq (R4)", () => {
	it("flags quantities under the minimum", () => {
		expect(isBelowMoq(49, 50)).toBe(true)
		expect(isBelowMoq(50, 50)).toBe(false)
		expect(isBelowMoq(51, 50)).toBe(false)
	})

	it("never flags anything when there is no minimum", () => {
		expect(isBelowMoq(1, 0)).toBe(false)
	})
})

describe("applyMoqFloor (R4 raise behaviour)", () => {
	it("raises a too-small quantity and reports that it did", () => {
		expect(applyMoqFloor(10, 500)).toEqual({ quantity: 500, adjusted: true })
	})

	it("leaves an acceptable quantity untouched", () => {
		expect(applyMoqFloor(500, 500)).toEqual({ quantity: 500, adjusted: false })
		expect(applyMoqFloor(750, 500)).toEqual({ quantity: 750, adjusted: false })
	})

	it("never allows a zero or negative quantity", () => {
		expect(applyMoqFloor(0, 0)).toEqual({ quantity: 1, adjusted: false })
		expect(applyMoqFloor(-5, 0)).toEqual({ quantity: 1, adjusted: false })
	})

	it("floors fractional quantities", () => {
		expect(applyMoqFloor(7.9, 0)).toEqual({ quantity: 7, adjusted: false })
	})
})
