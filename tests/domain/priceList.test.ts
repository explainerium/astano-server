import { describe, expect, it } from "vitest"
import {
	decodeCsvBuffer,
	germanNumber,
	parsePriceList,
	planLadders,
	PRICE_LISTS,
} from "../../src/domain/pricing/priceList"

/**
 * The ERP price list, read into ladders.
 *
 * The fixtures are the client's real shapes, measured from the 12,899-row
 * export in `data/erp/`: German decimals, two list names, and a dealer ladder
 * that starts at 50 on eight articles. See ERP-PLAN.md §9.
 */
const csv = (body: string) => `ARTIKELNR;PREISLISTE;MENGE;VKPREIS\n${body}`

describe("germanNumber", () => {
	it("reads a comma as the decimal point", () => {
		expect(germanNumber("0,44")?.toString()).toBe("0.44")
		expect(germanNumber("1,00")?.toString()).toBe("1")
	})

	it("reads a dot as the thousands separator, not a decimal point", () => {
		// parseFloat("1.234,50") is 1.234 — an article priced at €1,234 sold for €1.23.
		expect(germanNumber("1.234,50")?.toString()).toBe("1234.5")
	})

	it("still reads a plain number, and refuses anything else", () => {
		expect(germanNumber("50")?.toString()).toBe("50")
		expect(germanNumber("")).toBeNull()
		expect(germanNumber("auf Anfrage")).toBeNull()
	})
})

describe("decodeCsvBuffer", () => {
	it("keeps UTF-8 as it is", () => {
		const { text, encoding } = decodeCsvBuffer(Buffer.from("Händler", "utf8"))
		expect([text, encoding]).toEqual(["Händler", "utf-8"])
	})

	it("falls back to Windows-1252, which is what MeinBüro writes", () => {
		const { text, encoding } = decodeCsvBuffer(Buffer.from("Händler", "latin1"))
		expect([text, encoding]).toEqual(["Händler", "windows-1252"])
	})
})

describe("parsePriceList", () => {
	it("maps the two lists onto the roles that price for them", () => {
		expect(PRICE_LISTS.standard).toBe("GUEST")
		expect(PRICE_LISTS["händler"]).toBe("RESELLER")

		const parsed = parsePriceList(csv("1-ESH-1;Standard;1,00;0,44\n1-ESH-1;Händler;1,00;0,35"))

		expect(parsed.rows.map((r) => [r.sku, r.role, r.minQuantity, r.price?.toString()])).toEqual([
			["1-ESH-1", "GUEST", 1, "0.44"],
			["1-ESH-1", "RESELLER", 1, "0.35"],
		])
		expect(parsed.lists).toEqual([
			{ list: "Standard", rows: 1, role: "GUEST" },
			{ list: "Händler", rows: 1, role: "RESELLER" },
		])
	})

	it("names the row and the reason when a line cannot be read", () => {
		const parsed = parsePriceList(csv("1-ESH-1;Sonderliste;1,00;0,44\n;Standard;x;0,44"))

		expect(parsed.rows[0]?.issues).toEqual(["Price list “Sonderliste” is not one this shop prices for"])
		expect(parsed.rows[0]?.line).toBe(2)
		expect(parsed.rows[1]?.issues).toEqual(["No article number", "Quantity “x” is not a number"])
	})

	it("reports which header it read as what", () => {
		const parsed = parsePriceList(csv("1-ESH-1;Standard;1,00;0,44"))
		expect(parsed.columns).toEqual({
			sku: "ARTIKELNR",
			list: "PREISLISTE",
			quantity: "MENGE",
			price: "VKPREIS",
		})
	})
})

describe("planLadders", () => {
	const plan = (body: string) => planLadders(parsePriceList(csv(body)).rows)

	it("makes the quantity-one price the base and the rest rungs", () => {
		const [guest] = plan("1-ESH-1;Standard;1,00;0,44\n1-ESH-1;Standard;50,00;0,40\n1-ESH-1;Standard;250,00;0,36")

		expect(guest?.basePrice.toString()).toBe("0.44")
		expect(guest?.baseSource).toBe("own-list")
		expect(guest?.rungs.map((r) => [r.minQuantity, r.value.toString()])).toEqual([
			[50, "0.4"],
			[250, "0.36"],
		])
	})

	it("prices a dealer at the standard price below their minimum, keeping every dealer rung", () => {
		// Eight articles in the client's catalogue are exactly this shape.
		const plans = plan(
			"1-FSI1-L;Standard;1,00;2,59\n1-FSI1-L;Händler;50,00;2,20\n1-FSI1-L;Händler;500,00;1,95"
		)
		const dealer = plans.find((p) => p.role === "RESELLER")

		expect(dealer?.basePrice.toString()).toBe("2.59")
		expect(dealer?.baseSource).toBe("standard-below-minimum")
		expect(dealer?.rungs.map((r) => r.minQuantity)).toEqual([50, 500])
		expect(dealer?.issues).toEqual(["This list starts at 50, so below that the Standard price applies"])
	})

	it("says so when a ladder starts above one and there is no standard price to fall back on", () => {
		const [dealer] = plan("1-FSI1-L;Händler;50,00;2,20")

		expect(dealer?.basePrice.toString()).toBe("2.2")
		expect(dealer?.baseSource).toBe("own-lowest-rung")
		expect(dealer?.issues[0]).toContain("no Standard price")
	})

	it("keeps the first of two rungs at the same quantity and reports the second", () => {
		const [guest] = plan("1-ESH-1;Standard;1,00;0,44\n1-ESH-1;Standard;50,00;0,40\n1-ESH-1;Standard;50,00;0,39")

		expect(guest?.rungs.map((r) => [r.minQuantity, r.value.toString()])).toEqual([[50, "0.4"]])
		expect(guest?.issues).toEqual(["Quantity 50 appears more than once; line 4 was ignored"])
	})

	it("ignores rows it could not read rather than planning from half of them", () => {
		expect(plan("1-ESH-1;Sonderliste;1,00;0,44")).toEqual([])
		expect(plan(";Standard;1,00;0,44")).toEqual([])
	})

	it("plans each article and role separately", () => {
		const plans = plan(
			"1-ESH-1;Standard;1,00;0,44\n1-ESH-1;Händler;1,00;0,35\n1-ICEV-1;Standard;1,00;0,85"
		)

		expect(plans.map((p) => [p.sku, p.role, p.basePrice.toString()])).toEqual([
			["1-ESH-1", "GUEST", "0.44"],
			["1-ESH-1", "RESELLER", "0.35"],
			["1-ICEV-1", "GUEST", "0.85"],
		])
	})
})
