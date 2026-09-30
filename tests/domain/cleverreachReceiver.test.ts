import { describe, expect, it } from "vitest"
import { toReceiver, type SubscriberRow } from "../../src/domain/newsletter/cleverreachReceiver"

const base: SubscriberRow = {
	email: "a@example.com",
	status: "CONFIRMED",
	locale: "de",
	source: "footer",
	createdAt: new Date("2026-09-01T10:00:00Z"),
	confirmedAt: new Date("2026-09-01T10:05:00Z"),
	unsubscribedAt: null,
}

describe("toReceiver", () => {
	it("sends a confirmed subscriber as active, stamped with our opt-in", () => {
		expect(toReceiver(base)).toEqual({
			email: "a@example.com",
			registered: 1788256800,
			activated: 1788257100,
			deactivated: 0,
			source: "astano Shop (footer)",
			tags: ["astano-shop", "lang-de"],
		})
	})

	it("never sends an address that has not confirmed", () => {
		expect(toReceiver({ ...base, status: "PENDING", confirmedAt: null })).toBeNull()
	})

	it("sends an unsubscribe as deactivated", () => {
		const left = toReceiver({
			...base,
			status: "UNSUBSCRIBED",
			unsubscribedAt: new Date("2026-09-20T00:00:00Z"),
		})
		expect(left?.deactivated).toBe(1789862400)
	})

	it("drops an unsubscribe that never confirmed", () => {
		expect(toReceiver({ ...base, status: "UNSUBSCRIBED", confirmedAt: null })).toBeNull()
	})
})
