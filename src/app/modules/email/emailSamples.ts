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

const SAMPLES: Record<EmailKind, (to: string, locale: LocaleCode) => Promise<void>> = {
	"order-placed": (to, locale) =>
		mailer.sendOrderConfirmation({
			to,
			locale,
			orderNumber: "AST-000128",
			customerName: CUSTOMER.name,
			subtotal: "249.00",
			shippingTotal: "8.90",
			taxTotal: "49.00",
			grandTotal: "306.90",
			currency: "EUR",
			items: [
				{ name: "Backblech 60 × 40 cm, gelocht", quantity: 4, lineTotal: "156.00" },
				{ name: "Auszugsrahmen Edelstahl", quantity: 1, lineTotal: "93.00" },
			],
			paymentTitle: "Bank transfer",
			paymentInstructions: "Please transfer the total within 14 days quoting the order number.",
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

	"staff-new-order": (to, locale) =>
		staff(to, locale, "staff-new-order", "New order AST-000128", "New order AST-000128", "Anna Schmidt placed an order for 306.90 EUR."),

	"staff-new-quote": (to, locale) =>
		staff(to, locale, "staff-new-quote", "New quote request RFQ-000042", "New quote request RFQ-000042", "Anna Schmidt sent a quote request: Custom trays, 600 × 400"),

	"staff-new-contact": (to, locale) =>
		staff(to, locale, "staff-new-contact", "Contact form: delivery times", "New enquiry", "Anna Schmidt (anna@example.com) asked: what are your lead times for 500 perforated trays?"),

	"staff-b2b-application": (to, locale) =>
		staff(to, locale, "staff-b2b-application", "New dealer application: Muster GmbH", "New dealer application", "Muster GmbH (Anna Schmidt) applied for a dealer account."),

	"staff-low-stock": (to, locale) =>
		staff(to, locale, "staff-low-stock", "Low stock: BB-6040-P", "Stock is running low", "Order AST-000128 brought these below their low-stock mark: BB-6040-P (2)"),
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
