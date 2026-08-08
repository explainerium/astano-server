import { describe, expect, it } from "vitest"
import {
	bankAccountsSchema,
	hasBankAccounts,
	readBankAccounts,
} from "../../src/domain/payment/bankAccounts"

/**
 * Bank details end up on a thank-you page, in an email and on an invoice, and a
 * customer copies an IBAN out of them. A wrong one here is money sent to the
 * wrong account, so the guarantees are pinned.
 */
describe("bankAccounts", () => {
	const account = {
		accountName: "ASSCA GmbH",
		bankName: "Sparkasse Schwarzwald-Baar",
		iban: "de89 3704 0044 0532 0130 00",
		bic: "soladeS1VSS",
		countryCode: "de",
	}

	it("accepts a complete account and uppercases the codes", () => {
		const parsed = bankAccountsSchema.parse([account])

		// Banks print IBANs and BICs in capitals; a lowercase paste should not
		// reach a customer looking like a different value.
		expect(parsed[0]?.iban).toBe("DE89 3704 0044 0532 0130 00")
		expect(parsed[0]?.bic).toBe("SOLADES1VSS")
		expect(parsed[0]?.countryCode).toBe("DE")
	})

	it("accepts an account with only a name and an IBAN", () => {
		// Inside SEPA that is genuinely all a customer needs, and requiring more
		// would force shops to invent values.
		expect(() =>
			bankAccountsSchema.parse([{ accountName: "ASSCA GmbH", iban: "DE89370400440532013000" }])
		).not.toThrow()
	})

	it("refuses a malformed IBAN", () => {
		expect(bankAccountsSchema.safeParse([{ ...account, iban: "not-an-iban" }]).success).toBe(false)
	})

	it("refuses a BIC that is not 8 or 11 characters", () => {
		expect(bankAccountsSchema.safeParse([{ ...account, bic: "SOLA" }]).success).toBe(false)
		expect(bankAccountsSchema.safeParse([{ ...account, bic: "SOLADES1VS" }]).success).toBe(false)
	})

	it("requires an account holder", () => {
		expect(bankAccountsSchema.safeParse([{ iban: "DE89370400440532013000" }]).success).toBe(false)
	})

	describe("readBankAccounts", () => {
		it("reads its own key out of a config that holds other settings", () => {
			expect(readBankAccounts({ other: 1, bankAccounts: [account] })).toHaveLength(1)
		})

		it("yields nothing rather than throwing on rubbish", () => {
			// A bad settings row must never take down the thank-you page of an order
			// that has already been paid for.
			expect(readBankAccounts({ bankAccounts: "nope" })).toEqual([])
			expect(readBankAccounts({ bankAccounts: [{ iban: "broken" }] })).toEqual([])
			expect(readBankAccounts(null)).toEqual([])
			expect(readBankAccounts("string")).toEqual([])
		})
	})

	describe("hasBankAccounts", () => {
		it("is false for an account with no number to pay into", () => {
			// A name and a bank tell a customer nothing about where to send money.
			expect(hasBankAccounts({ bankAccounts: [{ accountName: "ASSCA GmbH" }] })).toBe(false)
		})

		it("is true once there is an IBAN", () => {
			expect(hasBankAccounts({ bankAccounts: [account] })).toBe(true)
		})
	})
})
