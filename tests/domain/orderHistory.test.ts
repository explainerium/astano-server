import { describe, expect, it } from "vitest"
import { previousOrdersWhere } from "../../src/domain/payment/orderHistory"

/**
 * Asserted rather than left to a comment, because the obvious change is the
 * wrong one.
 *
 * Counting COMPLETED orders reads like the careful choice and was what this did
 * first. Nothing sets that status automatically — a person opens the order and
 * changes it — so on a shop where nobody does, the rule it feeds can never be
 * satisfied and payment by invoice is offered to no one, silently. The client
 * said plainly they would forget. Anyone tempted to tighten this back up should
 * fail this test and go read why.
 */
describe("previous orders", () => {
	it("counts an order from the moment it is placed", () => {
		expect(previousOrdersWhere("u1")).toEqual({
			userId: "u1",
			status: { notIn: ["CANCELLED", "FAILED"] },
		})
	})

	it("does not filter on payment or fulfilment status", () => {
		const where = previousOrdersWhere("u1") as Record<string, unknown>

		expect(where.paymentStatus).toBeUndefined()
		expect(where.paidAt).toBeUndefined()
	})

	it("leaves out the two that are not a customer having ordered before", () => {
		const status = previousOrdersWhere("u1").status as { notIn: string[] }

		// Withdrawn, and never happened. Everything else — pending, on hold,
		// processing, completed, even refunded — was a real order.
		expect(status.notIn).toContain("CANCELLED")
		expect(status.notIn).toContain("FAILED")
		expect(status.notIn).not.toContain("PENDING")
		expect(status.notIn).not.toContain("PROCESSING")
	})
})
