import { describe, expect, it } from "vitest"
import {
	EMAILS,
	EMAIL_KINDS,
	EMPTY_OVERRIDE,
	isEmailKind,
	overrideKey,
	readOverride,
} from "../../src/app/modules/email/emailRegistry"

/**
 * The reader stands between a JSON column an admin can edit and the code that
 * decides whether a customer gets an email at all, so the malformed cases are
 * the ones that matter.
 */
describe("email registry", () => {
	it("defaults to sending", () => {
		expect(readOverride("order-placed", null)).toEqual(EMPTY_OVERRIDE)
		expect(readOverride("order-placed", undefined).enabled).toBe(true)
		expect(readOverride("order-placed", "nonsense").enabled).toBe(true)
	})

	it("only an explicit false disables", () => {
		// Anything else — a missing key, a null, a string — leaves the mail on.
		// Silently not sending is the failure nobody notices.
		expect(readOverride("order-placed", { enabled: false }).enabled).toBe(false)
		expect(readOverride("order-placed", { enabled: 0 }).enabled).toBe(true)
		expect(readOverride("order-placed", { enabled: null }).enabled).toBe(true)
		expect(readOverride("order-placed", {}).enabled).toBe(true)
	})

	it("ignores a stored off for an email that may not be disabled", () => {
		// A row written before the flag existed, or by hand, must not lock a
		// customer out of their own account.
		expect(readOverride("password-reset", { enabled: false }).enabled).toBe(true)
		expect(readOverride("email-change", { enabled: false }).enabled).toBe(true)
		expect(readOverride("email-changed", { enabled: false }).enabled).toBe(true)
	})

	it("keeps text fields as strings", () => {
		const o = readOverride("order-placed", { subject: "Hi {number}", heading: 42 })
		expect(o.subject).toBe("Hi {number}")
		expect(o.heading).toBe("")
	})

	it("drops a recipient on customer mail", () => {
		// Only staff notifications have a configurable address; storing one on a
		// customer mail would look like it redirected the customer's copy.
		expect(readOverride("order-placed", { recipient: "someone@example.com" }).recipient).toBe("")
		expect(readOverride("staff-new-order", { recipient: "ops@example.com" }).recipient).toBe(
			"ops@example.com"
		)
	})

	it("namespaces its settings keys away from the registry", () => {
		// These rows share the settings table but must never appear on the generic
		// settings screen, which renders from settingRegistry.
		expect(overrideKey("order-placed")).toBe("emailTemplate.order-placed")
	})

	it("recognises its own kinds and nothing else", () => {
		expect(isEmailKind("order-placed")).toBe(true)
		expect(isEmailKind("order-plaeced")).toBe(false)
		expect(isEmailKind("__proto__")).toBe(false)
	})

	describe("the registry itself", () => {
		it("gives every staff email an address to fall back on", () => {
			for (const kind of EMAIL_KINDS) {
				const definition = EMAILS[kind]
				if (definition.audience === "staff") {
					expect(definition, `${kind} has no recipientSetting`).toHaveProperty("recipientSetting")
				}
			}
		})

		it("locks exactly the mails that account recovery depends on", () => {
			const locked = EMAIL_KINDS.filter((k) => !EMAILS[k].canDisable)
			expect(locked.sort()).toEqual(["email-change", "email-changed", "password-reset"])
		})

		it("describes every email", () => {
			for (const kind of EMAIL_KINDS) {
				expect(EMAILS[kind].label.length, kind).toBeGreaterThan(0)
				expect(EMAILS[kind].description.length, kind).toBeGreaterThan(0)
			}
		})
	})
})
