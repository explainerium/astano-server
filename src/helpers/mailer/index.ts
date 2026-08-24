import { env, shopUrl } from "../../config"
import type { LocaleCode } from "../../config/locales"
import { interpolate, t } from "../../i18n"
import type { BankAccount } from "../../domain/payment/bankAccounts"
import { SettingService } from "../../app/modules/setting/setting.service"
import { EmailService } from "../../app/modules/email/email.service"
import type { EmailKind } from "../../app/modules/email/emailRegistry"
import { bodyText, esc, renderLayout, rowsTable, section, toPlainText } from "./layout"
import { sendMail } from "./transport"

export { isConfigured } from "./transport"

/**
 * Transactional email.
 *
 * Every message is composed in the recipient's own locale — an order placed in
 * German stays German forever, which is why `locale` is frozen onto the order
 * rather than read from the current request.
 *
 * Every message also goes through `dispatch`, which is what applies the admin's
 * per-email settings. Composing a `sendMail` call directly anywhere else means
 * a mail that ignores its own on/off switch, and nobody finds out until a
 * customer receives something the shop had switched off.
 */

/**
 * A link into the shop, not into this API.
 *
 * `PUBLIC_BASE_URL` is the API's own origin — right for media, wrong for
 * anything a person is meant to open. Every link in every email used it, so a
 * password reset arrived pointing at a URL that answers 404 in JSON and a
 * customer had no way to finish resetting their password. `SHOP_BASE_URL`
 * falls back to the first allowed CORS origin, so this needs no new variable
 * to start working.
 */
const url = (path: string): string => `${env.SHOP_BASE_URL}${path}`

/**
 * A link into the dashboard.
 *
 * Separate from `url` only so the reason is written down: the admin lives
 * outside `[locale]` and takes no language prefix, so a staff link must never
 * be built through whatever localises the customer-facing ones.
 */
const adminUrl = (path: string): string => `${env.SHOP_BASE_URL}/admin${path}`

interface DispatchInput {
	/** Customer mail. Staff mail leaves this out and takes the configured address. */
	to?: string
	locale: LocaleCode
	/** i18n prefix — `${messages}.subject` and `${messages}.title` are the defaults. */
	messages: string
	/** Substituted into both the defaults and any admin override. */
	vars?: Record<string, string | number>
	intro: string
	bodyHtml?: string
	textLines?: string[]
	action?: { label: string; url: string }
	/** Defaults to the company address so a reply reaches a person. */
	replyTo?: string | null
	context?: Record<string, unknown>
}

/**
 * Applies the admin's settings for one email kind and sends it.
 *
 * Returns quietly when the mail is switched off or has nowhere to go, which is
 * the same shape as the old "no admin address configured" behaviour and is why
 * nothing upstream has to care.
 */
const dispatch = async (kind: EmailKind, input: DispatchInput): Promise<void> => {
	const company = await SettingService.getCompany()

	/*
	 * `{shop}` is available to every message, built-in or admin-written, without
	 * each sender having to remember to pass it. Caller vars come second so a
	 * sender can still override it if it ever needs to.
	 */
	const vars = { shop: company.name || "astano", ...input.vars }

	const prepared = await EmailService.prepare(kind, vars)
	if (!prepared) return

	const to = input.to ?? prepared.recipient
	if (!to) return

	const L = (key: string, extra?: Record<string, string | number>) => t(key, input.locale, extra)

	const subject = prepared.subject ?? L(`${input.messages}.subject`, vars)
	const heading = prepared.heading ?? L(`${input.messages}.title`, vars)

	sendMail(
		{
			to,
			subject,
			html: renderLayout({
				title: heading,
				intro: input.intro,
				bodyHtml: input.bodyHtml ?? "",
				company,
				branding: prepared.branding,
				additionalContent: prepared.additionalContent,
				...(input.action ? { action: input.action } : {}),
			}),
			text: toPlainText(heading, input.intro, [
				...(input.textLines ?? []),
				...(prepared.additionalContent ? ["", prepared.additionalContent] : []),
			]),
			...(input.replyTo === null ? {} : { replyTo: input.replyTo ?? (company.email || undefined) }),
		},
		{ kind, ...input.context }
	)
}

export { dispatch as sendTemplated }

interface OrderMailInput {
	to: string
	locale: LocaleCode
	orderNumber: string
	customerName: string
	subtotal: string
	shippingTotal: string
	taxTotal: string
	grandTotal: string
	currency: string
	items: { name: string; quantity: number; lineTotal: string }[]
	paymentTitle?: string | null
	paymentInstructions?: string | null
	/** Frozen on the order. For a bank transfer this is the whole point of the email. */
	bankAccounts?: BankAccount[]
}

/**
 * The bank details, as labelled rows.
 *
 * This is the part of a bank-transfer email that has a job to do: the customer
 * opens their banking app beside it and copies. Rows with a label beside each
 * value are what makes that possible — an IBAN in the middle of a sentence gets
 * mistyped, and money sent to a mistyped IBAN is a support case measured in
 * weeks.
 *
 * Empty fields are dropped rather than shown blank, so a shop that only holds
 * an IBAN and BIC does not email a form with three gaps in it.
 */
const bankAccountsHtml = (
	accounts: BankAccount[],
	L: (key: string) => string,
	/**
	 * What the customer must quote on the transfer — the order number.
	 *
	 * Part of the table rather than a sentence above it, because it is one more
	 * thing to copy across into a banking app and belongs beside the IBAN they
	 * are copying it with. A payment that arrives with no reference has to be
	 * matched to an order by hand, and until somebody does, the customer is
	 * waiting on an order the shop believes is unpaid.
	 */
	reference?: string
): string => {
	if (!accounts.length) return ""

	return accounts
		.map((account) => {
			const rows = [
				[L("email.bank.accountName"), account.accountName],
				[L("email.bank.bankName"), account.bankName],
				[L("email.bank.accountNumber"), account.accountNumber],
				[L("email.bank.iban"), account.iban],
				[L("email.bank.bic"), account.bic],
				[L("email.bank.country"), account.countryCode],
				[L("email.bank.reference"), reference ?? ""],
			].filter(([, value]) => Boolean(value)) as [string, string][]

			const heading = account.label
				? `<p style="margin:16px 0 4px;font-size:13px;font-weight:600;">${esc(account.label)}</p>`
				: ""

			return heading + rowsTable(rows.map(([label, value]) => ({ label, value })))
		})
		.join("")
}

/**
 * Line items and money, as one table. Shared by the customer's copy and the
 * staff notification so the two can never disagree about what was ordered.
 */
type OrderSummary = Pick<
	OrderMailInput,
	"items" | "subtotal" | "shippingTotal" | "taxTotal" | "grandTotal" | "currency"
>

const orderTableHtml = (input: OrderSummary, L: (key: string) => string): string =>
	rowsTable([
		...input.items.map((i) => ({
			label: `${i.quantity} × ${i.name}`,
			value: `${i.lineTotal} ${input.currency}`,
		})),
		{ label: L("email.subtotal"), value: `${input.subtotal} ${input.currency}` },
		{ label: L("email.shipping"), value: `${input.shippingTotal} ${input.currency}` },
		{ label: L("email.tax"), value: `${input.taxTotal} ${input.currency}` },
		{ label: L("email.total"), value: `${input.grandTotal} ${input.currency}`, strong: true },
	])

const orderTextLines = (input: OrderSummary, L: (key: string) => string): string[] => [
	...input.items.map((i) => `${i.quantity} × ${i.name} — ${i.lineTotal} ${input.currency}`),
	`${L("email.total")}: ${input.grandTotal} ${input.currency}`,
]

type Translate = (key: string, vars?: Record<string, string | number>) => string

/**
 * The customer's order confirmation, as HTML and as plain text.
 *
 * Separated from the sending so it can be read back in a test without a mail
 * server, a database or a settings row. This is the message the shop's own
 * customers receive and the wording is the client's, down to the paragraph
 * breaks; "does it still say what they asked for" is worth being able to assert
 * rather than to check by sending one and looking.
 */
export const buildOrderConfirmation = (
	input: OrderMailInput,
	L: Translate
): { html: string; textLines: string[] } => {
	const total = `${input.grandTotal} ${input.currency}`
	const accounts = input.bankAccounts ?? []

	/*
	 * The admin's own wording for this payment method, with the order's numbers
	 * filled in.
	 *
	 * "Please transfer {total} quoting {orderNumber}" has to name a figure and a
	 * reference, and neither is known when the text is written. Without this the
	 * client's alternatives were a sentence with a gap in it or the same text
	 * hard-coded here, where changing it means a deploy — and the whole reason
	 * these instructions live on the payment method is that they should not.
	 *
	 * `interpolate` leaves an unknown placeholder visible rather than blanking
	 * it, so a typo shows up in the preview instead of silently eating a figure.
	 */
	const instructions = input.paymentInstructions
		? interpolate(input.paymentInstructions, { orderNumber: input.orderNumber, total })
		: null

	const nextStepsHtml = section(
		L("email.orderPlaced.nextStepsTitle"),
		bodyText(L("email.orderPlaced.nextSteps"))
	)

	// A lead-in sentence rather than a heading, because that is what the copy is
	// — "Im Folgenden finden Sie nochmals die Übersicht Ihrer Bestellung:" reads
	// as an introduction to the table and looks wrong set as a title above it.
	const overviewHtml =
		`<div style="margin:28px 0 0;">${bodyText(L("email.orderPlaced.overview"))}</div>` +
		orderTableHtml(input, L)

	const paymentHtml =
		instructions || accounts.length || input.paymentTitle
			? section(
					L("email.orderPlaced.paymentTitle"),
					(input.paymentTitle
						? `<p style="margin:0 0 10px;font-size:14px;font-weight:600;">${esc(input.paymentTitle)}</p>`
						: "") +
						(instructions ? bodyText(instructions) : "") +
						bankAccountsHtml(accounts, L, input.orderNumber)
				)
			: ""

	return {
		html: nextStepsHtml + overviewHtml + paymentHtml,
		textLines: [
			"",
			L("email.orderPlaced.nextStepsTitle"),
			L("email.orderPlaced.nextSteps"),
			"",
			L("email.orderPlaced.overview"),
			...orderTextLines(input, L),
			"",
			L("email.orderPlaced.paymentTitle"),
			...(input.paymentTitle ? [input.paymentTitle] : []),
			...(instructions ? [instructions] : []),
			// The plain-text part matters here: a mail client with images and
			// tables blocked still has to be able to show somebody an IBAN.
			...accounts.flatMap((account) =>
				[
					"",
					account.label ?? "",
					account.accountName ? `${L("email.bank.accountName")}: ${account.accountName}` : "",
					account.bankName ? `${L("email.bank.bankName")}: ${account.bankName}` : "",
					account.accountNumber ? `${L("email.bank.accountNumber")}: ${account.accountNumber}` : "",
					account.iban ? `${L("email.bank.iban")}: ${account.iban}` : "",
					account.bic ? `${L("email.bank.bic")}: ${account.bic}` : "",
					`${L("email.bank.reference")}: ${input.orderNumber}`,
				].filter(Boolean)
			),
		],
	}
}

export const sendOrderConfirmation = async (input: OrderMailInput): Promise<void> => {
	const L: Translate = (key, vars) => t(key, input.locale, vars)
	const composed = buildOrderConfirmation(input, L)

	await dispatch("order-placed", {
		to: input.to,
		locale: input.locale,
		messages: "email.orderPlaced",
		vars: {
			number: input.orderNumber,
			name: input.customerName,
			total: `${input.grandTotal} ${input.currency}`,
		},
		intro: L("email.orderPlaced.intro", { name: input.customerName }),
		bodyHtml: composed.html,
		textLines: composed.textLines,
		context: { orderNumber: input.orderNumber },
	})
}

/**
 * Which of the status mails a move belongs to.
 *
 * Four statuses read as events in their own right and get their own message and
 * their own on/off switch; the rest share the generic one. WooCommerce splits
 * them the same way, and for the same reason — "your order was refunded" and
 * "your order is on hold" have nothing in common but the trigger.
 */
const STATUS_KINDS: Record<string, { kind: EmailKind; messages: string }> = {
	COMPLETED: { kind: "order-completed", messages: "email.orderCompleted" },
	CANCELLED: { kind: "order-cancelled", messages: "email.orderCancelled" },
	REFUNDED: { kind: "order-refunded", messages: "email.orderRefunded" },
	FAILED: { kind: "order-failed", messages: "email.orderFailed" },
}

export const sendOrderStatusChanged = async (input: {
	to: string
	locale: LocaleCode
	orderNumber: string
	customerName: string
	status: string
}): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)
	const statusLabel = L(`orderStatus.${input.status}`)

	const specific = STATUS_KINDS[input.status]
	const vars = { number: input.orderNumber, name: input.customerName, status: statusLabel }

	await dispatch(specific?.kind ?? "order-status", {
		to: input.to,
		locale: input.locale,
		messages: specific?.messages ?? "email.orderStatus",
		vars,
		intro: L(`${specific?.messages ?? "email.orderStatus"}.intro`, vars),
		context: { orderNumber: input.orderNumber, status: input.status },
	})
}

export const sendCustomerNote = async (input: {
	to: string
	locale: LocaleCode
	orderNumber: string
	customerName: string
	note: string
}): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)
	const vars = { number: input.orderNumber, name: input.customerName }

	await dispatch("customer-note", {
		to: input.to,
		locale: input.locale,
		messages: "email.customerNote",
		vars,
		intro: L("email.customerNote.intro", vars),
		bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6;white-space:pre-line;">${esc(input.note)}</p>`,
		textLines: ["", input.note],
		context: { orderNumber: input.orderNumber },
	})
}

export const sendAccountWelcome = async (input: {
	to: string
	locale: LocaleCode
	name: string
}): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	await dispatch("account-welcome", {
		to: input.to,
		locale: input.locale,
		messages: "email.accountWelcome",
		vars: { name: input.name },
		intro: L("email.accountWelcome.intro", { name: input.name }),
		action: { label: L("email.accountWelcome.action"), url: url("/account") },
		textLines: [url("/account")],
		context: { kind: "account-welcome" },
	})
}

export const sendPasswordReset = async (input: {
	to: string
	locale: LocaleCode
	token: string
}): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)
	// Localised, and built from SHOP_BASE_URL — the slug differs per language
	// and the link has to open a page, not this API. See config/shopLinks.
	const link = shopUrl("resetPassword", input.locale, { token: input.token })

	await dispatch("password-reset", {
		to: input.to,
		locale: input.locale,
		messages: "email.passwordReset",
		intro: L("email.passwordReset.intro"),
		bodyHtml: `<p style="margin:0;font-size:13px;opacity:0.7;">${esc(L("email.passwordReset.expiry"))}</p>`,
		action: { label: L("email.passwordReset.action"), url: link },
		textLines: [link, "", L("email.passwordReset.expiry")],
		// No reply-to: a password reset is not a conversation, and inviting a
		// reply to it invites somebody to email their new password.
		replyTo: null,
	})
}

export const sendEmailChangeVerification = async (input: {
	to: string
	locale: LocaleCode
	/** Built by the caller — the landing path is translated per locale. */
	verifyUrl: string
}): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	await dispatch("email-change", {
		to: input.to,
		locale: input.locale,
		messages: "email.emailChange",
		intro: L("email.emailChange.intro"),
		bodyHtml:
			`<p style="margin:0 0 8px;font-size:13px;opacity:0.7;">${esc(L("email.emailChange.expiry"))}</p>` +
			`<p style="margin:0;font-size:13px;opacity:0.7;">${esc(L("email.emailChange.ignore"))}</p>`,
		action: { label: L("email.emailChange.action"), url: input.verifyUrl },
		textLines: [input.verifyUrl, "", L("email.emailChange.expiry"), L("email.emailChange.ignore")],
		replyTo: null,
		context: {
			// Without SMTP the mailer logs only recipient and subject, and the link
			// lives inside the HTML — so it would be unreachable and this flow
			// untestable locally. Development only.
			...(env.NODE_ENV === "development" ? { verifyUrl: input.verifyUrl } : {}),
		},
	})
}

export const sendEmailChanged = async (input: {
	to: string
	locale: LocaleCode
	newEmail: string
}): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	await dispatch("email-changed", {
		to: input.to,
		locale: input.locale,
		messages: "email.emailChanged",
		vars: { email: input.newEmail },
		intro: L("email.emailChanged.intro", { email: input.newEmail }),
	})
}

export const sendQuoteSubmitted = async (input: {
	to: string
	locale: LocaleCode
	quoteNumber: string
	contactName: string
	title: string
	items: { name: string; quantity: number }[]
	/// Guests reach their thread with this; signed-in customers do not need it.
	accessToken?: string | null
}): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	const link = input.accessToken
		? url(`/quote/${encodeURIComponent(input.accessToken)}`)
		: url("/account/quotes")

	await dispatch("quote-submitted", {
		to: input.to,
		locale: input.locale,
		messages: "email.quoteSubmitted",
		vars: { number: input.quoteNumber, name: input.contactName, title: input.title },
		intro: L("email.quoteSubmitted.intro", { name: input.contactName }),
		bodyHtml: rowsTable(input.items.map((i) => ({ label: i.name, value: String(i.quantity) }))),
		action: { label: L("email.quoteSubmitted.action"), url: link },
		textLines: [...input.items.map((i) => `${i.quantity} × ${i.name}`), "", link],
		context: { quoteNumber: input.quoteNumber },
	})
}

export const sendQuoteAnswered = async (input: {
	to: string
	locale: LocaleCode
	quoteNumber: string
	contactName: string
	accessToken?: string | null
}): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	const link = input.accessToken
		? url(`/quote/${encodeURIComponent(input.accessToken)}`)
		: url("/account/quotes")

	await dispatch("quote-answered", {
		to: input.to,
		locale: input.locale,
		messages: "email.quoteAnswered",
		vars: { number: input.quoteNumber, name: input.contactName },
		intro: L("email.quoteAnswered.intro", { name: input.contactName }),
		action: { label: L("email.quoteAnswered.action"), url: link },
		textLines: [link],
		context: { quoteNumber: input.quoteNumber },
	})
}

export const sendAccountDecision = async (input: {
	to: string
	locale: LocaleCode
	name: string
	approved: boolean
}): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	const messages = input.approved ? "email.accountApproved" : "email.accountRejected"

	await dispatch(input.approved ? "account-approved" : "account-rejected", {
		to: input.to,
		locale: input.locale,
		messages,
		vars: { name: input.name },
		intro: L(`${messages}.intro`, { name: input.name }),
		...(input.approved
			? { action: { label: L("email.accountApproved.action"), url: url("/") } }
			: {}),
	})
}

/**
 * Confirms a dealer application to the person who sent it.
 *
 * Ordinary signup has said welcome since the day it was built; a dealer
 * application said nothing at all. Somebody filled in sixteen fields, saw a
 * thank-you page, and then heard nothing — with no way to tell whether it had
 * arrived, and nothing in their inbox to reply to or forward to a colleague.
 *
 * Deliberately says the account is not yet approved. This is the one message
 * where being clear about *not* being finished is the entire job: the account
 * exists, they can sign in, and they are on guest prices until a human looks at
 * it (R5b). Approval and rejection are separate messages.
 */
export const sendB2bReceived = async (input: {
	to: string
	locale: LocaleCode
	name: string
	company: string
}): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	await dispatch("b2b-received", {
		to: input.to,
		locale: input.locale,
		messages: "email.b2bReceived",
		vars: { name: input.name, company: input.company },
		intro: L("email.b2bReceived.intro", { name: input.name, company: input.company }),
		bodyHtml: `<p style="margin:0;font-size:13px;opacity:0.7;">${esc(L("email.b2bReceived.next"))}</p>`,
		action: { label: L("email.b2bReceived.action"), url: url("/account") },
		textLines: [L("email.b2bReceived.next"), "", url("/account")],
	})
}

/**
 * Tells staff something has landed.
 *
 * The caller passes the kind rather than a recipient: which address it goes to
 * is the admin's setting, not the caller's business, and routing it here is
 * what lets low-stock warnings reach whoever actually reorders.
 */
export const notifyStaff = async (input: {
	kind: Extract<
		EmailKind,
		| "staff-new-order"
		| "staff-new-quote"
		| "staff-new-contact"
		| "staff-b2b-application"
		| "staff-low-stock"
		| "staff-order-artwork"
	>
	locale: LocaleCode
	subject: string
	title: string
	intro: string
	/**
	 * A button through to the thing that happened.
	 *
	 * Always a dashboard link, never the file itself. A signed download URL
	 * lives five minutes and would be dead before anybody opened the message —
	 * and lengthening it would put a customer's drawing behind a URL that
	 * survives every forward of the email it arrived in. Staff sign in and take
	 * it from the order, where the download already lives.
	 */
	action?: { label: string; url: string }
	/** Detail under the intro — what was ordered, who by, how they are paying. */
	bodyHtml?: string
	textLines?: string[]
	/**
	 * Forces the recipient. Only previews and test sends pass this — real
	 * notifications take the address from the settings, so that a shop which
	 * changes where its alerts go does not have to redeploy.
	 */
	to?: string
}): Promise<void> => {
	const company = await SettingService.getCompany()
	const prepared = await EmailService.prepare(input.kind, { shop: company.name || "astano" })
	if (!prepared) return

	const to = input.to ?? prepared.recipient
	if (!to) return

	sendMail(
		{
			to,
			subject: prepared.subject ?? input.subject,
			html: renderLayout({
				title: prepared.heading ?? input.title,
				intro: input.intro,
				bodyHtml: input.bodyHtml ?? "",
				company,
				branding: prepared.branding,
				additionalContent: prepared.additionalContent,
				...(input.action ? { action: input.action } : {}),
			}),
			text: toPlainText(prepared.heading ?? input.title, input.intro, [
				...(input.textLines ?? []),
				...(input.action ? ["", input.action.url] : []),
			]),
		},
		{ kind: input.kind }
	)
}

/**
 * Tells staff an order has been placed.
 *
 * Carries the order itself rather than announcing that one exists. The message
 * used to be a heading and a single line — "Anna Schmidt placed an order for
 * 306.90 EUR" — which is not enough to do anything with: whoever read it had to
 * find the dashboard, sign in, search the number and open it before knowing
 * whether it needed attention today. Most of that is answered by what was
 * ordered and how it is being paid for, so both are here, and the button
 * removes the searching.
 */
export const notifyStaffOfOrder = async (
	input: OrderSummary & {
		locale: LocaleCode
		orderId: string
		orderNumber: string
		customerName: string
		customerEmail?: string | null
		paymentTitle?: string | null
		/** Previews and test sends only — see `notifyStaff`. */
		to?: string
	}
): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)
	const total = `${input.grandTotal} ${input.currency}`

	const details = [
		{ label: L("staff.newOrder.customer"), value: input.customerName },
		...(input.customerEmail ? [{ label: L("staff.newOrder.email"), value: input.customerEmail }] : []),
		...(input.paymentTitle ? [{ label: L("email.payment"), value: input.paymentTitle }] : []),
	]

	await notifyStaff({
		kind: "staff-new-order",
		locale: input.locale,
		subject: L("staff.newOrder.subject", { number: input.orderNumber }),
		title: L("staff.newOrder.title", { number: input.orderNumber }),
		intro: L("staff.newOrder.intro", { name: input.customerName, total }),
		bodyHtml: rowsTable(details) + orderTableHtml(input, L),
		textLines: [
			...details.map((d) => `${d.label}: ${d.value}`),
			"",
			...orderTextLines(input, L),
		],
		action: {
			label: L("staff.newOrder.action"),
			url: adminUrl(`/dashboard/orders/${input.orderId}`),
		},
		...(input.to ? { to: input.to } : {}),
	})
}

/**
 * Tells staff a customer has attached a drawing to an order already placed.
 *
 * The link goes to the order in the dashboard rather than to the file, so the
 * message can be read an hour later and forwarded without handing the artwork
 * to whoever it reaches. The download sits on that screen already.
 */
export const notifyStaffOfArtwork = async (input: {
	locale: LocaleCode
	orderId: string
	orderNumber: string
	customerName: string
	fileNames: string[]
	lineName: string
	/** Previews and test sends only — see notifyStaff. */
	to?: string
}): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	await notifyStaff({
		kind: "staff-order-artwork",
		locale: input.locale,
		subject: L("staff.orderArtwork.subject", { number: input.orderNumber }),
		title: L("staff.orderArtwork.title", { number: input.orderNumber }),
		intro: L("staff.orderArtwork.intro", {
			name: input.customerName,
			number: input.orderNumber,
			line: input.lineName,
			files: input.fileNames.join(", "),
		}),
		action: {
			label: L("staff.orderArtwork.action"),
			url: adminUrl(`/dashboard/orders/${input.orderId}`),
		},
		...(input.to ? { to: input.to } : {}),
	})
}
