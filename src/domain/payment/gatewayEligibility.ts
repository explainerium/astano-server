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
	minOrderTotal?: Numeric | null
	maxOrderTotal?: Numeric | null
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
		if (!country || !method.allowedCountries.map((c) => c.toUpperCase()).includes(country)) {
			return no("COUNTRY_NOT_ALLOWED")
		}
	}

	if (method.allowedRoles.length) {
		if (!ctx.role || !method.allowedRoles.includes(ctx.role)) return no("ROLE_NOT_ALLOWED")
	}

	if (method.minCompletedOrders > 0 && ctx.completedOrders < method.minCompletedOrders) {
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

	return { methodId: method.id, code: method.code, eligible: true }
}

export const evaluateMethods = (
	methods: PaymentMethodRules[],
	ctx: PaymentContext
): EligibilityResult[] =>
	methods
		.slice()
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((m) => evaluateMethod(m, ctx))
