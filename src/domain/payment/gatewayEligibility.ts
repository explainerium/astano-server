import Decimal from "decimal.js"

/**
 * Which payment methods a given customer may use.
 *
 * The old shop enforced "invoice only for logged-in DE/AT customers with at
 * least one completed order" inside a code snippet nobody could find. Here the
 * rule is data an admin enters, and this function only evaluates it — so the
 * client can change who gets invoice payment without a deploy, and anyone
 * debugging "why can't this customer see bank transfer?" reads a row rather
 * than hunting for a hook.
 *
 * Pure: no database, no request, no clock.
 */

export type Numeric = Decimal | string | number

export interface PaymentMethodRules {
	id: string
	code: string
	isActive: boolean
	sortOrder: number
	allowedCountries: string[]
	allowedRoles: string[]
	requiresLogin: boolean
	minCompletedOrders: number
	/**
	 * Roles `minCompletedOrders` is waived for. Empty means it applies to all.
	 *
	 * See the column's own note in payment.prisma for why this is an exemption
	 * rather than a second threshold.
	 */
	historyExemptRoles?: string[]
	minOrderTotal?: Numeric | null
	maxOrderTotal?: Numeric | null
	/**
	 * Above this the method stays available, but the customer is told it comes
	 * with conditions. Null means nothing is ever conditional.
	 *
	 * Distinct from `maxOrderTotal`, which refuses. The two answer different
	 * questions — "will you take this order at all" and "will you take it on
	 * these terms" — and the shop's answer to a €17,000 invoice order was yes to
	 * the first and "let us talk" to the second.
	 */
	conditionalAboveTotal?: Numeric | null
	requiresValidatedVatId: boolean
}

export interface PaymentContext {
	isLoggedIn: boolean
	role?: string | null
	billingCountry?: string | null
	completedOrders: number
	orderTotal: Numeric
	hasValidatedVatId: boolean
}

export type IneligibleReason =
	| "INACTIVE"
	| "REQUIRES_LOGIN"
	| "COUNTRY_NOT_ALLOWED"
	/**
	 * Restricted by country, and the destination is not known yet.
	 *
	 * Kept apart from COUNTRY_NOT_ALLOWED because the two mean opposite things
	 * to the person reading them. Before an address is typed, "not available in
	 * your country" is simply false — nobody has said which country it is — and
	 * telling a German customer their country is excluded, only for the option
	 * to appear once they finish typing, reads as a broken shop.
	 *
	 * Still ineligible, so nothing can be selected or ordered against it.
	 */
	| "AWAITING_COUNTRY"
	| "ROLE_NOT_ALLOWED"
	| "NOT_ENOUGH_ORDER_HISTORY"
	| "ORDER_TOTAL_TOO_LOW"
	| "ORDER_TOTAL_TOO_HIGH"
	| "REQUIRES_VALIDATED_VAT_ID"

export interface EligibilityResult {
	methodId: string
	code: string
	eligible: boolean
	reason?: IneligibleReason
	/**
	 * Available, but not unconditionally — the order is over the method's review
	 * threshold.
	 *
	 * Deliberately separate from `eligible`. A conditional method can still be
	 * chosen and ordered against; folding it into the refusal would have made
	 * every caller that checks `eligible` silently start refusing these orders,
	 * which is the outcome the whole change exists to undo.
	 */
	conditional?: boolean
}

export const evaluateMethod = (
	method: PaymentMethodRules,
	ctx: PaymentContext
): EligibilityResult => {
	const no = (reason: IneligibleReason): EligibilityResult => ({
		methodId: method.id,
		code: method.code,
		eligible: false,
		reason,
	})

	if (!method.isActive) return no("INACTIVE")

	if (method.requiresLogin && !ctx.isLoggedIn) return no("REQUIRES_LOGIN")

	// Empty list means no restriction, which is why it is the default.
	if (method.allowedCountries.length) {
		const country = ctx.billingCountry?.toUpperCase()

		// Not yet asked is not the same as not allowed. See AWAITING_COUNTRY.
		if (!country) return no("AWAITING_COUNTRY")

		if (!method.allowedCountries.map((c) => c.toUpperCase()).includes(country)) {
			return no("COUNTRY_NOT_ALLOWED")
		}
	}

	if (method.allowedRoles.length) {
		if (!ctx.role || !method.allowedRoles.includes(ctx.role)) return no("ROLE_NOT_ALLOWED")
	}

	/*
	 * Order history, unless this customer's role is excused it.
	 *
	 * The exemption is checked before the count rather than after, so an exempt
	 * role never has to have ordered at all — which is the whole point: an
	 * approved reseller is trusted by a decision somebody made, not by a number.
	 */
	const exempt = Boolean(ctx.role && method.historyExemptRoles?.includes(ctx.role))

	if (!exempt && method.minCompletedOrders > 0 && ctx.completedOrders < method.minCompletedOrders) {
		return no("NOT_ENOUGH_ORDER_HISTORY")
	}

	const total = new Decimal(ctx.orderTotal)

	if (method.minOrderTotal !== null && method.minOrderTotal !== undefined) {
		if (total.lessThan(new Decimal(method.minOrderTotal))) return no("ORDER_TOTAL_TOO_LOW")
	}

	if (method.maxOrderTotal !== null && method.maxOrderTotal !== undefined) {
		if (total.greaterThan(new Decimal(method.maxOrderTotal))) return no("ORDER_TOTAL_TOO_HIGH")
	}

	if (method.requiresValidatedVatId && !ctx.hasValidatedVatId) {
		return no("REQUIRES_VALIDATED_VAT_ID")
	}

	// Last, and only for a method that has passed everything else: an order
	// nobody is refusing, on terms the shop wants to agree first.
	const conditional =
		method.conditionalAboveTotal !== null &&
		method.conditionalAboveTotal !== undefined &&
		total.greaterThan(new Decimal(method.conditionalAboveTotal))

	return {
		methodId: method.id,
		code: method.code,
		eligible: true,
		...(conditional ? { conditional: true } : {}),
	}
}

export const evaluateMethods = (
	methods: PaymentMethodRules[],
	ctx: PaymentContext
): EligibilityResult[] =>
	methods
		.slice()
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((m) => evaluateMethod(m, ctx))
