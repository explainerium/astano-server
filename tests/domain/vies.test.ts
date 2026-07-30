import { describe, expect, it } from "vitest"
import { parseVatNumber, validateVatNumber } from "../../src/helpers/vies"

describe("parseVatNumber", () => {
	it("splits a plain number", () => {
		expect(parseVatNumber("DE123456789")).toEqual({ countryCode: "DE", number: "123456789" })
	})

	it("tolerates how customers actually paste them", () => {
		for (const input of ["de 123 456 789", "DE-123456789", "DE.123.456.789", " DE123456789 "]) {
			expect(parseVatNumber(input)).toEqual({ countryCode: "DE", number: "123456789" })
		}
	})

	it("maps Greece to EL, which is what VIES files it under", () => {
		expect(parseVatNumber("GR123456789")?.countryCode).toBe("EL")
	})

	it("rejects anything that is not a country code plus a number", () => {
		expect(parseVatNumber("123456789")).toBeNull()
		expect(parseVatNumber("D1")).toBeNull()
		expect(parseVatNumber("")).toBeNull()
	})
})

describe("validateVatNumber — fails closed", () => {
	it("rejects a malformed number without calling out", async () => {
		for (const input of ["12345", "X", "", "!!!"]) {
			const r = await validateVatNumber(input)
			expect(r.valid).toBe(false)
			expect(r.reason).toBe("MALFORMED")
			expect(r.checkedRemotely).toBe(false)
		}
	})

	it("treats a well-formed non-EU number as out of scope, not malformed", async () => {
		// "NOTAVATNUMBER" parses as country NO — Norway is well-formed but
		// outside VIES. Either way it is not validated, which is what matters.
		const r = await validateVatNumber("not-a-vat-number")
		expect(r.valid).toBe(false)
		expect(r.reason).toBe("COUNTRY_NOT_COVERED")
		expect(r.checkedRemotely).toBe(false)
	})

	it("rejects a country VIES does not cover", async () => {
		const r = await validateVatNumber("US123456789")
		expect(r.valid).toBe(false)
		expect(r.reason).toBe("COUNTRY_NOT_COVERED")
	})

	/**
	 * The decision that matters: when VIES cannot answer, the number is NOT
	 * validated and full tax is charged. Assuming valid on error would hand out
	 * reverse charge to anyone typing a plausible number during an outage, and
	 * the shop would absorb the VAT.
	 */
	it("treats an unreachable service as NOT validated", async () => {
		const original = globalThis.fetch
		globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch

		try {
			const r = await validateVatNumber("DE123456789")
			expect(r.valid).toBe(false)
			expect(r.reason).toBe("SERVICE_UNAVAILABLE")
			expect(r.checkedRemotely).toBe(false)
		} finally {
			globalThis.fetch = original
		}
	})

	it("treats a 5xx from VIES as NOT validated", async () => {
		const original = globalThis.fetch
		globalThis.fetch = (() =>
			Promise.resolve({ ok: false, status: 503 } as Response)) as typeof fetch

		try {
			const r = await validateVatNumber("DE123456789")
			expect(r.valid).toBe(false)
			expect(r.reason).toBe("SERVICE_UNAVAILABLE")
		} finally {
			globalThis.fetch = original
		}
	})

	it("accepts a number VIES confirms", async () => {
		const original = globalThis.fetch
		globalThis.fetch = (() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ isValid: true, name: "ASSCA GmbH", address: "Fronstrasse 6" }),
			} as Response)) as typeof fetch

		try {
			const r = await validateVatNumber("DE123456789")
			expect(r.valid).toBe(true)
			expect(r.name).toBe("ASSCA GmbH")
			expect(r.checkedRemotely).toBe(true)
		} finally {
			globalThis.fetch = original
		}
	})

	it("rejects a number VIES does not recognise", async () => {
		const original = globalThis.fetch
		globalThis.fetch = (() =>
			Promise.resolve({ ok: true, json: () => Promise.resolve({ isValid: false }) } as Response)) as typeof fetch

		try {
			const r = await validateVatNumber("DE000000000")
			expect(r.valid).toBe(false)
			expect(r.reason).toBe("NOT_FOUND")
			expect(r.checkedRemotely).toBe(true)
		} finally {
			globalThis.fetch = original
		}
	})
})
