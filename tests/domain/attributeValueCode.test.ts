import { describe, expect, it } from "vitest"
import { sameLabel, uniqueValueCode } from "../../src/domain/product/attributeValueCode"

describe("uniqueValueCode", () => {
	it("uses the slug when it is free", () => {
		expect(uniqueValueCode("kupfer-matt", ["edelstahl"])).toBe("kupfer-matt")
	})

	it("numbers it when the slug is taken", () => {
		expect(uniqueValueCode("kupfer-matt", ["kupfer-matt"])).toBe("kupfer-matt-2")
		expect(uniqueValueCode("kupfer-matt", ["kupfer-matt", "kupfer-matt-2"])).toBe("kupfer-matt-3")
	})

	it("falls back when the label has nothing to slug", () => {
		expect(uniqueValueCode("", [])).toBe("wert")
	})
})

describe("sameLabel", () => {
	it("ignores case and spacing", () => {
		expect(sameLabel("Kupfer  matt", " kupfer matt")).toBe(true)
		expect(sameLabel("Kupfer", "Kupfer matt")).toBe(false)
	})
})
