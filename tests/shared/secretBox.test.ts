import { describe, expect, it } from "vitest"
import { maskSecret, open, seal } from "../../src/shared/secretBox"

/**
 * The credential store's guarantees, pinned.
 *
 * These are the properties the payment gateways rely on: a key survives the
 * round trip intact, a tampered blob is refused rather than silently decrypting
 * to something else, and what reaches the admin screen is never usable.
 */
describe("secretBox", () => {
	const key = "sk_live_51QabcdEFGHijkLMNopqrSTUvwx4242"

	it("returns the original value", () => {
		expect(open(seal(key))).toBe(key)
	})

	it("produces a different ciphertext each time", () => {
		// A fresh IV per call. Identical ciphertexts would reveal that two
		// gateways share a key without decrypting either.
		expect(seal(key)).not.toBe(seal(key))
	})

	it("refuses a tampered ciphertext", () => {
		const parts = seal(key).split(".")
		const bytes = Buffer.from(parts[3] as string, "base64url")
		bytes[0] ^= 0xff
		parts[3] = bytes.toString("base64url")

		expect(() => open(parts.join("."))).toThrow()
	})

	it("refuses a value that is not in the expected format", () => {
		expect(() => open("not-a-sealed-value")).toThrow(/format/i)
	})

	it("handles unicode and long values", () => {
		const awkward = "клю ч-ünïcode-🔑-".repeat(20)
		expect(open(seal(awkward))).toBe(awkward)
	})

	describe("maskSecret", () => {
		it("keeps the prefix and the last four characters", () => {
			expect(maskSecret(key)).toBe("sk_live_••••4242")
		})

		it("keeps a prefix that carries no mode", () => {
			expect(maskSecret("whsec_9f2c1a77bb40e5d6")).toBe("whsec_••••e5d6")
		})

		it("reveals nothing from a short value", () => {
			// Four of eight characters is half the secret, so short values are
			// masked outright rather than partially.
			expect(maskSecret("abc123")).toBe("••••")
		})
	})
})
