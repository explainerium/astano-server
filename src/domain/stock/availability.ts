/**
 * When a variant counts as sellable.
 *
 * The threshold used to be the literal `0` written into every stock comparison
 * in the shop — the product view, the listing filter, the cart guards, the
 * bundle guard and the order guard. Once the admin can move it, those five have
 * to move together: a product that reads "out of stock" but still adds to the
 * cart is worse than either behaviour on its own.
 *
 * `outOfStockThreshold` is the floor stock may not be sold below, so the amount
 * actually available is `stock - threshold`. At the default of 0 every rule
 * here reduces to what was hardcoded before.
 */

export interface StockRules {
	/** Stock at or below this counts as sold out. WooCommerce's "out of stock threshold". */
	outOfStockThreshold: number
	/** Default low-stock trigger for variants that do not set their own. */
	lowThreshold: number
}

export const DEFAULT_STOCK_RULES: StockRules = { outOfStockThreshold: 0, lowThreshold: 2 }

/** The subset of a variant these rules look at. */
export interface StockState {
	manageStock: boolean
	stock: number
	allowBackorder: boolean
	/** Per-variant override; falls back to the shop-wide setting. */
	lowStockThreshold?: number | null
}

const asCount = (value: unknown, fallback: number): number => {
	const n = typeof value === "number" ? value : Number(value)
	// A negative floor would let stock be sold past zero, which no setting
	// should be able to express by accident.
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

export const readStockRules = (settings: Record<string, unknown>): StockRules => ({
	outOfStockThreshold: asCount(
		settings["stock.outOfStockThreshold"],
		DEFAULT_STOCK_RULES.outOfStockThreshold
	),
	lowThreshold: asCount(settings["stock.lowThreshold"], DEFAULT_STOCK_RULES.lowThreshold),
})

/** How many may still be sold. Untracked stock is unlimited, not zero. */
export const availableOf = (v: StockState, rules: StockRules): number | null =>
	v.manageStock ? Math.max(0, v.stock - rules.outOfStockThreshold) : null

/** Whether anything at all can be bought — backorders count as available. */
export const isInStock = (v: StockState, rules: StockRules): boolean =>
	!v.manageStock || v.allowBackorder || v.stock > rules.outOfStockThreshold

/** Whether a specific quantity can be bought right now. */
export const canTake = (v: StockState, quantity: number, rules: StockRules): boolean =>
	!v.manageStock || v.allowBackorder || quantity <= (availableOf(v, rules) ?? quantity)

/**
 * Whether a variant has fallen to its low-stock mark.
 *
 * Only meaningful for tracked stock, and never for something already sold out —
 * that is a different message, and sending both for the same variant would
 * announce the same event twice.
 */
export const isLow = (v: StockState, rules: StockRules): boolean => {
	if (!v.manageStock) return false

	const mark = v.lowStockThreshold ?? rules.lowThreshold
	const available = availableOf(v, rules) ?? 0

	return available > 0 && available <= mark
}
