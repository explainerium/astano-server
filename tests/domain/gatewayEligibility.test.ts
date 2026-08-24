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

		/**
		 * The client's rule as it stands now: approved dealers from their first
		 * order, everyone else from their second.
		 *
		 * The role that reaches here has already been through `effectiveRole`, so
		 * "RESELLER" means an approved one — an account still waiting on a staff
		 * decision arrives as GUEST and never reaches this branch. That is the
		 * whole basis of the exemption: the trust an order history stands in for
		 * has already been given by a person.
		 */
		describe("dealers, exempt from the history", () => {
			const withExemption = { ...invoice, historyExemptRoles: ["RESELLER"] }

			it("offers it to an approved dealer on their very first order", () => {
				const dealer = { ...guest, isLoggedIn: true, role: "RESELLER", completedOrders: 0 }
				expect(evaluateMethod(withExemption, dealer).eligible).toBe(true)
			})

			it("still makes a retail customer wait for their second order", () => {
				const retail = { ...guest, isLoggedIn: true, role: "B2C", completedOrders: 0 }
				expect(evaluateMethod(withExemption, retail).reason).toBe("NOT_ENOUGH_ORDER_HISTORY")
			})

			/**
			 * An unapproved dealer reaches this function as a guest, because
			 * `effectiveRole` prices anything that is not ACTIVE as one. Asserted
			 * here so the exemption cannot quietly start trusting a stored role.
			 */
			it("does not exempt an account that has not been approved", () => {
				const pending = { ...guest, isLoggedIn: true, role: "GUEST", completedOrders: 0 }
				expect(evaluateMethod(withExemption, pending).reason).toBe("NOT_ENOUGH_ORDER_HISTORY")
			})

			it("exempts nobody when the list is empty", () => {
				const dealer = { ...guest, isLoggedIn: true, role: "RESELLER", completedOrders: 0 }
				expect(evaluateMethod(invoice, dealer).reason).toBe("NOT_ENOUGH_ORDER_HISTORY")
			})

			/**
			 * Exemption is from the history and from nothing else. A dealer over
			 * the invoice ceiling, or outside DE/AT, is refused like anyone else —
			 * the client's ceiling exists to bound their credit exposure, and a
			 * hole in it for the very customers who order most would defeat it.
			 */
			it("does not excuse the value ceiling or the country list", () => {
				const capped = { ...withExemption, maxOrderTotal: "10000" }
				const dealer = { ...guest, isLoggedIn: true, role: "RESELLER", completedOrders: 0 }

				expect(evaluateMethod(capped, { ...dealer, orderTotal: "10000.01" }).reason).toBe(
					"ORDER_TOTAL_TOO_HIGH"
				)
				expect(evaluateMethod(capped, { ...dealer, billingCountry: "FR" }).reason).toBe(
					"COUNTRY_NOT_ALLOWED"
				)
				expect(evaluateMethod(capped, { ...dealer, orderTotal: "10000" }).eligible).toBe(true)
			})
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

	/**
	 * Still rejected — only the reason differs, and the difference matters.
	 *
	 * "Not available in your country" said before anyone has entered an address
	 * is simply false, and the checkout prints these reasons to the customer. A
	 * German buyer told their country is excluded, only for the option to appear
	 * once they finish typing, has been shown a bug that is not there.
	 */
	it("holds a country-restricted method back until the country is known", () => {
		const german = { ...open, allowedCountries: ["DE"] }
		const verdict = evaluateMethod(german, { ...guest, billingCountry: null })

		expect(verdict.eligible).toBe(false)
		expect(verdict.reason).toBe("AWAITING_COUNTRY")
	})

	it("rejects outright once the country is known and excluded", () => {
		const german = { ...open, allowedCountries: ["DE"] }
		const verdict = evaluateMethod(german, { ...guest, billingCountry: "US" })

		expect(verdict.eligible).toBe(false)
		expect(verdict.reason).toBe("COUNTRY_NOT_ALLOWED")
	})
})
