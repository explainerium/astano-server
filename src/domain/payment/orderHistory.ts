import type { Prisma } from "@prisma/client"

/**
 * What counts as one of a customer's previous orders.
 *
 * Used by `minCompletedOrders`, which is how "returning customers only" is
 * expressed — the rule behind offering payment by invoice from a customer's
 * second order onwards.
 *
 * It used to count only orders marked COMPLETED. Nothing sets that status
 * automatically: a member of staff opens the order and changes it by hand once
 * the goods have gone. The client's answer to that was direct — "we will forget
 * to mark it as finished" — and they were right to worry. Every order on the
 * live shop was PENDING or PROCESSING, so the rule was unreachable: invoice
 * payment would never have been offered to anybody, and the setting would have
 * looked broken rather than strict.
 *
 * Marking the payment received is no better, because it is the same manual step
 * under a different name; the shop takes bank transfers, and somebody has to
 * read a statement either way.
 *
 * So an order counts once it has been *placed*. The trade is real and was put
 * to the client: a first order can be abandoned unpaid and still unlock invoice
 * payment for the second. They accepted it knowingly — every order passes
 * through their own system before anything is made — and the maximum order
 * value on the method caps what that could cost.
 *
 * Cancelled and failed orders are excluded. Those are not a customer having
 * ordered before; a cancelled order is one that was withdrawn, and a failed one
 * never happened.
 */
export const previousOrdersWhere = (userId: string): Prisma.OrderWhereInput => ({
	userId,
	status: { notIn: ["CANCELLED", "FAILED"] },
})
