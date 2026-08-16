/**
 * What happens to a guest's basket when they sign in.
 *
 * Filling a basket and then signing in must not lose the basket, and the naive
 * version of that — copy each line across — lost rather more than nothing:
 * option lines arrived detached from the product they configured, and every
 * attached drawing was dropped on the floor. Neither is visible at the moment
 * it happens. A customer notices when production asks what shape it is meant
 * to be.
 *
 * The rule lives here, once, because the cart and the inquiry basket both need
 * it and writing it twice is precisely how the invoice ended up printing every
 * option under every product. Pure — no Prisma, no ids invented, no writes
 * decided. It reads two lists and returns a plan.
 */

export interface MergeableLine {
	id: string
	variantId: string
	quantity: number
	/// How many drawings are attached. Any at all makes this its own line.
	fileCount: number
	/// Carts nest options under a parent line; an inquiry-basket line never has one.
	parentItemId?: string | null
}

export interface MergePlan<T> {
	/// Existing lines that simply take more quantity.
	increments: { targetId: string; quantity: number }[]
	/**
	 * Lines to recreate on the other side, **parents before their options**.
	 *
	 * `parentSourceId` names the *incoming* parent, which the caller maps to the
	 * id it just created — this function invents no ids because it writes
	 * nothing.
	 */
	copies: { source: T; parentSourceId: string | null }[]
}

/**
 * Whether a line is a configuration rather than a plain quantity of something.
 *
 * Two things make it one: a drawing, and options hanging off it. Folding either
 * into an existing line silently picks one of two drawings, or strands the
 * options of whichever line lost.
 */
const isConfigured = (line: MergeableLine, incoming: readonly MergeableLine[]): boolean =>
	line.fileCount > 0 || incoming.some((other) => other.parentItemId === line.id)

export const planMerge = <T extends MergeableLine>(
	incoming: readonly T[],
	existing: readonly MergeableLine[]
): MergePlan<T> => {
	const plan: MergePlan<T> = { increments: [], copies: [] }

	/// Which incoming lines were copied rather than merged away — an option can
	/// only be attached to a parent that actually crossed over.
	const copied = new Set<string>()

	for (const line of incoming.filter((l) => !l.parentItemId)) {
		const target = isConfigured(line, incoming)
			? undefined
			: existing.find(
					(other) =>
						other.variantId === line.variantId && !other.parentItemId && other.fileCount === 0
				)

		if (target) {
			plan.increments.push({ targetId: target.id, quantity: line.quantity })
			continue
		}

		plan.copies.push({ source: line, parentSourceId: null })
		copied.add(line.id)
	}

	for (const line of incoming.filter((l) => l.parentItemId)) {
		/*
		 * An option whose parent merged away has nowhere to hang.
		 *
		 * `isConfigured` is what stops that arising — a line with options never
		 * merges — so this is a guard rather than a path. Dropping it beats
		 * promoting it: an engraving listed as a product the customer bought is a
		 * worse answer than one that is not listed at all.
		 */
		if (!copied.has(line.parentItemId!)) continue

		plan.copies.push({ source: line, parentSourceId: line.parentItemId! })
	}

	return plan
}
