import { describe, expect, it } from "vitest"
import { effectiveRole } from "../../src/domain/pricing/effectiveRole"

/**
 * Business rule R5b. This is the guard against selling at dealer rates to
 * someone who has merely *applied* to be a dealer.
 */
describe("effectiveRole (R5b)", () => {
	it("treats an anonymous visitor as GUEST", () => {
		expect(effectiveRole(null, null)).toBe("GUEST")
		expect(effectiveRole(undefined, undefined)).toBe("GUEST")
	})

	it("gives an approved Reseller wholesale pricing", () => {
		expect(effectiveRole("RESELLER", "ACTIVE")).toBe("RESELLER")
	})

	it("prices a PENDING Reseller as GUEST, never as B2C", () => {
		expect(effectiveRole("RESELLER", "PENDING")).toBe("GUEST")
	})

	it("prices a REJECTED Reseller as GUEST", () => {
		expect(effectiveRole("RESELLER", "REJECTED")).toBe("GUEST")
	})

	it("prices an active retail customer as B2C", () => {
		expect(effectiveRole("B2C", "ACTIVE")).toBe("B2C")
	})

	it("prices a non-active retail customer as GUEST", () => {
		expect(effectiveRole("B2C", "PENDING")).toBe("GUEST")
		expect(effectiveRole("B2C", "REJECTED")).toBe("GUEST")
	})

	it("gives staff ordinary retail prices, not wholesale", () => {
		expect(effectiveRole("ADMIN", "ACTIVE")).toBe("B2C")
		expect(effectiveRole("SHOP_MANAGER", "ACTIVE")).toBe("B2C")
	})

	it("never returns a staff role — pricing only knows GUEST, B2C, RESELLER", () => {
		const roles = ["GUEST", "B2C", "RESELLER", "SHOP_MANAGER", "ADMIN"] as const
		const statuses = ["ACTIVE", "PENDING", "REJECTED"] as const

		for (const role of roles) {
			for (const status of statuses) {
				expect(["GUEST", "B2C", "RESELLER"]).toContain(effectiveRole(role, status))
			}
		}
	})
})
