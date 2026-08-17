import { describe, expect, it } from "vitest"
import { acceptsLateArtwork } from "../../src/domain/order/artworkWindow"

/**
 * The client's rule is that print files may follow the order, so an order has
 * to be able to receive one afterwards. This is the fence around that: the one
 * deliberate hole in "an order freezes everything", kept as small as it can be.
 */

describe("acceptsLateArtwork", () => {
	it("takes files while the order is waiting to be paid", () => {
		expect(acceptsLateArtwork("PENDING")).toBe(true)
	})

	it("takes files while the order is being made", () => {
		expect(acceptsLateArtwork("PROCESSING")).toBe(true)
	})

	it("takes files while the order is on hold", () => {
		// The most likely order to be waiting on a drawing is the one paused
		// because nobody has sent it.
		expect(acceptsLateArtwork("ON_HOLD")).toBe(true)
	})

	it("refuses a completed order", () => {
		// Nothing changes about what was made, and the record of what production
		// was given would quietly be rewritten.
		expect(acceptsLateArtwork("COMPLETED")).toBe(false)
	})

	it("refuses a cancelled order", () => {
		expect(acceptsLateArtwork("CANCELLED")).toBe(false)
	})

	it("refuses a refunded order", () => {
		expect(acceptsLateArtwork("REFUNDED")).toBe(false)
	})

	it("refuses a failed order", () => {
		expect(acceptsLateArtwork("FAILED")).toBe(false)
	})
})
