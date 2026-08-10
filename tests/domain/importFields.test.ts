import { describe, expect, it } from "vitest"
import {
	findAttributeColumns,
	readBackorders,
	readBoolean,
	readCategoryPaths,
	readDecimal,
	readImageUrls,
	readInt,
	readStatus,
	readVisibility,
	splitList,
	suggestMapping,
} from "../../src/domain/product/importFields"

/**
 * These decide what a customer's file actually means. The German cases are not
 * hypothetical — the shop's own export is in German.
 */
describe("import field detection", () => {
	it("maps a German WooCommerce export without being told anything", () => {
		const headers = [
			"ID",
			"Typ",
			"Artikelnummer",
			"Name",
			"Veröffentlicht",
			"Beschreibung",
			"Kurzbeschreibung",
			"Regulärer Preis",
			"Angebotspreis",
			"Bestand",
			"Gewicht (kg)",
			"Länge (cm)",
			"Kategorien",
			"Bilder",
			"Reseller Base Price",
		]

		const mapping = suggestMapping(headers)

		expect(mapping["Artikelnummer"]).toBe("sku")
		expect(mapping["Name"]).toBe("name")
		expect(mapping["Regulärer Preis"]).toBe("priceB2C")
		expect(mapping["Reseller Base Price"]).toBe("priceReseller")
		expect(mapping["Bestand"]).toBe("stock")
		expect(mapping["Gewicht (kg)"]).toBe("weightKg")
		expect(mapping["Kategorien"]).toBe("categories")
		expect(mapping["Bilder"]).toBe("images")
		// Nothing sensible to do with these, and a wrong guess is worse than none.
		expect(mapping["ID"]).toBeUndefined()
		expect(mapping["Typ"]).toBeUndefined()
	})

	it("maps an English export too", () => {
		const mapping = suggestMapping(["SKU", "Name", "Regular price", "Stock", "Categories"])
		expect(mapping["SKU"]).toBe("sku")
		expect(mapping["Regular price"]).toBe("priceB2C")
	})

	it("never maps two columns onto one field", () => {
		// Both are aliases of priceB2C; the second must be left for the admin.
		const mapping = suggestMapping(["Regular price", "Price"])
		const mapped = Object.values(mapping).filter((f) => f === "priceB2C")
		expect(mapped).toHaveLength(1)
	})

	describe("attribute columns", () => {
		it("finds numbered pairs in either language", () => {
			const found = findAttributeColumns([
				"Name",
				"Attribut 1 Name",
				"Attribut 1 Wert(e)",
				"Attribut 1 sichtbar",
				"Attribut 2 Name",
				"Attribut 2 Wert(e)",
			])

			expect(found).toHaveLength(2)
			expect(found[0]).toMatchObject({ position: 1, nameHeader: "Attribut 1 Name" })
			expect(found[1]!.valueHeader).toBe("Attribut 2 Wert(e)")
		})

		it("ignores a name column with no values beside it", () => {
			expect(findAttributeColumns(["Attribut 1 Name"])).toHaveLength(0)
		})

		it("sorts by position rather than column order", () => {
			const found = findAttributeColumns([
				"Attribute 2 name",
				"Attribute 2 value(s)",
				"Attribute 1 name",
				"Attribute 1 value(s)",
			])
			expect(found.map((f) => f.position)).toEqual([1, 2])
		})
	})

	describe("splitList", () => {
		it("respects an escaped comma", () => {
			// One material, not two. WooCommerce writes it exactly this way.
			expect(splitList("Edelstahl 430\\, rostfrei")).toEqual(["Edelstahl 430, rostfrei"])
		})

		it("splits on real commas and trims", () => {
			expect(splitList("a, b ,c")).toEqual(["a", "b", "c"])
		})

		it("drops empty entries", () => {
			expect(splitList("a,,b,")).toEqual(["a", "b"])
		})
	})

	describe("readDecimal", () => {
		it("reads both decimal conventions", () => {
			expect(readDecimal("1.69")).toBe("1.69")
			// German: comma is the decimal mark.
			expect(readDecimal("1,69")).toBe("1.69")
			expect(readDecimal("1.234,56")).toBe("1234.56")
			expect(readDecimal("1,234.56")).toBe("1234.56")
		})

		it("strips currency and spaces", () => {
			expect(readDecimal(" € 12.50 ")).toBe("12.50")
		})

		it("refuses what is not a number", () => {
			expect(readDecimal("")).toBeNull()
			expect(readDecimal("n/a")).toBeNull()
			expect(readDecimal("12.34.56")).toBeNull()
		})

		it("keeps a plain integer intact", () => {
			expect(readDecimal("28800")).toBe("28800")
			expect(readInt("28800")).toBe(28800)
		})
	})

	describe("readBoolean and friends", () => {
		it("reads the spellings exports actually use", () => {
			for (const yes of ["1", "yes", "ja", "TRUE", "y"]) expect(readBoolean(yes)).toBe(true)
			for (const no of ["0", "no", "nein", "false", ""]) expect(readBoolean(no)).toBe(false)
			expect(readBoolean("maybe")).toBeNull()
		})

		it("treats WooCommerce's third backorder state as allowed", () => {
			// "notify" means orderable, with a warning — not refused.
			expect(readBackorders("notify")).toBe(true)
			expect(readBackorders("0")).toBe(false)
		})

		it("reads publish state", () => {
			expect(readStatus("1")).toBe("PUBLISHED")
			expect(readStatus("publish")).toBe("PUBLISHED")
			expect(readStatus("0")).toBe("DRAFT")
			expect(readStatus("-1")).toBe("ARCHIVED")
			expect(readStatus("")).toBeNull()
		})

		it("reads catalogue visibility", () => {
			expect(readVisibility("visible")).toBe("SHOP_AND_SEARCH")
			expect(readVisibility("hidden")).toBe("HIDDEN")
			expect(readVisibility("catalog")).toBe("SHOP_ONLY")
			expect(readVisibility("nonsense")).toBeNull()
		})
	})

	describe("readCategoryPaths", () => {
		it("splits a comma list and a > hierarchy", () => {
			expect(
				readCategoryPaths("Ausstechformen individuell, Ausstechformen individuell > Edelstahl individuell")
			).toEqual([
				["Ausstechformen individuell"],
				["Ausstechformen individuell", "Edelstahl individuell"],
			])
		})

		it("trims around the separator", () => {
			expect(readCategoryPaths("A>B")).toEqual([["A", "B"]])
			expect(readCategoryPaths(" A > B ")).toEqual([["A", "B"]])
		})

		it("ignores an empty cell", () => {
			expect(readCategoryPaths("")).toEqual([])
		})
	})

	describe("readImageUrls", () => {
		it("keeps absolute http(s) URLs only", () => {
			expect(
				readImageUrls("https://example.com/a.jpg, http://example.com/b.png, /local/c.jpg, data:x")
			).toEqual(["https://example.com/a.jpg", "http://example.com/b.png"])
		})
	})
})
