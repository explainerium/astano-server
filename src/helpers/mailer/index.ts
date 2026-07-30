import { env } from "../../config"
import type { LocaleCode } from "../../config/locales"
import { t } from "../../i18n"
import { SettingService } from "../../app/modules/setting/setting.service"
import { esc, renderLayout, rowsTable, toPlainText } from "./layout"
import { sendMail } from "./transport"

export { isConfigured } from "./transport"

/**
 * Transactional email.
 *
 * Every message is composed in the recipient's own locale — an order placed in
 * German stays German forever, which is why `locale` is frozen onto the order
 * rather than read from the current request.
 */

const url = (path: string): string => `${env.PUBLIC_BASE_URL}${path}`

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
}

export const sendOrderConfirmation = async (input: OrderMailInput): Promise<void> => {
	const company = await SettingService.getCompany()
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	const title = L("email.orderPlaced.title", { number: input.orderNumber })
	const intro = L("email.orderPlaced.intro", { name: input.customerName })

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

	const paymentHtml = input.paymentInstructions
		? `<h2 style="margin:28px 0 8px;font-size:16px;">${esc(input.paymentTitle ?? L("email.payment"))}</h2>
       <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-line;">${esc(input.paymentInstructions)}</p>`
		: ""

	sendMail(
		{
			to: input.to,
			subject: L("email.orderPlaced.subject", { number: input.orderNumber }),
			html: renderLayout({ title, intro, bodyHtml: itemsHtml + paymentHtml, company }),
			text: toPlainText(title, intro, [
				...input.items.map((i) => `${i.quantity} × ${i.name} — ${i.lineTotal} ${input.currency}`),
				`${L("email.total")}: ${input.grandTotal} ${input.currency}`,
				...(input.paymentInstructions ? ["", input.paymentInstructions] : []),
			]),
			replyTo: company.email || undefined,
		},
		{ orderNumber: input.orderNumber }
	)
}

export const sendOrderStatusChanged = async (input: {
	to: string
	locale: LocaleCode
	orderNumber: string
	customerName: string
	status: string
}): Promise<void> => {
	const company = await SettingService.getCompany()
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	const statusLabel = L(`orderStatus.${input.status}`)
	const title = L("email.orderStatus.title", { number: input.orderNumber })
	const intro = L("email.orderStatus.intro", { name: input.customerName, status: statusLabel })

	sendMail(
		{
			to: input.to,
			subject: L("email.orderStatus.subject", { number: input.orderNumber, status: statusLabel }),
			html: renderLayout({ title, intro, bodyHtml: "", company }),
			text: toPlainText(title, intro, []),
			replyTo: company.email || undefined,
		},
		{ orderNumber: input.orderNumber, status: input.status }
	)
}

export const sendPasswordReset = async (input: {
	to: string
	locale: LocaleCode
	token: string
}): Promise<void> => {
	const company = await SettingService.getCompany()
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	const title = L("email.passwordReset.title")
	const intro = L("email.passwordReset.intro")
	const link = url(`/reset-password?token=${input.token}`)

	sendMail(
		{
			to: input.to,
			subject: L("email.passwordReset.subject"),
			html: renderLayout({
				title,
				intro,
				bodyHtml: `<p style="margin:0;font-size:13px;color:#777;">${esc(L("email.passwordReset.expiry"))}</p>`,
				company,
				action: { label: L("email.passwordReset.action"), url: link },
			}),
			text: toPlainText(title, intro, [link, "", L("email.passwordReset.expiry")]),
		},
		{ kind: "password-reset" }
	)
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
	const company = await SettingService.getCompany()
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	const heading = L("email.quoteSubmitted.title", { number: input.quoteNumber })
	const intro = L("email.quoteSubmitted.intro", { name: input.contactName })

	const itemsHtml = rowsTable(
		input.items.map((i) => ({ label: i.name, value: String(i.quantity) }))
	)

	const link = input.accessToken
		? url(`/quote/${encodeURIComponent(input.accessToken)}`)
		: url("/account/quotes")

	sendMail(
		{
			to: input.to,
			subject: L("email.quoteSubmitted.subject", { number: input.quoteNumber }),
			html: renderLayout({
				title: heading,
				intro,
				bodyHtml: itemsHtml,
				company,
				action: { label: L("email.quoteSubmitted.action"), url: link },
			}),
			text: toPlainText(heading, intro, [
				...input.items.map((i) => `${i.quantity} × ${i.name}`),
				"",
				link,
			]),
			replyTo: company.email || undefined,
		},
		{ quoteNumber: input.quoteNumber }
	)
}

export const sendQuoteAnswered = async (input: {
	to: string
	locale: LocaleCode
	quoteNumber: string
	contactName: string
	accessToken?: string | null
}): Promise<void> => {
	const company = await SettingService.getCompany()
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	const title = L("email.quoteAnswered.title", { number: input.quoteNumber })
	const intro = L("email.quoteAnswered.intro", { name: input.contactName })
	const link = input.accessToken
		? url(`/quote/${encodeURIComponent(input.accessToken)}`)
		: url("/account/quotes")

	sendMail(
		{
			to: input.to,
			subject: L("email.quoteAnswered.subject", { number: input.quoteNumber }),
			html: renderLayout({
				title,
				intro,
				bodyHtml: "",
				company,
				action: { label: L("email.quoteAnswered.action"), url: link },
			}),
			text: toPlainText(title, intro, [link]),
			replyTo: company.email || undefined,
		},
		{ quoteNumber: input.quoteNumber }
	)
}

export const sendAccountDecision = async (input: {
	to: string
	locale: LocaleCode
	name: string
	approved: boolean
}): Promise<void> => {
	const company = await SettingService.getCompany()
	const L = (key: string, vars?: Record<string, string | number>) => t(key, input.locale, vars)

	const key = input.approved ? "email.accountApproved" : "email.accountRejected"
	const title = L(`${key}.title`)
	const intro = L(`${key}.intro`, { name: input.name })

	sendMail(
		{
			to: input.to,
			subject: L(`${key}.subject`),
			html: renderLayout({
				title,
				intro,
				bodyHtml: "",
				company,
				...(input.approved
					? { action: { label: L("email.accountApproved.action"), url: url("/") } }
					: {}),
			}),
			text: toPlainText(title, intro, []),
			replyTo: company.email || undefined,
		},
		{ kind: input.approved ? "account-approved" : "account-rejected" }
	)
}

/** Tells staff a new order or quote has landed. */
export const notifyStaff = async (input: {
	locale: LocaleCode
	subject: string
	title: string
	intro: string
}): Promise<void> => {
	const map = await SettingService.getMap()
	const to = map["mail.adminNotifyAddress"]
	if (!to || typeof to !== "string") return

	const company = await SettingService.getCompany()

	sendMail(
		{
			to,
			subject: input.subject,
			html: renderLayout({ title: input.title, intro: input.intro, bodyHtml: "", company }),
			text: toPlainText(input.title, input.intro, []),
		},
		{ kind: "staff-notification" }
	)
}
