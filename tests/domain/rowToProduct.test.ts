import { describe, expect, it } from "vitest"
import {
	DEFAULT_IMPORT_OPTIONS,
	parseRow,
	type ColumnMapping,
} from "../../src/domain/product/rowToProduct"

const HEADERS = [
	"Artikelnummer",
	"Name",
	"Beschreibung",
	"Veröffentlicht",
	"Regulärer Preis",
	"Angebotspreis",
	"Reseller Base Price",
	"Bestand",
	"Gewicht (kg)",
	"Kategorien",
	"Bilder",
	"Attribut 1 Name",
	"Attribut 1 Wert(e)",
	"Attribut 2 Name",
	"Attribut 2 Wert(e)",
]

const MAPPING: ColumnMapping = {
	Artikelnummer: "sku",
	Name: "name",
	Beschreibung: "description",
	Veröffentlicht: "status",
	"Regulärer Preis": "priceB2C",
	Angebotspreis: "salePriceB2C",
	"Reseller Base Price": "priceReseller",
	Bestand: "stock",
	"Gewicht (kg)": "weightKg",
	Kategorien: "categories",
	Bilder: "images",
}

const row = (over: Record<string, string> = {}) =>
	parseRow(
		{ Name: "Thing", Artikelnummer: "SKU-1", ...over },
		MAPPING,
		HEADERS,
		{ ...DEFAULT_IMPORT_OPTIONS, ...(over.__options ? JSON.parse(over.__options) : {}) }
	)

describe("parseRow", () => {
	it("reads the ordinary fields", () => {
		const parsed = row({
			Name: "Edelstahl Eiswürfel",
			Artikelnummer: "1-FSI1-L",
			"Regulärer Preis": "1.69",
			Bestand: "28800",
			"Gewicht (kg)": "0.027",
		})

		expect(parsed.name).toBe("Edelstahl Eiswürfel")
		expect(parsed.sku).toBe("1-FSI1-L")
		expect(parsed.stock).toBe(28800)
		expect(parsed.weightKg).toBe("0.027")
		expect(parsed.issues).toEqual([])
	})

	describe("prices", () => {
		it("keeps retail and dealer apart", () => {
			const parsed = row({ "Regulärer Preis": "1.69", "Reseller Base Price": "1.18" })

			expect(parsed.prices).toEqual([
				{ role: "B2C", basePrice: "1.69", salePrice: null },
				{ role: "RESELLER", basePrice: "1.18", salePrice: null },
			])
		})

		it("attaches a sale price to its own role", () => {
			const parsed = row({ "Regulärer Preis": "10", Angebotspreis: "8" })
			expect(parsed.prices[0]).toEqual({ role: "B2C", basePrice: "10", salePrice: "8" })
		})

		it("reports a sale price with nothing to discount", () => {
			// Silently dropping it would leave the admin hunting for a price they
			// know they exported.
			const parsed = row({ Angebotspreis: "8" })
			expect(parsed.prices).toHaveLength(0)
			expect(parsed.issues.join(" ")).toContain("no regular price")
		})
	})

	describe("quote-only", () => {
		it("treats a blank price as price-on-request", () => {
			// 27 of the shop's 55 products are exactly this. Importing them as
			// free would be the worst possible reading.
			const parsed = row({})
			expect(parsed.quoteEnabled).toBe(true)
			expect(parsed.prices).toHaveLength(0)
		})

		it("leaves a priced row buyable", () => {
			expect(row({ "Regulärer Preis": "1.69" }).quoteEnabled).toBe(false)
		})

		it("can be switched off", () => {
			const parsed = parseRow({ Name: "x" }, MAPPING, HEADERS, {
				...DEFAULT_IMPORT_OPTIONS,
				quoteWhenNoPrice: false,
			})
			expect(parsed.quoteEnabled).toBe(false)
		})
	})

	describe("stock", () => {
		it("distinguishes untracked from zero", () => {
			// An empty stock cell means the product is not counted, not that it is
			// sold out — importing it as 0 would take 39 products off sale.
			expect(row({ Bestand: "" }).stock).toBeNull()
			expect(row({ Bestand: "0" }).stock).toBe(0)
		})
	})

	describe("categories", () => {
		it("reads a comma list and a > hierarchy", () => {
			const parsed = row({ Kategorien: "A, A > B" })
			expect(parsed.categoryPaths).toEqual([["A"], ["A", "B"]])
		})
	})

	describe("attributes", () => {
		it("pairs the numbered columns", () => {
			const parsed = row({
				"Attribut 1 Name": "Material",
				"Attribut 1 Wert(e)": "Edelstahl 430\\, rostfrei",
				"Attribut 2 Name": "Farbe",
				"Attribut 2 Wert(e)": "Silber, Schwarz",
			})

			expect(parsed.attributes).toEqual([
				{ name: "Material", values: ["Edelstahl 430, rostfrei"] },
				{ name: "Farbe", values: ["Silber", "Schwarz"] },
			])
		})

		it("ignores a half-filled pair", () => {
			expect(row({ "Attribut 1 Name": "Material" }).attributes).toEqual([])
			expect(row({ "Attribut 1 Wert(e)": "Edelstahl" }).attributes).toEqual([])
		})
	})

	describe("images", () => {
		it("only reads them when downloading is on", () => {
			expect(row({ Bilder: "https://x.test/a.jpg" }).imageUrls).toEqual([])

			const parsed = parseRow({ Name: "x", Bilder: "https://x.test/a.jpg" }, MAPPING, HEADERS, {
				...DEFAULT_IMPORT_OPTIONS,
				downloadImages: true,
			})
			expect(parsed.imageUrls).toEqual(["https://x.test/a.jpg"])
		})
	})

	describe("issues", () => {
		it("complains about a missing name", () => {
			expect(row({ Name: "" }).issues.join(" ")).toContain("No name")
		})

		it("names the field it could not read, and carries on", () => {
			const parsed = row({ Bestand: "lots" })
			expect(parsed.stock).toBeNull()
			expect(parsed.issues.join(" ")).toContain("Stock")
			// The rest of the row still came through.
			expect(parsed.name).toBe("Thing")
		})

		it("stays quiet about an empty cell", () => {
			expect(row({ Bestand: "", "Gewicht (kg)": "" }).issues).toEqual([])
		})
	})

	it("ignores a column that was not mapped", () => {
		const parsed = parseRow({ Name: "x", Bestand: "5" }, { Name: "name" }, HEADERS, DEFAULT_IMPORT_OPTIONS)
		expect(parsed.stock).toBeNull()
	})
})
