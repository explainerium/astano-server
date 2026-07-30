import { describe, expect, it } from "vitest"
import {
	evaluateMethod,
	type PaymentContext,
	type PaymentMethodRules,
} from "../../src/domain/payment/gatewayEligibility"

const open: PaymentMethodRules = {
	id: "m1",
	code: "bank-transfer",
	isActive: true,
	sortOrder: 0,
	allowedCountries: [],
	allowedRoles: [],
	requiresLogin: false,
	minCompletedOrders: 0,
	requiresValidatedVatId: false,
}

const guest: PaymentContext = {
	isLoggedIn: false,
	role: null,
	billingCountry: "DE",
	completedOrders: 0,
	orderTotal: "100.00",
	hasValidatedVatId: false,
}

describe("gatewayEligibility", () => {
	it("offers an unrestricted method to anyone, including a guest", () => {
		expect(evaluateMethod(open, guest).eligible).toBe(true)
	})

	it("hides an inactive method", () => {
		expect(evaluateMethod({ ...open, isActive: false }, guest).reason).toBe("INACTIVE")
	})

	/**
	 * The rule the old shop hid in a code snippet: invoice payment for
	 * logged-in DE/AT customers with at least one completed order. Expressed
	 * here purely as admin-entered data.
	 */
	describe("the invoice rule, as data", () => {
		const invoice: PaymentMethodRules = {
			...open,
			code: "invoice",
			allowedCountries: ["DE", "AT"],
			requiresLogin: true,
			minCompletedOrders: 1,
		}

		it("hides it from a guest", () => {
			expect(evaluateMethod(invoice, guest).reason).toBe("REQUIRES_LOGIN")
		})

		it("hides it from a first-time customer", () => {
			const first = { ...guest, isLoggedIn: true, completedOrders: 0 }
			expect(evaluateMethod(invoice, first).reason).toBe("NOT_ENOUGH_ORDER_HISTORY")
		})

		it("hides it outside DE/AT", () => {
			const french = { ...guest, isLoggedIn: true, completedOrders: 5, billingCountry: "FR" }
			expect(evaluateMethod(invoice, french).reason).toBe("COUNTRY_NOT_ALLOWED")
		})

		it("offers it to a returning German customer", () => {
			const returning = { ...guest, isLoggedIn: true, completedOrders: 1, billingCountry: "DE" }
			expect(evaluateMethod(invoice, returning).eligible).toBe(true)
		})

		it("offers it to a returning Austrian customer", () => {
			const returning = { ...guest, isLoggedIn: true, completedOrders: 3, billingCountry: "AT" }
			expect(evaluateMethod(invoice, returning).eligible).toBe(true)
		})
	})

	it("restricts by role when the admin sets one", () => {
		const resellerOnly = { ...open, allowedRoles: ["RESELLER"] }
		expect(evaluateMethod(resellerOnly, { ...guest, isLoggedIn: true, role: "B2C" }).reason).toBe("ROLE_NOT_ALLOWED")
		expect(evaluateMethod(resellerOnly, { ...guest, isLoggedIn: true, role: "RESELLER" }).eligible).toBe(true)
	})

	it("honours order-value limits", () => {
		const capped = { ...open, minOrderTotal: "50", maxOrderTotal: "500" }
		expect(evaluateMethod(capped, { ...guest, orderTotal: "49.99" }).reason).toBe("ORDER_TOTAL_TOO_LOW")
		expect(evaluateMethod(capped, { ...guest, orderTotal: "500.01" }).reason).toBe("ORDER_TOTAL_TOO_HIGH")
		expect(evaluateMethod(capped, { ...guest, orderTotal: "500" }).eligible).toBe(true)
	})

	it("can require a validated VAT ID", () => {
		const vatOnly = { ...open, requiresValidatedVatId: true }
		expect(evaluateMethod(vatOnly, guest).reason).toBe("REQUIRES_VALIDATED_VAT_ID")
		expect(evaluateMethod(vatOnly, { ...guest, hasValidatedVatId: true }).eligible).toBe(true)
	})

	it("is case-insensitive about country codes", () => {
		const german = { ...open, allowedCountries: ["de"] }
		expect(evaluateMethod(german, { ...guest, billingCountry: "DE" }).eligible).toBe(true)
	})

	it("rejects when a country restriction exists but no country is known", () => {
		const german = { ...open, allowedCountries: ["DE"] }
		expect(evaluateMethod(german, { ...guest, billingCountry: null }).reason).toBe("COUNTRY_NOT_ALLOWED")
	})
})
