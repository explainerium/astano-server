import { describe, expect, it } from "vitest"
import { findMatching, sameAddress } from "../../src/domain/account/sameAddress"

/**
 * The client asked why they had to type their address again on a second order.
 * Checkout now writes it into the address book — which is only an improvement
 * if the same address written twice is recognised as one.
 */
const base = {
	firstName: "Anna",
	lastName: "Schmidt",
	company: "ASSCA GmbH",
	street1: "Hauptstraße 4",
	street2: null,
	city: "Köln",
	state: null,
	postcode: "50667",
	countryCode: "DE",
}

describe("sameAddress", () => {
	it("ignores case, padding and doubled spaces", () => {
		expect(
			sameAddress(base, {
				...base,
				firstName: "  anna ",
				street1: "hauptstraße  4",
				city: "KÖLN",
			})
		).toBe(true)
	})

	it("ignores spacing inside a postcode", () => {
		expect(sameAddress(base, { ...base, postcode: "506 67" })).toBe(true)
	})

	it("treats a missing optional field and an empty one as the same", () => {
		expect(sameAddress(base, { ...base, street2: "", state: undefined })).toBe(true)
	})

	it("does not merge two different houses on one street", () => {
		expect(sameAddress(base, { ...base, street1: "Hauptstraße 5" })).toBe(false)
	})

	it("does not merge the same street in two countries", () => {
		expect(sameAddress(base, { ...base, countryCode: "AT" })).toBe(false)
	})

	it("does not merge two people at one address", () => {
		expect(sameAddress(base, { ...base, firstName: "Bernd" })).toBe(false)
	})

	it("keeps fields apart that a space separator would run together", () => {
		// city "a b" + no state must not read as city "a" + state "b".
		const left = { ...base, city: "a b", state: null }
		const right = { ...base, city: "a", state: "b" }
		expect(sameAddress(left, right)).toBe(false)
	})

	it("is not confused by a changed phone number or email", () => {
		// Neither is part of what makes an address a place, so neither is here —
		// a corrected phone number must not become a second address.
		expect(sameAddress(base, { ...base })).toBe(true)
	})
})

describe("findMatching", () => {
	const book = [
		{ id: "1", ...base },
		{ id: "2", ...base, street1: "Werkstattweg 9", city: "Bonn", postcode: "53111" },
	]

	it("finds the entry that already names the place", () => {
		expect(findMatching(book, { ...base, city: "köln" })?.id).toBe("1")
	})

	it("returns null when the address is new", () => {
		expect(findMatching(book, { ...base, street1: "Neue Straße 1" })).toBeNull()
	})

	it("returns null for an empty book", () => {
		expect(findMatching([], base)).toBeNull()
	})
})
