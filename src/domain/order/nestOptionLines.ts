/**
 * Putting an order's option lines under the lines they were bought with.
 *
 * A one-line rule that lived in three places — the customer's order view, the
 * invoice, and the confirmation email — and was wrong in one of them: the
 * invoice matched on "has a parent at all" rather than "has *this* parent", so
 * a two-product order with three options each printed twelve option rows and
 * no column added up. The rule is written once here now, because the reason it
 * was wrong is that it was written twice.
 *
 * Pure: no Prisma, no Express. It sees ids and parent ids and nothing else.
 */

export interface NestableLine {
	id: string
	parentItemId: string | null
}

export interface NestedLine<T> {
	line: T
	options: T[]
}

/**
 * Top-level lines in their original order, each carrying its own options.
 *
 * An option whose parent is not in the list is **dropped**, not promoted. A
 * parentless option is data that should not exist, and showing it as a product
 * the customer bought would be a worse answer than leaving it out — the totals
 * are frozen on the order either way.
 */
export const nestOptionLines = <T extends NestableLine>(items: readonly T[]): NestedLine<T>[] => {
	const byParent = new Map<string, T[]>()

	for (const item of items) {
		if (!item.parentItemId) continue
		byParent.set(item.parentItemId, [...(byParent.get(item.parentItemId) ?? []), item])
	}

	return items
		.filter((item) => !item.parentItemId)
		.map((line) => ({ line, options: byParent.get(line.id) ?? [] }))
}
