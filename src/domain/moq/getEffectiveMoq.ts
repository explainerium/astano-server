/**
 * Minimum order quantity — business rules R3 and R4.
 *
 *   R3  One value per product, identical for every customer type and every
 *       language, overridable per variant.
 *   R4  Below the minimum: REJECT on add, RAISE (with an explanatory notice)
 *       on update, BLOCK on quote submission.
 *
 * Pure functions. Every path that can put a line into a cart, a bundle or a
 * quote goes through these — the old site enforced MOQ in an HTTP hook, which
 * is exactly why configurator lines bypassed it (spec risk #17).
 */

export interface MoqSource {
	/// Product-level minimum. 0 means no minimum.
	productMoq: number | null | undefined
	/// Variant override. Null or undefined means inherit from the product.
	variantMoq?: number | null | undefined
}

/** The minimum that actually applies. 0 means "no minimum". */
export const getEffectiveMoq = ({ productMoq, variantMoq }: MoqSource): number => {
	// A variant override of 0 is meaningful — it disables the minimum for that
	// variant — so only null/undefined counts as "inherit".
	const raw = variantMoq ?? productMoq ?? 0
	return raw > 0 ? Math.floor(raw) : 0
}

/** True when `quantity` is below the applicable minimum. */
export const isBelowMoq = (quantity: number, moq: number): boolean =>
	moq > 0 && quantity < moq

/**
 * R4 "raise" behaviour — used when updating a cart or quote line, where the
 * kind thing is to correct the number and tell the customer.
 */
export const applyMoqFloor = (
	quantity: number,
	moq: number
): { quantity: number; adjusted: boolean } => {
	const requested = Math.max(1, Math.floor(quantity))

	if (moq > 0 && requested < moq) {
		return { quantity: moq, adjusted: true }
	}

	return { quantity: requested, adjusted: false }
}
