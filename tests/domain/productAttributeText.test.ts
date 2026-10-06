import { describe, expect, it } from "vitest"
import { ProductValidation } from "../../src/app/modules/product/product.validation"

/**
 * An attribute on a product is either values from its list or text typed for
 * that product alone ("Abmessungen", 6 October). The schema decides which one
 * arrived, and refuses the combinations the service cannot store.
 */
describe("product attributes — list values or typed text", () => {
	const ATTRIBUTE = "11111111-1111-4111-8111-111111111111"
	const VALUE = "22222222-2222-4222-8222-222222222222"

	const parse = (attribute: Record<string, unknown>) =>
		ProductValidation.updateProductSchema.safeParse({
			params: { id: "00000000-0000-4000-8000-000000000000" },
			body: { attributes: [{ attributeId: ATTRIBUTE, ...attribute }] },
			query: {},
		})

	it("takes values from the list, as before", () => {
		expect(parse({ attributeValueIds: [VALUE] }).success).toBe(true)
	})

	it("takes typed text with no list values", () => {
		const result = parse({ text: [{ locale: "de", value: "120 x 80 x 15 mm" }] })
		expect(result.success).toBe(true)
	})

	it("refuses an attribute with neither", () => {
		expect(parse({}).success).toBe(false)
		expect(parse({ attributeValueIds: [] }).success).toBe(false)
	})

	it("refuses text that is only blank", () => {
		expect(parse({ text: [{ locale: "de", value: "   " }] }).success).toBe(false)
	})

	it("refuses typed text as a variant axis — variants need a shared value", () => {
		expect(parse({ text: [{ locale: "de", value: "Rot" }], isVariation: true }).success).toBe(false)
	})
})
