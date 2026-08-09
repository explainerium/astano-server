import { env } from "../../config"
import type { LocaleCode } from "../../config/locales"
import { t } from "../../i18n"
import type { BankAccount } from "../../domain/payment/bankAccounts"
import { SettingService } from "../../app/modules/setting/setting.service"
import { EmailService } from "../../app/modules/email/email.service"
import type { EmailKind } from "../../app/modules/email/emailRegistry"
import { esc, renderLayout, rowsTable, toPlainText } from "./layout"
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

const url = (path: string): string => `${env.PUBLIC_BASE_URL}${path}`

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
const bankAccountsHtml = (accounts: BankAccount[], L: (key: string) => string): string => {
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
			].filter(([, value]) => Boolean(value)) as [string, string][]

			const heading = account.label
				? `<p style="margin:16px 0 4px;font-size:13px;font-weight:600;">${esc(account.label)}</p>`
				: ""

			return heading + rowsTable(rows.map(([label, value]) => ({ label, value })))
		})
		.join("")
}

export const sendOrderConfirmation = async (input: OrderMailInput): Promise<void> => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	const itemsHtml = rowsTable([
		...input.items.map((i) => ({
			label: `${i.quantity} × ${i.name}`,
			value: `${i.lineTotal} ${input.currency}`,
		})),
		{ label: L("email.subtotal"), value: `${input.subtotal} ${input.currency}` },
		{ label: L("email.shipping"), value: `${input.shippingTotal} ${input.currency}` },
		{ label: L("email.tax"), value: `${input.taxTotal} ${input.currency}` },
		{ label: L("email.total"), value: `${input.grandTotal} ${input.currency}`, strong: true },
	])

	const accounts = input.bankAccounts ?? []

	const paymentHtml =
		input.paymentInstructions || accounts.length
			? `<h2 style="margin:28px 0 8px;font-size:16px;">${esc(input.paymentTitle ?? L("email.payment"))}</h2>` +
				(input.paymentInstructions
					? `<p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-line;">${esc(input.paymentInstructions)}</p>`
					: "") +
				bankAccountsHtml(accounts, L)
			: ""

	await dispatch("order-placed", {
		to: input.to,
		locale: input.locale,
		messages: "email.orderPlaced",
		vars: { number: input.orderNumber, name: input.customerName, total: `${input.grandTotal} ${input.currency}` },
		intro: L("email.orderPlaced.intro", { name: input.customerName }),
		bodyHtml: itemsHtml + paymentHtml,
		textLines: [
			...input.items.map((i) => `${i.quantity} × ${i.name} — ${i.lineTotal} ${input.currency}`),
			`${L("email.total")}: ${input.grandTotal} ${input.currency}`,
			...(input.paymentInstructions ? ["", input.paymentInstructions] : []),
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
				].filter(Boolean)
			),
		],
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
	const link = url(`/reset-password?token=${input.token}`)

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
 * Tells staff something has landed.
 *
 * The caller passes the kind rather than a recipient: which address it goes to
 * is the admin's setting, not the caller's business, and routing it here is
 * what lets low-stock warnings reach whoever actually reorders.
 */
export const notifyStaff = async (input: {
	kind: Extract<
		EmailKind,
		"staff-new-order" | "staff-new-quote" | "staff-new-contact" | "staff-b2b-application" | "staff-low-stock"
	>
	locale: LocaleCode
	subject: string
	title: string
	intro: string
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
				bodyHtml: "",
				company,
				branding: prepared.branding,
				additionalContent: prepared.additionalContent,
			}),
			text: toPlainText(prepared.heading ?? input.title, input.intro, []),
		},
		{ kind: input.kind }
	)
}
