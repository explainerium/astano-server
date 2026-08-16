import type { StockRules } from "./availability"

/**
 * What it takes to reserve stock for a line without overselling it.
 *
 * `canTake` answers "is there enough right now", which is the question a cart
 * asks. It is not the question a checkout asks, because between reading the
 * answer and acting on it somebody else can take the last one. Under READ
 * COMMITTED two checkouts for a single remaining unit both pass that read, both
 * decrement, and the variant lands at -1 with two customers promised the same
 * item.
 *
 * So the floor has to travel *with* the write, as a condition the database
 * evaluates while the row is locked. This decides what that floor is; the
 * service turns it into a `where`. Pure, and shared by checkout and by quote
 * acceptance — two ways of placing an order, one rule about stock.
 */

export interface StockState {
	manageStock: boolean
	allowBackorder: boolean
}

export type Reservation =
	/// Untracked stock is unlimited. Nothing is decremented at all.
	| { kind: "untracked" }
	/// A backorder is the deliberate decision to sell past zero, so it has no
	/// floor — but the count still moves, because the shop needs to know how far
	/// past zero it has gone.
	| { kind: "unguarded" }
	/// Decrement only while at least this much is on hand.
	| { kind: "guarded"; minimumStock: number }

export const reservationFor = (
	variant: StockState,
	quantity: number,
	rules: StockRules
): Reservation => {
	if (!variant.manageStock) return { kind: "untracked" }
	if (variant.allowBackorder) return { kind: "unguarded" }

	/*
	 * The threshold is a floor stock may not be sold *below*, not a display
	 * rule — so clearing zero is not enough. A shop holding back five of
	 * everything for the showroom means an order of ten needs fifteen.
	 */
	return { kind: "guarded", minimumStock: quantity + rules.outOfStockThreshold }
}
