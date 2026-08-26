import type { LocaleCode } from "../../../config/locales"
import * as mailer from "../../../helpers/mailer"
import type { EmailKind } from "./emailRegistry"

/**
 * Plausible content for a preview or a test send.
 *
 * Every entry calls the real sender. Nothing here composes HTML — that is the
 * point: a preview built from its own markup would keep looking correct after
 * the message it claims to show had drifted away from it.
 *
 * The data is deliberately ordinary rather than obviously fake. "Muster GmbH"
 * and a plausible IBAN show an admin what their own mail will look like with
 * real content in it; "XXXX" and "Lorem ipsum" show them a layout with nothing
 * in it, and they cannot tell whether the column widths hold.
 */

const CUSTOMER = { name: "Anna", full: "Anna Schmidt" }

/** A filled-in enquiry form, so the preview shows the block that carries it. */
const SAMPLE_CONTACT = {
	salutation: "Frau",
	firstName: "Anna",
	lastName: "Schmidt",
	name: CUSTOMER.full,
	company: "Muster GmbH",
	street: "Musterstrasse",
	houseNumber: "12a",
	postcode: "78661",
	city: "Dietingen",
	countryCode: "DE",
	phone: "+49 741 1748890",
	email: "anna.schmidt@example.com",
	message:
		"Wir bräuchten 250 Stück mit unserem Logo graviert. Liefertermin idealerweise Ende März.",
}

/**
 * A real DXF, small enough to write out here: one 100 mm line.
 *
 * The enquiry notification's point is that the customer's drawing arrives
 * attached to it, and a sample that only *named* a file would prove the
 * heading renders and nothing else — an admin would still not know whether
 * their mail server passes attachments through, which is the question a test
 * send exists to answer. This one opens in a CAD program, so the answer is
 * unambiguous.
 */
const SAMPLE_DXF = [
	"0", "SECTION", "2", "ENTITIES",
	"0", "LINE", "8", "0",
	"10", "0.0", "20", "0.0",
	"11", "100.0", "21", "0.0",
	"0", "ENDSEC", "0", "EOF", "",
].join("\r\n")

const SAMPLE_FILES = [
	{
		fileName: "logo-outline.dxf",
		sizeBytes: Buffer.byteLength(SAMPLE_DXF),
		mimeType: "image/vnd.dxf",
		read: async () => Buffer.from(SAMPLE_DXF),
	},
]

const SAMPLES: Record<EmailKind, (to: string, locale: LocaleCode) => Promise<void>> = {
	"order-placed": (to, locale) =>
		mailer.sendOrderConfirmation({
			to,
			locale,
			orderNumber: "AST-000128",
			// The full name, because the greeting is "Guten Tag Anna Schmidt," and
			// a preview showing only a first name would not reveal a layout that
			// breaks on a long one.
			customerName: CUSTOMER.full,
			subtotal: "249.00",
			shippingTotal: "8.90",
			taxTotal: "49.00",
			grandTotal: "306.90",
			currency: "EUR",
			items: [
				{ name: "Backblech 60 × 40 cm, gelocht", quantity: 4, lineTotal: "156.00" },
				{ name: "Auszugsrahmen Edelstahl", quantity: 1, lineTotal: "93.00" },
			],
			paymentTitle: "Zahlung per Vorkasse",
			// Written with the placeholders an admin would use, so the preview
			// proves they resolve rather than only that the paragraph fits.
			paymentInstructions:
				"Sie haben Zahlung per Vorkasse ausgewählt.\nBitte überweisen Sie den Gesamtbetrag in Höhe von {total} auf folgendes Konto:",
			bankAccounts: [
				{
					label: "Main account",
					accountName: "Muster GmbH",
					bankName: "Sparkasse Musterstadt",
					accountNumber: "",
					iban: "DE02 1203 0000 0000 2020 51",
					bic: "BYLADEM1001",
					countryCode: "DE",
				},
			],
		}),

	"order-completed": (to, locale) => status(to, locale, "COMPLETED"),
	"order-cancelled": (to, locale) => status(to, locale, "CANCELLED"),
	"order-refunded": (to, locale) => status(to, locale, "REFUNDED"),
	"order-failed": (to, locale) => status(to, locale, "FAILED"),
	"order-status": (to, locale) => status(to, locale, "ON_HOLD"),

	"customer-note": (to, locale) =>
		mailer.sendCustomerNote({
			to,
			locale,
			orderNumber: "AST-000128",
			customerName: CUSTOMER.name,
			note: "Your perforated trays are in production and will ship on Thursday. The frame is in stock and ships with them.",
		}),

	"account-welcome": (to, locale) =>
		mailer.sendAccountWelcome({ to, locale, name: CUSTOMER.name }),

	"account-approved": (to, locale) =>
		mailer.sendAccountDecision({ to, locale, name: CUSTOMER.full, approved: true }),

	"account-rejected": (to, locale) =>
		mailer.sendAccountDecision({ to, locale, name: CUSTOMER.full, approved: false }),

	"password-reset": (to, locale) =>
		mailer.sendPasswordReset({ to, locale, token: "sample-token-not-valid" }),

	"email-change": (to, locale) =>
		mailer.sendEmailChangeVerification({
			to,
			locale,
			verifyUrl: "https://example.invalid/verify-email?token=sample-token-not-valid",
		}),

	"email-changed": (to, locale) =>
		mailer.sendEmailChanged({ to, locale, newEmail: "anna.schmidt@example.com" }),

	"quote-submitted": (to, locale) =>
		mailer.sendQuoteSubmitted({
			to,
			locale,
			quoteNumber: "RFQ-000042",
			contactName: CUSTOMER.full,
			title: "Custom trays, 600 × 400",
			items: [
				{ name: "Backblech 60 × 40 cm, gelocht", quantity: 250 },
				{ name: "Silikonbeschichtung", quantity: 250 },
			],
			contact: SAMPLE_CONTACT,
			files: SAMPLE_FILES,
			accessToken: "sample-token-not-valid",
		}),

	"quote-answered": (to, locale) =>
		mailer.sendQuoteAnswered({
			to,
			locale,
			quoteNumber: "RFQ-000042",
			contactName: CUSTOMER.full,
			accessToken: "sample-token-not-valid",
		}),

	/*
	 * Through the real sender, like the artwork notification below — this
	 * message is the order summary and the button through to it, and the generic
	 * `staff` helper would preview neither.
	 */
	"staff-new-order": (to, locale) =>
		mailer.notifyStaffOfOrder({
			to,
			locale,
			orderId: "00000000-0000-0000-0000-000000000000",
			orderNumber: "AST-000128",
			customerName: CUSTOMER.full,
			customerEmail: "anna.schmidt@example.com",
			paymentTitle: "Zahlung auf Rechnung",
			subtotal: "249.00",
			shippingTotal: "8.90",
			taxTotal: "49.00",
			grandTotal: "306.90",
			currency: "EUR",
			items: [
				{ name: "Backblech 60 × 40 cm, gelocht", quantity: 4, lineTotal: "156.00" },
				{ name: "Auszugsrahmen Edelstahl", quantity: 1, lineTotal: "93.00" },
			],
		}),

	/* Through the real sender: this one carries the enquiry, not just its name. */
	"staff-new-quote": (to, locale) =>
		mailer.notifyStaffOfQuote({
			to,
			locale,
			quoteId: "00000000-0000-0000-0000-000000000000",
			quoteNumber: "RFQ-000042",
			title: "Custom trays, 600 × 400",
			items: [
				{ name: "Backblech 60 × 40 cm, gelocht", quantity: 250 },
				{ name: "Silikonbeschichtung", quantity: 250 },
			],
			contact: SAMPLE_CONTACT,
			files: SAMPLE_FILES,
		}),

	"staff-new-contact": (to, locale) =>
		staff(to, locale, "staff-new-contact", "Contact form: delivery times", "New enquiry", "Anna Schmidt (anna@example.com) asked: what are your lead times for 500 perforated trays?"),

	"staff-b2b-application": (to, locale) =>
		staff(to, locale, "staff-b2b-application", "New dealer application: Muster GmbH", "New dealer application", "Muster GmbH (Anna Schmidt) applied for a dealer account."),

	"b2b-received": (to, locale) =>
		mailer.sendB2bReceived({ to, locale, name: CUSTOMER.name, company: "Muster GmbH" }),
	"staff-low-stock": (to, locale) =>
		staff(to, locale, "staff-low-stock", "Low stock: BB-6040-P", "Stock is running low", "Order AST-000128 brought these below their low-stock mark: BB-6040-P (2)"),
	/*
	 * Through the real sender rather than the generic `staff` helper, so the
	 * preview shows the button — the whole point of this message is that staff
	 * click through to the order instead of being handed the file.
	 */
	"staff-order-artwork": (to, locale) =>
		mailer.notifyStaffOfArtwork({
			to,
			locale,
			orderId: "00000000-0000-0000-0000-000000000000",
			orderNumber: "AST-000128",
			customerName: CUSTOMER.full,
			lineName: "Individuelle Edelstahl Ausstechform",
			fileNames: ["logo-outline.dxf", "logo-preview.pdf"],
		}),
}

const status = (to: string, locale: LocaleCode, value: string) =>
	mailer.sendOrderStatusChanged({
		to,
		locale,
		orderNumber: "AST-000128",
		customerName: CUSTOMER.name,
		status: value,
	})

/**
 * Staff samples go through `notifyStaff`, which reads the recipient from the
 * settings — so the sample forces it, or a shop with no admin address
 * configured would preview a blank.
 */
const staff = (
	to: string,
	locale: LocaleCode,
	kind: Parameters<typeof mailer.notifyStaff>[0]["kind"],
	subject: string,
	title: string,
	intro: string
) => mailer.notifyStaff({ kind, locale, subject, title, intro, to })

export const sendSample = (kind: EmailKind, to: string, locale: LocaleCode): Promise<void> =>
	SAMPLES[kind](to, locale)
