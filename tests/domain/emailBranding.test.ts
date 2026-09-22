import { describe, expect, it } from "vitest"
import { DEFAULT_BRANDING, readBranding, readableOn } from "../../src/domain/email/branding"

/**
 * These values land inside `style="..."` and `src="..."` in mail sent to
 * customers, so the interesting cases are the malformed ones.
 */
describe("email branding", () => {
	it("reads configured colours", () => {
		const b = readBranding({
			"email.baseColour": "#B91C1C",
			"email.backgroundColour": "#fff",
			"email.textColour": "#11223344",
		})

		expect(b.baseColour).toBe("#b91c1c")
		expect(b.backgroundColour).toBe("#fff")
		expect(b.textColour).toBe("#11223344")
	})

	it("falls back rather than writing a bad value into a style attribute", () => {
		const b = readBranding({
			"email.baseColour": 'red" onload="alert(1)',
			"email.backgroundColour": "rgb(0,0,0)",
			"email.textColour": "not a colour",
		})

		expect(b.baseColour).toBe(DEFAULT_BRANDING.baseColour)
		// Valid CSS, but not a hex — the parser accepts one shape only.
		expect(b.backgroundColour).toBe(DEFAULT_BRANDING.backgroundColour)
		expect(b.textColour).toBe(DEFAULT_BRANDING.textColour)
	})

	it("accepts only absolute http(s) logo URLs", () => {
		expect(readBranding({ "email.headerImage": "https://cdn.test/logo.png" }).headerImage).toBe(
			"https://cdn.test/logo.png"
		)
		expect(readBranding({ "email.headerImage": "javascript:alert(1)" }).headerImage).toBe("")
		expect(readBranding({ "email.headerImage": "data:image/png;base64,AAA" }).headerImage).toBe("")
		// Relative paths cannot resolve from inside an inbox.
		expect(readBranding({ "email.headerImage": "/uploads/logo.png" }).headerImage).toBe("")
		expect(readBranding({ "email.headerImage": "   " }).headerImage).toBe("")
	})

	it("defaults everything on an empty shop", () => {
		expect(readBranding({})).toEqual(DEFAULT_BRANDING)
	})

	/*
	 * The client, 22 September: "we need our logo on top and not ASSCA GmbH".
	 * The shop's own logo stands in until somebody sets another, and a logo set
	 * in the dashboard still wins.
	 */
	it("uses the shop's logo when none is set, and the configured one when it is", () => {
		const shopLogo = "https://shop.test/brand/astano-logo-email.png"

		expect(readBranding({}, shopLogo).headerImage).toBe(shopLogo)
		expect(readBranding({ "email.headerImage": "  " }, shopLogo).headerImage).toBe(shopLogo)
		expect(
			readBranding({ "email.headerImage": "https://cdn.test/other.png" }, shopLogo).headerImage
		).toBe("https://cdn.test/other.png")
		// A bad default is refused like a bad setting.
		expect(readBranding({}, "javascript:alert(1)").headerImage).toBe("")
	})

	it("puts the logo on white unless told otherwise — the logo is black", () => {
		expect(readBranding({}).headerBackgroundColour).toBe("#ffffff")
		expect(readBranding({ "email.headerBackgroundColour": "#F5F5F5" }).headerBackgroundColour).toBe("#f5f5f5")
		expect(readBranding({ "email.headerBackgroundColour": "url(x)" }).headerBackgroundColour).toBe("#ffffff")
	})

	describe("readableOn", () => {
		it("puts white on dark and black on light", () => {
			expect(readableOn("#272727")).toBe("#ffffff")
			expect(readableOn("#ffffff")).toBe("#000000")
		})

		it("weights green the way the eye does", () => {
			// Pure blue is dark to the eye, pure green is bright, despite both being
			// one full channel. A plain average would call them the same.
			expect(readableOn("#0000ff")).toBe("#ffffff")
			expect(readableOn("#00ff00")).toBe("#000000")
		})

		it("handles shorthand hex", () => {
			expect(readableOn("#fff")).toBe("#000000")
			expect(readableOn("#000")).toBe("#ffffff")
		})
	})
})
