import { describe, expect, it } from "vitest"
import { planSettingWrite } from "../../src/domain/setting/settingWrite"

const isSecret = (key: string) => key === "smtp.password"

describe("planSettingWrite", () => {
	it("passes ordinary settings through with their public flag", () => {
		expect(
			planSettingWrite([{ key: "smtp.host", value: "smtp-relay.brevo.com", isPublic: false }], isSecret)
		).toEqual([{ key: "smtp.host", kind: "plain", value: "smtp-relay.brevo.com", isPublic: false }])
	})

	it("keeps a value that is falsy but meant — 0, false, empty string", () => {
		const planned = planSettingWrite(
			[
				{ key: "stock.outOfStockThreshold", value: 0 },
				{ key: "cart.redirectAfterAdd", value: false },
				{ key: "company.street2", value: "" },
			],
			isSecret
		)

		// Only credentials get the "blank means untouched" reading. A cleared
		// address line is a cleared address line.
		expect(planned).toHaveLength(3)
		expect(planned.map((p) => p.value)).toEqual([0, false, ""])
	})

	it("seals a credential the admin actually typed", () => {
		expect(planSettingWrite([{ key: "smtp.password", value: "  xkeysib-abc123  " }], isSecret)).toEqual([
			{ key: "smtp.password", kind: "secret", value: "xkeysib-abc123" },
		])
	})

	it("leaves a stored credential alone when the box comes back empty", () => {
		// The case that matters: the admin changed the port and submitted the
		// whole group, password box empty as it always is.
		const planned = planSettingWrite(
			[
				{ key: "smtp.port", value: 465 },
				{ key: "smtp.password", value: "" },
			],
			isSecret
		)

		expect(planned).toEqual([{ key: "smtp.port", kind: "plain", value: 465, isPublic: false }])
	})

	it("treats whitespace and null the same as empty", () => {
		expect(
			planSettingWrite(
				[
					{ key: "smtp.password", value: "   " },
					{ key: "smtp.password", value: null },
					{ key: "smtp.password", value: undefined },
				],
				isSecret
			)
		).toEqual([])
	})

	it("refuses to mark a credential public even when asked to", () => {
		const [planned] = planSettingWrite(
			[{ key: "smtp.password", value: "secret", isPublic: true }],
			isSecret
		)

		expect(planned).toEqual({ key: "smtp.password", kind: "secret", value: "secret" })
		expect(planned).not.toHaveProperty("isPublic", true)
	})

	it("writes nothing at all when the only entry is a blank credential", () => {
		// The service must not then run an INSERT with no rows.
		expect(planSettingWrite([{ key: "smtp.password", value: "" }], isSecret)).toEqual([])
	})
})
