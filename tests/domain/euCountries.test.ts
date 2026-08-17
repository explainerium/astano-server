import { describe, expect, it } from "vitest"
import { EU_COUNTRIES, isEuCountry, requiresVatId } from "../../src/domain/tax/euCountries"

/**
 * The client's rule, which is narrower than "businesses have VAT IDs": the VAT
 * ID is required of an EU business *outside* the shop's own country, because
 * that is the only case reverse charge applies to.
 */

describe("isEuCountry", () => {
	it("knows a member state", () => {
		expect(isEuCountry("AT")).toBe(true)
		expect(isEuCountry("NL")).toBe(true)
	})

	it("does not count Switzerland, the UK or Norway", () => {
		// All three are European and none is in the EU — the distinction this
		// whole file turns on.
		expect(isEuCountry("CH")).toBe(false)
		expect(isEuCountry("GB")).toBe(false)
		expect(isEuCountry("NO")).toBe(false)
	})

	it("is case-insensitive", () => {
		expect(isEuCountry("at")).toBe(true)
	})

	it("treats a missing country as not in the EU", () => {
		expect(isEuCountry(null)).toBe(false)
		expect(isEuCountry("")).toBe(false)
	})

	it("lists 27 member states, each exactly once", () => {
		expect(EU_COUNTRIES).toHaveLength(27)
		expect(new Set(EU_COUNTRIES).size).toBe(27)
	})
})

describe("requiresVatId", () => {
	it("requires one from an EU business outside Germany", () => {
		// Reverse charge: lawful only against a valid VAT ID.
		expect(requiresVatId("AT")).toBe(true)
		expect(requiresVatId("NL")).toBe(true)
	})

	it("does not require one from a German business", () => {
		// Domestic B2B is taxed normally at 19%; the buyer's VAT ID changes
		// nothing, so asking would refuse German dealers over a field that does
		// not apply to them.
		expect(requiresVatId("DE")).toBe(false)
	})

	it("does not require one from outside the EU", () => {
		// An export. There is no EU VAT ID to give.
		expect(requiresVatId("CH")).toBe(false)
		expect(requiresVatId("US")).toBe(false)
	})

	it("follows the shop's own country rather than assuming Germany", () => {
		// A shop that moves must not need a code change to keep invoicing right.
		expect(requiresVatId("DE", "AT")).toBe(true)
		expect(requiresVatId("AT", "AT")).toBe(false)
	})

	it("falls back to Germany when the shop's country is unset", () => {
		// A misconfigured setting must not start refusing registrations.
		expect(requiresVatId("DE", "")).toBe(false)
		expect(requiresVatId("AT", null)).toBe(true)
	})

	it("requires nothing when no country has been chosen yet", () => {
		expect(requiresVatId(null)).toBe(false)
		expect(requiresVatId("")).toBe(false)
	})
})
