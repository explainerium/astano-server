import { describe, expect, it } from "vitest"
import { ProductValidation } from "../../src/app/modules/product/product.validation"

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

/**
 * The home page's strip is sent as an ordered list of ids, and the order in
 * that array *is* the order on the page — the service writes 1..N from it.
 *
 * So the two things worth defending are that the array survives the parse with
 * its order intact, and that nothing which is not an id can get into it. A
 * position field would be a second source of truth for the same fact and there
 * deliberately is not one.
 */
describe("setTopProductsSchema", () => {
	const parse = (body: unknown) =>
		ProductValidation.setTopProductsSchema.safeParse({ params: {}, body, query: {} })

	it("keeps the order it was given — that order is the page's order", () => {
		const productIds = [ID(3), ID(1), ID(2)]
		const result = parse({ productIds })

		expect(result.success).toBe(true)
		expect(result.success && result.data.body.productIds).toEqual(productIds)
	})

	/**
	 * An empty strip is a legitimate edit, not a malformed request.
	 *
	 * Removing the last product is the one change a screen that refused this
	 * could not make, and the storefront already renders the section empty
	 * rather than breaking on it.
	 */
	it("accepts an empty list, which clears the strip", () => {
		const result = parse({ productIds: [] })
		expect(result.success).toBe(true)
	})

	it("refuses anything that is not a product id", () => {
		expect(parse({ productIds: ["not-a-uuid"] }).success).toBe(false)
		expect(parse({ productIds: [123] }).success).toBe(false)
		expect(parse({ productIds: [{ id: ID(1), position: 1 }] }).success).toBe(false)
	})

	it("requires the list itself", () => {
		expect(parse({}).success).toBe(false)
		expect(parse({ productIds: ID(1) }).success).toBe(false)
	})
})

/**
 * `top` narrows the admin list to the strip, and only that way round.
 *
 * "Everything except the top products" is not a question anybody asks, and a
 * three-state filter would have to render a control saying so. The value is a
 * string because it arrives in a query string, where they all are.
 */
describe("adminListProductsSchema — the top filter", () => {
	const parse = (query: unknown) =>
		ProductValidation.adminListProductsSchema.safeParse({ params: {}, body: {}, query })

	it("accepts top=true", () => {
		const result = parse({ top: "true" })
		expect(result.success).toBe(true)
		expect(result.success && result.data.query.top).toBe("true")
	})

	it("leaves top absent when it was not asked for, rather than defaulting it", () => {
		const result = parse({})
		expect(result.success).toBe(true)
		expect(result.success && result.data.query.top).toBeUndefined()
	})

	it("refuses top=false, which would mean a list nobody wants", () => {
		expect(parse({ top: "false" }).success).toBe(false)
	})
})
