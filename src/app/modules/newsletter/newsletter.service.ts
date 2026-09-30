import { env, shopUrl } from "../../../config"
import type { LocaleCode } from "../../../config/locales"
import { sendMail } from "../../../helpers/mailer/transport"
import { renderLayout, toPlainText } from "../../../helpers/mailer/layout"
import { t } from "../../../i18n"
import { httpStatus } from "../../../shared/httpStatus"
import { logger } from "../../../shared/logger"
import { prisma } from "../../../shared/prisma"
import { generateToken, hashToken } from "../../../shared/token"
import ApiError from "../../errors/ApiError"
import { EmailService } from "../email/email.service"
import { SettingService } from "../setting/setting.service"
import { randomBytes } from "crypto"
import { toReceiver } from "../../../domain/newsletter/cleverreachReceiver"
import {
	callTokenMatches,
	readUnsubscribe,
	verificationAnswer,
} from "../../../domain/newsletter/cleverreachHook"
import {
	getReceiver,
	listGroups,
	registerUnsubscribeHook,
	readConfig,
	UPSERT_BATCH,
	upsertReceivers,
	type CleverReachConfig,
	type CleverReachGroup,
} from "./cleverreach.client"

/**
 * Newsletter signup with DOUBLE OPT-IN.
 *
 * German law (UWG §7) requires confirmed consent before marketing email, so a
 * subscription counts for nothing until the recipient clicks the link. The
 * `confirmedAt` timestamp is also the evidence if consent is ever challenged.
 *
 * Addresses are held here rather than pushed straight to CleverReach so the
 * shop owns its own list — and so signup works before anyone has configured a
 * newsletter provider. Once it is configured, a confirmation or an unsubscribe
 * is copied across as it happens, and `syncedAt` is null on every row whose
 * change CleverReach has not yet heard about.
 */

const sendConfirmation = async (
	email: string,
	name: string | null,
	locale: LocaleCode,
	token: string
): Promise<void> => {
	const company = await SettingService.getCompany()
	// The same logo and colours as every other mail the shop sends.
	const branding = await EmailService.branding()
	const L = (key: string, vars?: Record<string, string | number>) => t(key, locale, vars)

	const title = L("newsletter.confirm.title")
	const intro = L("newsletter.confirm.intro", { name: name ?? "" })
	// The shop's page, not this API: a person clicks it. It was built from
	// PUBLIC_BASE_URL and a path the API does not serve, so every confirmation
	// link answered 404 — see config/shopLinks.
	const confirmUrl = shopUrl("newsletterConfirm", locale, { token })

	sendMail(
		{
			to: email,
			subject: L("newsletter.confirm.subject"),
			html: renderLayout({
				title,
				intro,
				bodyHtml: `<p style="margin:0;font-size:13px;color:#777;">${L("newsletter.confirm.ignore")}</p>`,
				company,
				branding,
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
			syncedAt: null,
		},
	})

	logger.info({ email: row.email }, "newsletter subscription confirmed")
	await pushOne(row.id)

	return { email: row.email }
}

const unsubscribe = async (token: string): Promise<void> => {
	const row = await prisma.newsletterSubscriber.findUnique({
		where: { unsubscribeTokenHash: hashToken(token) },
	})

	// Unsubscribing must always appear to work. Telling someone their link is
	// invalid when they are trying to leave is the one moment to be generous.
	if (!row) return

	await leave(row.id)
}

/** Takes one address off the list, here and — if connected — in CleverReach. */
const leave = async (id: string): Promise<void> => {
	await prisma.newsletterSubscriber.update({
		where: { id },
		data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date(), syncedAt: null },
	})

	await pushOne(id)
}

/**
 * Staff taking somebody off the list — "please stop sending me that" by phone
 * or email. Only ever this direction: putting an address back needs the
 * person's own confirmation, which no button here can give.
 */
const adminUnsubscribe = async (id: string) => {
	const row = await prisma.newsletterSubscriber.findUnique({ where: { id }, select: { id: true, status: true } })

	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "That subscriber does not exist", {
			messageKey: "newsletter.notFound",
		})
	}

	if (row.status !== "UNSUBSCRIBED") await leave(row.id)

	return prisma.newsletterSubscriber.findUnique({ where: { id }, select: { id: true, status: true, syncedAt: true } })
}

/** How many there are of each status, for the boxes above the list. */
const counts = async (): Promise<Record<"CONFIRMED" | "PENDING" | "UNSUBSCRIBED", number>> => {
	const rows = await prisma.newsletterSubscriber.groupBy({ by: ["status"], _count: { _all: true } })
	const of = (status: string) => rows.find((r) => r.status === status)?._count._all ?? 0

	return { CONFIRMED: of("CONFIRMED"), PENDING: of("PENDING"), UNSUBSCRIBED: of("UNSUBSCRIBED") }
}

// ── CleverReach ──────────────────────────────────────────────────────────────

const isComplete = (config: CleverReachConfig) =>
	config.enabled && !!config.clientId && !!config.clientSecret && !!config.groupId

/**
 * Clears every "sent" mark when the group in use has changed.
 *
 * `syncedAt` means "CleverReach's group has this", and it was true of the
 * group it was sent to. Moving from the test list to the real one without
 * this would leave the real one holding only people who sign up afterwards.
 * Run before anything reads or writes `syncedAt`.
 */
const ensureGroupCurrent = async (config: CleverReachConfig): Promise<void> => {
	if (!config.groupId) return

	const sentTo = String((await SettingService.read<string>("cleverreach.syncedGroupId")) ?? "")
	if (sentTo === config.groupId) return

	await prisma.newsletterSubscriber.updateMany({ where: { syncedAt: { not: null } }, data: { syncedAt: null } })
	await SettingService.setMany([{ key: "cleverreach.syncedGroupId", value: config.groupId }])
	logger.info({ from: sentTo || null, to: config.groupId }, "CleverReach group changed; every subscriber will be sent again")
}

const receiverSelect = {
	id: true,
	email: true,
	status: true,
	locale: true,
	source: true,
	createdAt: true,
	confirmedAt: true,
	unsubscribedAt: true,
} as const

/**
 * Copies one subscriber's change to CleverReach, if it is switched on.
 *
 * Awaited, but never allowed to fail the request: the person clicking
 * "confirm" has done their part, and a CleverReach outage is not theirs to
 * hear about. A failure leaves `syncedAt` null, and "Sync now" in the
 * dashboard sends it later.
 */
const pushOne = async (id: string): Promise<void> => {
	try {
		const config = await readConfig()
		if (!isComplete(config)) return
		await ensureGroupCurrent(config)

		const row = await prisma.newsletterSubscriber.findUnique({ where: { id }, select: receiverSelect })
		const receiver = row && toReceiver(row)
		if (!receiver) return

		await upsertReceivers(config, [receiver])
		await prisma.newsletterSubscriber.update({ where: { id }, data: { syncedAt: new Date() } })
	} catch (error) {
		logger.warn({ err: error, id }, "CleverReach sync failed; left for the next sync")
	}
}

/** What the dashboard shows about the connection. Carries no credential. */
const cleverReachStatus = async () => {
	const config = await readConfig()
	await ensureGroupCurrent(config)
	const waiting = await prisma.newsletterSubscriber.count({
		where: { syncedAt: null, status: { in: ["CONFIRMED", "UNSUBSCRIBED"] }, confirmedAt: { not: null } },
	})

	const [callToken, hookGroup] = await Promise.all([
		SettingService.readSecret("cleverreach.webhookCallToken"),
		SettingService.read<string>("cleverreach.webhookGroupId"),
	])

	return {
		enabled: config.enabled,
		configured: !!config.clientId && !!config.clientSecret,
		groupId: config.groupId,
		/// Confirmed or unsubscribed rows CleverReach has not heard about yet.
		waiting,
		/// Whether CleverReach tells the shop about unsubscribes from its own
		/// mails — and for the group in use now, not one chosen before.
		webhook: !callToken ? "none" : String(hookGroup) === config.groupId ? "connected" : "otherGroup",
	}
}

/** Where CleverReach calls. The API's own origin: this is a machine calling. */
const hookUrl = () => `${env.PUBLIC_BASE_URL}/api/v1/newsletter/cleverreach/hook`

/**
 * Registers the unsubscribe webhook for the group in use.
 *
 * CleverReach checks the URL from the internet while this runs, so it cannot
 * work from a laptop: a localhost address is refused here with a sentence
 * saying so, rather than with whatever CleverReach makes of it.
 */
const connectCleverReachHook = async (): Promise<{ ok: boolean; message: string }> => {
	const config = await readConfig()

	if (!config.clientId || !config.clientSecret || !config.groupId) {
		return { ok: false, message: "Save the Client ID, the secret and a group first." }
	}
	if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(env.PUBLIC_BASE_URL)) {
		return {
			ok: false,
			message: `This server is ${env.PUBLIC_BASE_URL}, which CleverReach cannot reach. Connect the webhook from the live dashboard.`,
		}
	}

	// Stored before registering: CleverReach asks for it back mid-registration.
	const verify = randomBytes(20).toString("hex")
	await SettingService.setMany([{ key: "cleverreach.webhookVerify", value: verify }])

	try {
		const { callToken } = await registerUnsubscribeHook(config, {
			url: hookUrl(),
			groupId: config.groupId,
			verify,
		})

		await SettingService.setMany([
			{ key: "cleverreach.webhookCallToken", value: callToken },
			{ key: "cleverreach.webhookGroupId", value: config.groupId },
		])

		return { ok: true, message: "Connected. Unsubscribes from CleverReach mails now show here." }
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : "CleverReach refused the webhook.",
		}
	}
}

/** CleverReach's verification GET. Null when nothing is being registered. */
const answerHookVerification = async (secret: string): Promise<string | null> => {
	const verify = await SettingService.readSecret("cleverreach.webhookVerify")
	return verify && secret ? verificationAnswer(verify, secret) : null
}

/**
 * A call from CleverReach: somebody left the list from one of its mails.
 *
 * Marked unsubscribed here with `syncedAt` set, because CleverReach is where it
 * happened and pushing it back would only repeat it. Only for the group in
 * use, only when CleverReach itself says the receiver is inactive, and only a
 * confirmed row: nothing here can put anybody back on the list.
 *
 * Returns false when the call token is wrong, so the route can answer 401.
 */
const handleCleverReachHook = async (callToken: unknown, body: unknown): Promise<boolean> => {
	const expected = await SettingService.readSecret("cleverreach.webhookCallToken")
	if (!callTokenMatches(expected, callToken)) return false

	const event = readUnsubscribe(body)
	if (!event) return true

	try {
		const config = await readConfig()
		if (event.groupId !== config.groupId) return true

		const receiver = await getReceiver(config, event.groupId, event.poolId)
		if (!receiver.email || (receiver.active && !receiver.deactivated)) return true

		const now = new Date()
		const { count } = await prisma.newsletterSubscriber.updateMany({
			where: { email: receiver.email.toLowerCase(), status: "CONFIRMED" },
			data: { status: "UNSUBSCRIBED", unsubscribedAt: now, syncedAt: now },
		})
		logger.info({ poolId: event.poolId, count }, "unsubscribed from a CleverReach mail")
	} catch (error) {
		// Answered 200 regardless: a retry would fail the same way, and the
		// address is off the list in CleverReach, which is what sends mail.
		logger.warn({ err: error, poolId: event.poolId }, "CleverReach unsubscribe could not be applied")
	}

	return true
}

/**
 * Logs in and lists the account's groups.
 *
 * Proves the id and secret, and answers the question the next field asks —
 * which group — in the same step. 200 either way, with CleverReach's own
 * sentence on failure: see the AI key test for why.
 */
const testCleverReach = async (): Promise<{
	ok: boolean
	message: string
	groups: CleverReachGroup[]
}> => {
	const config = await readConfig()

	if (!config.clientId || !config.clientSecret) {
		return { ok: false, message: "Client ID and Client Secret are not both stored yet.", groups: [] }
	}

	try {
		const groups = await listGroups(config)
		const chosen = groups.find((g) => String(g.id) === config.groupId)

		return {
			ok: true,
			message: chosen
				? `Connected. Subscribers go into “${chosen.name}”.`
				: config.groupId
					? `Connected, but there is no group ${config.groupId} in this account.`
					: "Connected. Now choose the group subscribers should go into.",
			groups,
		}
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : "CleverReach could not be reached.",
			groups: [],
		}
	}
}

/**
 * Sends every change CleverReach has not heard about.
 *
 * The first run carries the whole confirmed list — everyone who signed up
 * before the connection existed. After that it only picks up what a failed
 * `pushOne` left behind. Stops at the first refusal and says why, rather than
 * repeating the same error once per batch.
 */
const syncCleverReach = async (): Promise<{ sent: number; message: string | null }> => {
	const config = await readConfig()

	if (!isComplete(config)) {
		return { sent: 0, message: "CleverReach is not switched on, or the ID, secret or group is missing." }
	}
	await ensureGroupCurrent(config)

	let sent = 0

	for (;;) {
		const rows = await prisma.newsletterSubscriber.findMany({
			where: { syncedAt: null, status: { in: ["CONFIRMED", "UNSUBSCRIBED"] }, confirmedAt: { not: null } },
			select: receiverSelect,
			orderBy: { createdAt: "asc" },
			take: UPSERT_BATCH,
		})
		if (!rows.length) break

		const receivers = rows.flatMap((row) => {
			const receiver = toReceiver(row)
			return receiver ? [receiver] : []
		})

		try {
			await upsertReceivers(config, receivers)
		} catch (error) {
			return { sent, message: error instanceof Error ? error.message : "CleverReach refused the list." }
		}

		await prisma.newsletterSubscriber.updateMany({
			where: { id: { in: rows.map((row) => row.id) } },
			data: { syncedAt: new Date() },
		})
		sent += rows.length
	}

	return { sent, message: null }
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
				syncedAt: true,
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

export const NewsletterService = {
	subscribe,
	confirm,
	unsubscribe,
	list,
	counts,
	adminUnsubscribe,
	cleverReachStatus,
	testCleverReach,
	connectCleverReachHook,
	answerHookVerification,
	handleCleverReachHook,
	syncCleverReach,
}
