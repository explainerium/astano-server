import { describe, expect, it } from "vitest"
import {
	acceptsArtwork,
	checkArtwork,
	checkArtworkComplete,
	NO_ARTWORK,
	readArtworkRules,
	readInquiryArtworkRules,
	INQUIRY_ARTWORK_FALLBACK,
} from "../../src/domain/product/artwork"

/**
 * The drawing is the specification for a good part of this catalogue, so the
 * cases that matter are the ones where a line could reach production without
 * one, or where a customer is stopped from supplying one.
 */
describe("artwork rules", () => {
	describe("readArtworkRules", () => {
		it("reads a product that accepts files", () => {
			expect(readArtworkRules({ artworkMaxFiles: 6, artworkRequired: true })).toEqual({
				maxFiles: 6,
				required: true,
			})
		})

		it("treats zero, missing and nonsense as not offering artwork", () => {
			expect(readArtworkRules({ artworkMaxFiles: 0 })).toEqual(NO_ARTWORK)
			expect(readArtworkRules({})).toEqual(NO_ARTWORK)
			expect(readArtworkRules(null)).toEqual(NO_ARTWORK)
			expect(readArtworkRules({ artworkMaxFiles: -3 })).toEqual(NO_ARTWORK)
		})

		it("never reports required on a product that accepts nothing", () => {
			// Otherwise every order of it would be refused for a file it has no
			// way to take.
			const rules = readArtworkRules({ artworkMaxFiles: 0, artworkRequired: true })
			expect(rules.required).toBe(false)
			expect(acceptsArtwork(rules)).toBe(false)
		})
	})

	describe("checkArtwork", () => {
		const six = { maxFiles: 6, required: false }

		it("allows up to the limit", () => {
			expect(checkArtwork(six, 0)).toBeNull()
			expect(checkArtwork(six, 6)).toBeNull()
		})

		it("refuses more than the limit", () => {
			expect(checkArtwork(six, 7)).toEqual({ kind: "TOO_MANY", max: 6 })
		})

		it("refuses any file on a product that does not take them", () => {
			expect(checkArtwork(NO_ARTWORK, 1)).toEqual({ kind: "NOT_ACCEPTED" })
			// Nothing attached is fine either way.
			expect(checkArtwork(NO_ARTWORK, 0)).toBeNull()
		})

		it("counts the line's total, not the number being added", () => {
			// Six is six however many uploads it took to get there.
			expect(checkArtwork(six, 6)).toBeNull()
			expect(checkArtwork(six, 8)).toEqual({ kind: "TOO_MANY", max: 6 })
		})
	})

	describe("checkArtworkComplete", () => {
		const required = { maxFiles: 6, required: true }

		it("refuses an empty line at checkout when a file is required", () => {
			expect(checkArtworkComplete(required, 0)).toEqual({ kind: "REQUIRED" })
			expect(checkArtworkComplete(required, 1)).toBeNull()
		})

		it("still allows the empty line while shopping", () => {
			// A basket may sit half-specified while the customer finds the file;
			// refusing here would leave them nowhere to put it.
			expect(checkArtwork(required, 0)).toBeNull()
		})

		it("applies the limit as well", () => {
			expect(checkArtworkComplete(required, 9)).toEqual({ kind: "TOO_MANY", max: 6 })
		})

		it("says nothing about a product that does not take artwork", () => {
			expect(checkArtworkComplete(NO_ARTWORK, 0)).toBeNull()
		})
	})
})

/**
 * An enquiry is a question, and the answer usually depends on a picture.
 *
 * The shop's own catalogue is the reason this exists: every product in it has
 * `artworkMaxFiles` at 0, so the enquiry basket would take a drawing from
 * nobody — the client reported the upload as missing and it was, everywhere.
 */
describe("readInquiryArtworkRules", () => {
	it("lets an enquiry carry files for a product that asks for none", () => {
		const rules = readInquiryArtworkRules({ artworkMaxFiles: 0, artworkRequired: false })

		expect(rules.maxFiles).toBe(INQUIRY_ARTWORK_FALLBACK)
		expect(rules.required).toBe(false)
	})

	it("does the same when the product says nothing at all", () => {
		expect(readInquiryArtworkRules(null).maxFiles).toBe(INQUIRY_ARTWORK_FALLBACK)
		expect(readInquiryArtworkRules(undefined).maxFiles).toBe(INQUIRY_ARTWORK_FALLBACK)
	})

	/**
	 * A product the shop has configured keeps its own answer. The fallback is
	 * for the silent case only — it must never widen a limit somebody set.
	 */
	it("defers to the product's own allowance where there is one", () => {
		const rules = readInquiryArtworkRules({ artworkMaxFiles: 2, artworkRequired: true })

		expect(rules.maxFiles).toBe(2)
		expect(rules.required).toBe(true)
	})

	it("never starts requiring a drawing the product did not require", () => {
		expect(readInquiryArtworkRules({ artworkMaxFiles: 0, artworkRequired: true }).required).toBe(
			false
		)
	})
})
