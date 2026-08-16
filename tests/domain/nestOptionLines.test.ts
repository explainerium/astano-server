import { describe, expect, it } from "vitest"
import { nestOptionLines } from "../../src/domain/order/nestOptionLines"

/**
 * The bug this file exists for: the invoice matched option lines on "has a
 * parent" rather than "has *this* parent", so every option printed under every
 * product. A two-product order with three options each rendered twelve option
 * rows and no column added up — on a legal document.
 */

const line = (id: string, parentItemId: string | null = null) => ({ id, parentItemId })

describe("nestOptionLines", () => {
	it("keeps top-level lines in their original order", () => {
		const nested = nestOptionLines([line("a"), line("b"), line("c")])
		expect(nested.map((n) => n.line.id)).toEqual(["a", "b", "c"])
	})

	it("gives each line only its OWN options", () => {
		const nested = nestOptionLines([
			line("cutter"),
			line("box"),
			line("engraving", "cutter"),
			line("polybag", "box"),
		])

		expect(nested).toHaveLength(2)
		expect(nested[0]?.options.map((o) => o.id)).toEqual(["engraving"])
		expect(nested[1]?.options.map((o) => o.id)).toEqual(["polybag"])
	})

	it("does not repeat one order's options under every product", () => {
		const nested = nestOptionLines([
			line("cutter"),
			line("straw"),
			line("engraving", "cutter"),
			line("coating", "cutter"),
			line("brush", "straw"),
		])

		// Five rows in, five rows out — two products and three options, each
		// appearing exactly once.
		const rendered = nested.flatMap((n) => [n.line, ...n.options])
		expect(rendered).toHaveLength(5)
		expect(new Set(rendered.map((r) => r.id)).size).toBe(5)
	})

	it("preserves the order options were stored in", () => {
		const nested = nestOptionLines([
			line("cutter"),
			line("second", "cutter"),
			line("first", "cutter"),
		])
		expect(nested[0]?.options.map((o) => o.id)).toEqual(["second", "first"])
	})

	it("returns an empty option list rather than undefined", () => {
		expect(nestOptionLines([line("a")])[0]?.options).toEqual([])
	})

	it("drops an option whose parent is not in the list", () => {
		// Never promoted to a top-level line: showing it as something the customer
		// bought is a worse answer than leaving it out.
		const nested = nestOptionLines([line("cutter"), line("stray", "somewhere-else")])
		expect(nested.map((n) => n.line.id)).toEqual(["cutter"])
		expect(nested[0]?.options).toEqual([])
	})

	it("handles an order with nothing in it", () => {
		expect(nestOptionLines([])).toEqual([])
	})
})
