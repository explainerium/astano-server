import { env } from "../../../config"
import type { LocaleCode } from "../../../config/locales"
import { sendMail } from "../../../helpers/mailer/transport"
import { renderLayout, toPlainText } from "../../../helpers/mailer/layout"
import { t } from "../../../i18n"
import { httpStatus } from "../../../shared/httpStatus"
import { logger } from "../../../shared/logger"
import { prisma } from "../../../shared/prisma"
import { generateToken, hashToken } from "../../../shared/token"
import ApiError from "../../errors/ApiError"
import { SettingService } from "../setting/setting.service"

/**
 * Newsletter signup with DOUBLE OPT-IN.
 *
 * German law (UWG §7) requires confirmed consent before marketing email, so a
 * subscription counts for nothing until the recipient clicks the link. The
 * `confirmedAt` timestamp is also the evidence if consent is ever challenged.
 *
 * Addresses are held here rather than pushed straight to CleverReach so the
 * shop owns its own list — and so signup works before anyone has configured a
 * newsletter provider.
 */

const url = (path: string): string => `${env.PUBLIC_BASE_URL}${path}`

const sendConfirmation = async (
	email: string,
	name: string | null,
	locale: LocaleCode,
	token: string
): Promise<void> => {
	const company = await SettingService.getCompany()
	const L = (key: string, vars?: Record<string, string | number>) => t(key, locale, vars)

	const title = L("newsletter.confirm.title")
	const intro = L("newsletter.confirm.intro", { name: name ?? "" })
	const confirmUrl = url(`/newsletter/confirm?token=${token}`)

	sendMail(
		{
			to: email,
			subject: L("newsletter.confirm.subject"),
			html: renderLayout({
				title,
				intro,
				bodyHtml: `<p style="margin:0;font-size:13px;color:#777;">${L("newsletter.confirm.ignore")}</p>`,
				company,
				action: { label: L("newsletter.confirm.action"), url: confirmUrl },
			}),
			text: toPlainText(title, intro, [confirmUrl]),
		},
		{
			kind: "newsletter-confirm",
			// Without SMTP the mailer logs only recipient and subject, so the link
			// — which lives inside the HTML — would be unreachable and double
			// opt-in untestable locally. Logged in development only.
			...(env.NODE_ENV === "development" ? { confirmUrl } : {}),
		}
	)
}

const subscribe = async (
	payload: { email: string; name?: string; source?: string },
	locale: LocaleCode
): Promise<{ status: string }> => {
	const existing = await prisma.newsletterSubscriber.findUnique({
		where: { email: payload.email },
	})

	// Already confirmed: say nothing that reveals it. Whether an address is on a
	// mailing list is not for a stranger to learn by typing it into a form.
	if (existing?.status === "CONFIRMED") {
		return { status: "ok" }
	}

	const confirmToken = generateToken()

	await prisma.newsletterSubscriber.upsert({
		where: { email: payload.email },
		create: {
			email: payload.email,
			name: payload.name ?? null,
			locale,
			status: "PENDING",
			confirmTokenHash: hashToken(confirmToken),
			confirmSentAt: new Date(),
			unsubscribeTokenHash: hashToken(generateToken()),
			source: payload.source ?? null,
		},
		update: {
			name: payload.name ?? existing?.name ?? null,
			locale,
			status: "PENDING",
			confirmTokenHash: hashToken(confirmToken),
			confirmSentAt: new Date(),
		},
	})

	await sendConfirmation(payload.email, payload.name ?? null, locale, confirmToken)

	return { status: "ok" }
}

const confirm = async (token: string): Promise<{ email: string }> => {
	const row = await prisma.newsletterSubscriber.findUnique({
		where: { confirmTokenHash: hashToken(token) },
	})

	if (!row) {
		throw new ApiError(httpStatus.BAD_REQUEST, "That confirmation link is not valid", {
			messageKey: "newsletter.invalidToken",
		})
	}

	if (row.status === "CONFIRMED") return { email: row.email }

	await prisma.newsletterSubscriber.update({
		where: { id: row.id },
		data: {
			status: "CONFIRMED",
			confirmedAt: new Date(),
			// One-use link.
			confirmTokenHash: null,
		},
	})

	// TODO: push to CleverReach once the client supplies API credentials. The
	// list is owned here either way, so nothing is lost by that being pending.
	logger.info({ email: row.email }, "newsletter subscription confirmed")

	return { email: row.email }
}

const unsubscribe = async (token: string): Promise<void> => {
	const row = await prisma.newsletterSubscriber.findUnique({
		where: { unsubscribeTokenHash: hashToken(token) },
	})

	// Unsubscribing must always appear to work. Telling someone their link is
	// invalid when they are trying to leave is the one moment to be generous.
	if (!row) return

	await prisma.newsletterSubscriber.update({
		where: { id: row.id },
		data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
	})
}

const list = async (params: { status?: string; page: number; limit: number }) => {
	const where = params.status ? { status: params.status as never } : {}

	const [rows, total] = await Promise.all([
		prisma.newsletterSubscriber.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip: (params.page - 1) * params.limit,
			take: params.limit,
			select: {
				id: true,
				email: true,
				name: true,
				status: true,
				locale: true,
				source: true,
				confirmedAt: true,
				createdAt: true,
			},
		}),
		prisma.newsletterSubscriber.count({ where }),
	])

	return {
		data: rows,
		meta: {
			page: params.page,
			limit: params.limit,
			total,
			totalPages: Math.ceil(total / params.limit) || 1,
		},
	}
}

export const NewsletterService = { subscribe, confirm, unsubscribe, list }
