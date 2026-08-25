import type { PaymentMethodType } from "@prisma/client"

/**
 * The offline ways to be paid, as a fixed set.
 *
 * These are kinds, not rows somebody invents. A shop is paid by transfer, on
 * invoice, or in cash on delivery — and each of those means something specific
 * that the checkout, the thank-you page and the invoice all have to understand.
 * "Create a method and pick a type from a dropdown" made the kind look like an
 * editable field, which produced a Bank transfer settings page offering to turn
 * itself into an invoice.
 *
 * So the list is closed and always present, exactly like the gateways: three
 * rows that exist from the first visit and are switched on or off. Nothing is
 * created and nothing is deleted — a method that has taken an order could not
 * safely be deleted anyway, and "switch it off" was always the real answer.
 *
 * Codes match what the live WordPress site already uses (`bacs`, `invoice`), so
 * existing rows are adopted rather than duplicated.
 *
 * PaymentMethodType.OTHER stays in the Prisma enum — removing an enum value
 * needs a migration and would break any row already holding it — but it is not
 * offered here, because a payment nobody can describe is not a payment method.
 */

/**
 * Placeholders the order confirmation fills in before showing `instructions`.
 *
 * `{total}` and `{orderNumber}` only. Written down here because this is where
 * an admin's text is first authored, and a placeholder that is not on this list
 * reaches the customer as literal braces rather than a figure.
 */
export const INSTRUCTION_PLACEHOLDERS = ["total", "orderNumber"] as const

export interface OfflineMethodDefinition {
	code: string
	type: PaymentMethodType
	sortOrder: number
	/** Whether it is switched on the first time it appears. */
	activeByDefault: boolean
	/** Seeded once, then owned by the admin. */
	translations: {
		locale: string
		title: string
		description: string
		instructions: string
		/** Shown once an order passes the method's review threshold. */
		conditionalNotice?: string
	}[]
}

export const OFFLINE_METHODS: OfflineMethodDefinition[] = [
	{
		code: "bacs",
		type: "BANK_TRANSFER",
		sortOrder: 10,
		// The live site offers it, so it arrives on. The bank details are still
		// empty at that point, which the admin screen refuses to let past.
		activeByDefault: true,
		translations: [
			{
				locale: "en",
				title: "Direct bank transfer",
				description:
					"Payment in advance. Available to international customers and first-time buyers from Germany.",
				instructions:
					"You have chosen payment in advance.\nPlease transfer the total of {total} to the following account:",
			},
			{
				locale: "de",
				title: "Direkte Banküberweisung",
				description:
					"Zahlung per Vorkasse. Zahlungsmöglichkeit für Auslandskunden und Erstbesteller aus Deutschland.",
				// The account itself is not here — it is entered in the dashboard and
				// rendered under this text, with the order number as the reference.
				instructions:
					"Sie haben Zahlung per Vorkasse ausgewählt.\nBitte überweisen Sie den Gesamtbetrag in Höhe von {total} auf folgendes Konto:",
			},
		],
	},
	{
		code: "invoice",
		type: "INVOICE",
		sortOrder: 20,
		activeByDefault: true,
		translations: [
			{
				locale: "en",
				title: "Payment by invoice",
				description: "Pay with an invoice processed through our accounting system.",
				instructions:
					"You have chosen payment by invoice. The invoice amount is due within 14 days of receiving the goods.",
				// {amount} is the threshold, so the wording follows the setting
				// rather than having to be edited alongside it.
				conditionalNotice:
					"Your order comes to more than {amount}. Payment by invoice is therefore possible only subject to approval. We will review your order and get in touch with you. For amounts above {amount} we normally ask for a deposit of 35–50%.",
			},
			{
				locale: "de",
				title: "Zahlung auf Rechnung",
				description: "Zahlung per Rechnung über unsere Buchhaltung.",
				instructions:
					"Sie haben Zahlung auf Rechnung ausgewählt. Der Rechnungsbetrag ist innerhalb von 14 Tagen nach Erhalt der Ware zu begleichen.",
				conditionalNotice:
					"Ihre Bestellung hat einen Wert von über {amount}. In diesem Fall ist Zahlung auf Rechnung nur unter Vorbehalt möglich. Wir werden Ihre Bestellung prüfen und uns mit Ihnen in Verbindung setzen. Im Normalfall verlangen wir bei Beträgen über {amount} eine Anzahlung in Höhe von 35–50%.",
			},
		],
	},
	{
		code: "cod",
		type: "CASH_ON_DELIVERY",
		sortOrder: 30,
		// Off until somebody decides what the carrier's cash-on-delivery fee
		// should cost the customer. Offering it by default would be making that
		// pricing decision on the client's behalf.
		activeByDefault: false,
		translations: [
			{
				locale: "en",
				title: "Cash on delivery",
				description: "Pay the courier when the parcel arrives.",
				instructions:
					"Please have the exact amount ready for the courier. Any cash-on-delivery fee charged by the carrier is payable on top.",
			},
			{
				locale: "de",
				title: "Nachnahme",
				description: "Zahlung bei Lieferung an den Zusteller.",
				instructions:
					"Bitte halten Sie den Betrag passend bereit. Eine eventuelle Nachnahmegebühr des Versanddienstleisters kommt hinzu.",
			},
		],
	},
]

/** The rules the invoice method starts with — the WPCode snippet, as data. */
export const DEFAULT_RULES: Record<string, Record<string, unknown>> = {
	/*
	 * "Signed in, at least one completed order, billing country DE or AT."
	 *
	 * On WordPress this lives in a WPCode snippet and is the single source of
	 * gateway-eligibility logic on that site. Reproduced here so the behaviour
	 * survives the move; the admin can change it from the screen afterwards.
	 */
	/*
	 * Approved resellers from their first order, everyone else from their
	 * second — the client's rule, and the reason `historyExemptRoles` exists.
	 * A reseller account is approved by a person before it can trade, so the
	 * order history it would otherwise have to build is already answered for.
	 *
	 * No maximum order value here on purpose. The client has one — invoice up to
	 * a set amount, larger orders arranged directly — but the figure is theirs
	 * to set and change from the dashboard, not a number compiled into the shop.
	 */
	invoice: {
		requiresLogin: true,
		minCompletedOrders: 1,
		historyExemptRoles: ["RESELLER"],
		allowedCountries: ["DE", "AT"],
	},
}
