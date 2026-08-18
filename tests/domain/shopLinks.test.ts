import { beforeAll, describe, expect, it } from "vitest"

/**
 * The links the API puts in emails.
 *
 * Pinned rather than merely exercised. These slugs are declared twice — here
 * and in `pathnames` in frontend/src/i18n/routing.ts — because the mail is
 * composed on this side and the page lives on the other, and there is no import
 * that can cross that gap. A test that only checked "returns a string" would
 * let the two drift apart, and the symptom of drift is a password-reset link
 * that 404s for the person who can no longer sign in.
 *
 * If one of these fails, the fix is to make both repositories agree — not to
 * update the expectation here.
 */
describe("shopUrl", () => {
	let shopUrl: typeof import("../../src/config/shopLinks").shopUrl

	beforeAll(async () => {
		process.env.SHOP_BASE_URL = "https://shop.example"
		process.env.DATABASE_URL ??= "postgresql://u:p@localhost:5432/d"
		;({ shopUrl } = await import("../../src/config/shopLinks"))
	})

	it("leaves German unprefixed — it is the default locale", () => {
		expect(shopUrl("resetPassword", "de", { token: "t" })).toBe(
			"https://shop.example/passwort-zuruecksetzen?token=t"
		)
		expect(shopUrl("verifyEmail", "de", { token: "t" })).toBe(
			"https://shop.example/e-mail-bestaetigen?token=t"
		)
	})

	it("prefixes English with /en", () => {
		expect(shopUrl("resetPassword", "en", { token: "t" })).toBe(
			"https://shop.example/en/reset-password?token=t"
		)
		expect(shopUrl("verifyEmail", "en", { token: "t" })).toBe(
			"https://shop.example/en/verify-email?token=t"
		)
	})

	it("escapes a token that would otherwise break the query string", () => {
		// Tokens are hex today. They have not always been, and a `+` silently
		// decoding to a space is the kind of bug that only shows up as "the link
		// says invalid or expired".
		expect(shopUrl("resetPassword", "de", { token: "a+b/c=d&e" })).toBe(
			"https://shop.example/passwort-zuruecksetzen?token=a%2Bb%2Fc%3Dd%26e"
		)
	})

	it("omits the query string entirely when there is nothing to add", () => {
		expect(shopUrl("resetPassword", "de")).toBe("https://shop.example/passwort-zuruecksetzen")
	})
})
