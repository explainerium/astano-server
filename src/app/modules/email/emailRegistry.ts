/**
 * Every message the shop can send, and what the admin may change about it.
 *
 * The registry is the list the dashboard renders and the list the senders look
 * themselves up in. Adding a mail means an entry here plus the translated
 * defaults — nothing in the admin screens changes.
 *
 * Overrides are stored one JSON row per kind under `emailTemplate.<key>`,
 * deliberately outside `settingRegistry`: the generic settings form renders
 * whatever the registry declares, and five fields times nineteen mails is a
 * screen nobody can read. Emails get their own screen instead.
 */

export type EmailAudience = "customer" | "staff"

export interface EmailDefinition {
	label: string
	/** What triggers it, in the admin's terms. */
	description: string
	audience: EmailAudience
	/**
	 * False where switching it off breaks something the customer cannot work
	 * around — account recovery and the security notices. WooCommerce lets a
	 * shop disable its password reset; the result is a locked-out customer and
	 * a support ticket nobody connects to a checkbox.
	 */
	canDisable: boolean
	/** Setting holding the default recipient. Staff mail only. */
	recipientSetting?: "mail.adminNotifyAddress" | "stock.notifyAddress"
}

export interface EmailOverride {
	enabled: boolean
	/** Empty means the translated default. Supports the same {vars} as the default. */
	subject: string
	heading: string
	/** Appended above the footer. */
	additionalContent: string
	/** Staff mail only. Empty falls back to the setting. */
	recipient: string
}

export const EMPTY_OVERRIDE: EmailOverride = {
	enabled: true,
	subject: "",
	heading: "",
	additionalContent: "",
	recipient: "",
}

export const EMAILS = {
	// ── Orders ─────────────────────────────────────────────────────────────
	"order-placed": {
		label: "Order confirmation",
		description: "To the customer as soon as an order is placed. Carries the bank details for a transfer.",
		audience: "customer",
		canDisable: true,
	},
	"order-completed": {
		label: "Order completed",
		description: "When an order is marked completed.",
		audience: "customer",
		canDisable: true,
	},
	"order-cancelled": {
		label: "Order cancelled",
		description: "When an order is cancelled. Stock goes back on the shelf at the same moment.",
		audience: "customer",
		canDisable: true,
	},
	"order-refunded": {
		label: "Order refunded",
		description: "When an order is marked refunded.",
		audience: "customer",
		canDisable: true,
	},
	"order-failed": {
		label: "Order failed",
		description: "When payment could not be taken.",
		audience: "customer",
		canDisable: true,
	},
	"order-status": {
		label: "Order status changed",
		description: "Any other move — pending, processing, on hold. The four above take precedence.",
		audience: "customer",
		canDisable: true,
	},
	"customer-note": {
		label: "Note to the customer",
		description: "Sent when a staff member adds a note to an order and marks it visible.",
		audience: "customer",
		canDisable: true,
	},

	// ── Account ────────────────────────────────────────────────────────────
	"account-welcome": {
		label: "Welcome",
		description: "To a customer who has just registered.",
		audience: "customer",
		canDisable: true,
	},
	"account-approved": {
		label: "Dealer application approved",
		description: "To a B2B applicant who has been accepted.",
		audience: "customer",
		canDisable: true,
	},
	"account-rejected": {
		label: "Dealer application declined",
		description: "To a B2B applicant who has been turned down.",
		audience: "customer",
		canDisable: true,
	},
	"password-reset": {
		label: "Password reset",
		description: "The reset link. Cannot be switched off — without it a locked-out customer has no way back in.",
		audience: "customer",
		canDisable: false,
	},
	"email-change": {
		label: "Confirm a new email address",
		description: "The verification link sent to the new address. Cannot be switched off — it is what proves the address belongs to them.",
		audience: "customer",
		canDisable: false,
	},
	"email-changed": {
		label: "Email address was changed",
		description: "Warning to the old address. Cannot be switched off — it is how somebody finds out their account was taken.",
		audience: "customer",
		canDisable: false,
	},

	// ── Quotes ─────────────────────────────────────────────────────────────
	"quote-submitted": {
		label: "Quote request received",
		description: "Acknowledges a quote request.",
		audience: "customer",
		canDisable: true,
	},
	"quote-answered": {
		label: "Quote answered",
		description: "Tells the customer their quote is ready.",
		audience: "customer",
		canDisable: true,
	},

	// ── Staff ──────────────────────────────────────────────────────────────
	"staff-new-order": {
		label: "New order",
		description: "Tells staff an order has landed.",
		audience: "staff",
		canDisable: true,
		recipientSetting: "mail.adminNotifyAddress",
	},
	"staff-new-quote": {
		label: "New quote request",
		description: "Tells staff a quote request has landed.",
		audience: "staff",
		canDisable: true,
		recipientSetting: "mail.adminNotifyAddress",
	},
	"staff-new-contact": {
		label: "Contact form enquiry",
		description: "Tells staff somebody used the contact form.",
		audience: "staff",
		canDisable: true,
		recipientSetting: "mail.adminNotifyAddress",
	},
	"staff-b2b-application": {
		label: "New dealer application",
		description: "Tells staff a B2B application is waiting for a decision.",
		audience: "staff",
		canDisable: true,
		recipientSetting: "mail.adminNotifyAddress",
	},
	"staff-low-stock": {
		label: "Low stock",
		description: "Sent when an order takes a variant to its low-stock mark.",
		audience: "staff",
		canDisable: true,
		recipientSetting: "stock.notifyAddress",
	},
} as const satisfies Record<string, EmailDefinition>

export type EmailKind = keyof typeof EMAILS

export const EMAIL_KINDS = Object.keys(EMAILS) as EmailKind[]

/**
 * `Object.hasOwn`, not `in`.
 *
 * This guards a route parameter, and `"__proto__" in EMAILS` is true — so `in`
 * would wave through `/admin/emails/__proto__`, hand `Object.prototype` to code
 * expecting a definition, and let a settings row be written under that name.
 * The same goes for `constructor` and `toString`.
 */
export const isEmailKind = (value: string): value is EmailKind => Object.hasOwn(EMAILS, value)

/** Where an override lives in the settings table. */
export const overrideKey = (kind: EmailKind): string => `emailTemplate.${kind}`

/**
 * Reads one stored override, tolerating whatever is in the JSON column.
 *
 * Defaults to enabled. A mail that silently stops sending because a value was
 * malformed is far worse than one that sends when the admin meant to stop it —
 * the second is visible, the first is not.
 */
export const readOverride = (kind: EmailKind, stored: unknown): EmailOverride => {
	const row = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {}
	const text = (value: unknown): string => (typeof value === "string" ? value : "")

	return {
		enabled: EMAILS[kind].canDisable ? row.enabled !== false : true,
		subject: text(row.subject),
		heading: text(row.heading),
		additionalContent: text(row.additionalContent),
		recipient: "recipientSetting" in EMAILS[kind] ? text(row.recipient) : "",
	}
}
