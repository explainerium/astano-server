import { describe, expect, it } from "vitest"
import { buildOrderConfirmation } from "../../src/helpers/mailer"
import { renderLayout } from "../../src/helpers/mailer/layout"
import { t } from "../../src/i18n"
import type { CompanyDetails } from "../../src/app/modules/setting/setting.service"

/**
 * The order confirmation, asserted rather than eyeballed.
 *
 * This is the one message every customer receives, and its wording is the
 * client's own — supplied paragraph by paragraph, including a bank-transfer
 * block whose whole purpose is that somebody can copy an IBAN and a reference
 * out of it. A layout change that quietly drops the reference, or a refactor
 * that collapses the greeting back into a single run-on paragraph, is invisible
 * until a customer's payment arrives with nothing to match it to.
 */

const de = (key: string, vars?: Record<string, string | number>) => t(key, "de", vars)

const ORDER = {
	to: "anna@example.com",
	locale: "de" as const,
	orderNumber: "AST-000818",
	customerName: "Anna Schmidt",
	subtotal: "249.00",
	shippingTotal: "8.90",
	taxTotal: "49.00",
	grandTotal: "306.90",
	currency: "EUR",
	items: [{ name: "Backblech 60 × 40 cm", quantity: 4, lineTotal: "156.00" }],
	paymentTitle: "Zahlung per Vorkasse",
	paymentInstructions:
		"Sie haben Zahlung per Vorkasse ausgewählt.\nBitte überweisen Sie den Gesamtbetrag in Höhe von {total} auf folgendes Konto:",
	bankAccounts: [
		{
			label: "",
			accountName: "ASSCA GmbH",
			bankName: "Sparkasse Schwarzwald-Baar",
			accountNumber: "",
			iban: "DE33 6945 0065 0151 0347 26",
			bic: "SOLADES1VSS",
			countryCode: "DE",
		},
	],
}

const COMPANY: CompanyDetails = {
	name: "ASSCA GmbH",
	street: "Fronstrasse 6",
	street2: "",
	postcode: "78661",
	city: "Dietingen",
	countryCode: "DE",
	state: "",
	vatId: "DE2984854706",
	registerNumber: "",
	email: "info@astano.de",
	phone: "",
	website: "https://astano.de",
	invoiceFooter: "",
	invoiceNumberPrefix: "AST-",
}

describe("order confirmation email", () => {
	const { html, textLines } = buildOrderConfirmation(ORDER, de)
	const text = textLines.join("\n")

	it("keeps the sections the client asked for, in order", () => {
		const nextSteps = html.indexOf("Wie geht es weiter?")
		const overview = html.indexOf("Übersicht Ihrer Bestellung")
		const payment = html.indexOf("Ihre Zahlungsmethode")

		expect(nextSteps).toBeGreaterThan(-1)
		expect(nextSteps).toBeLessThan(overview)
		expect(overview).toBeLessThan(payment)
	})

	it("names the proof that follows a custom order", () => {
		expect(html).toContain("Korrekturabzug")
	})

	it("resolves {total} in the admin's own payment wording", () => {
		expect(html).toContain("in Höhe von 306.90 EUR")
		// Never the raw placeholder — that reaches the customer as a gap where an
		// amount should be, and they cannot know what to transfer.
		expect(html).not.toContain("{total}")
		expect(text).toContain("in Höhe von 306.90 EUR")
	})

	it("carries the transfer reference beside the account details", () => {
		expect(html).toContain("Verwendungszweck")
		expect(html).toContain("AST-000818")
		expect(html).toContain("DE33 6945 0065 0151 0347 26")
	})

	it("repeats the IBAN and the reference in the plain-text part", () => {
		// A client with images and tables blocked still has to be payable from.
		expect(text).toContain("IBAN: DE33 6945 0065 0151 0347 26")
		expect(text).toContain("Verwendungszweck: AST-000818")
	})

	it("totals the order", () => {
		expect(html).toContain("4 × Backblech 60 × 40 cm")
		expect(html).toContain("306.90 EUR")
	})

	it("escapes a product name rather than letting it close a tag", () => {
		const composed = buildOrderConfirmation(
			{ ...ORDER, items: [{ name: '<b>Blech</b> & "Rahmen"', quantity: 1, lineTotal: "1.00" }] },
			de
		)

		expect(composed.html).toContain("&lt;b&gt;Blech&lt;/b&gt; &amp; &quot;Rahmen&quot;")
		expect(composed.html).not.toContain("<b>Blech</b>")
	})

	it("has no payment block at all when there is nothing to say", () => {
		const composed = buildOrderConfirmation(
			{ ...ORDER, paymentTitle: null, paymentInstructions: null, bankAccounts: [] },
			de
		)

		expect(composed.html).not.toContain("Ihre Zahlungsmethode")
	})
})

describe("email layout", () => {
	/**
	 * The greeting the client wrote is a salutation, then a blank line, then
	 * three separate statements. Rendered as one escaped paragraph — which is
	 * what the layout did before — it arrived as a single run-on line.
	 */
	it("gives the intro paragraphs and line breaks", () => {
		const html = renderLayout({
			title: "Bestellung AST-000818 eingegangen",
			intro: de("email.orderPlaced.intro", { name: "Anna Schmidt" }),
			bodyHtml: "",
			company: COMPANY,
		})

		// The salutation is a paragraph of its own …
		expect(html).toContain("Guten Tag Anna Schmidt,</p>")
		// … and the statements after it keep their own lines rather than running
		// together into one.
		expect(html).toContain("bei astano.de<br>Wir haben Ihre Bestellung erhalten")
		expect(html).toContain("Bearbeitung.<br>Sollte etwas unklar sein")
	})

	it("still escapes what it renders", () => {
		const html = renderLayout({
			title: "x",
			intro: '<script>alert(1)</script>',
			bodyHtml: "",
			company: COMPANY,
		})

		expect(html).not.toContain("<script>")
		expect(html).toContain("&lt;script&gt;")
	})
})
