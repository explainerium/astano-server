import { describe, expect, it } from "vitest"
import { ProductValidation } from "../../src/app/modules/product/product.validation"

/**
 * Regression test for a genuinely destructive bug.
 *
 * The update schema was derived with `productBody.partial()`. Zod's `.partial()`
 * makes a field optional but does NOT strip its `.default()`, so a PATCH
 * carrying only `{ moq: 1000 }` was validated into a body that also said
 * `status: "DRAFT"`, `prices: []`, `tiers: []`, `options: []` and
 * `categoryIds: []`.
 *
 * The service applies any key that is present, and treats an empty array as
 * "replace the collection with nothing" — so changing a product's minimum order
 * quantity unpublished it and deleted its prices, tier ladder, options and
 * category links.
 *
 * The rule this test defends: a partial update must never carry a field the
 * caller did not send.
 */
describe("updateProductSchema — partial updates must not inject defaults", () => {
	const parseBody = (body: unknown) =>
		ProductValidation.updateProductSchema.parse({
			params: { id: "00000000-0000-4000-8000-000000000000" },
			body,
			query: {},
		}).body as Record<string, unknown>

	it("returns ONLY the field that was sent", () => {
		expect(parseBody({ moq: 1000 })).toEqual({ moq: 1000 })
	})

	it("never invents a status — the killer, because DRAFT unpublishes the product", () => {
		expect(parseBody({ moq: 1000 })).not.toHaveProperty("status")
		expect(parseBody({ sortOrder: 3 })).not.toHaveProperty("status")
	})

	it("never invents empty collections that would wipe data", () => {
		const body = parseBody({ moq: 1000 })
		for (const key of ["prices", "tiers", "options", "categoryIds", "assetIds", "variants", "translations"]) {
			expect(body).not.toHaveProperty(key)
		}
	})

	it("never invents visibility, kind or quoteEnabled", () => {
		const body = parseBody({ moq: 1000 })
		expect(body).not.toHaveProperty("visibility")
		expect(body).not.toHaveProperty("kind")
		expect(body).not.toHaveProperty("quoteEnabled")
	})

	it("still passes through everything that WAS sent", () => {
		const body = parseBody({
			status: "PUBLISHED",
			visibility: "HIDDEN",
			quoteEnabled: true,
			moq: 50,
		})
		expect(body).toEqual({
			status: "PUBLISHED",
			visibility: "HIDDEN",
			quoteEnabled: true,
			moq: 50,
		})
	})

	it("distinguishes an explicitly empty array from an omitted one", () => {
		// Sending [] is a deliberate "remove them all" and must survive.
		expect(parseBody({ categoryIds: [] })).toEqual({ categoryIds: [] })
	})

	it("keeps applying defaults on CREATE, where they belong", () => {
		const created = ProductValidation.createProductSchema.parse({
			body: {
				translations: [{ locale: "en", name: "New product" }],
				variants: [{ sku: "SKU-1" }],
			},
			params: {},
			query: {},
		}).body as Record<string, unknown>

		expect(created.status).toBe("DRAFT")
		expect(created.visibility).toBe("SHOP_AND_SEARCH")
		expect(created.kind).toBe("MAIN")
	})
})
