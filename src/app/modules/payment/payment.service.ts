// Prisma is imported as a value, not a type: JsonNull is a runtime sentinel.
import { Prisma } from "@prisma/client"
import type { UserRole } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { readBankAccounts } from "../../../domain/payment/bankAccounts"
import { DEFAULT_RULES, OFFLINE_METHODS } from "../../../domain/payment/offlineMethods"
import { previousOrdersWhere } from "../../../domain/payment/orderHistory"
import { evaluateMethods } from "../../../domain/payment/gatewayEligibility"
import { effectiveRole } from "../../../domain/pricing/effectiveRole"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"

const include = { translations: true } satisfies Prisma.PaymentMethodInclude
type MethodRow = Prisma.PaymentMethodGetPayload<{ include: typeof include }>

const pick = <T extends { locale: string }>(rows: T[], locale: LocaleCode): T | undefined =>
	rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === DEFAULT_LOCALE) ?? rows[0]

/** Admin view — includes the rules and the raw config. */
const adminView = (row: MethodRow, locale: LocaleCode) => ({
	id: row.id,
	code: row.code,
	type: row.type,
	isActive: row.isActive,
	sortOrder: row.sortOrder,
	title: pick(row.translations, locale)?.title ?? row.code,
	translations: row.translations,
	rules: {
		allowedCountries: row.allowedCountries,
		allowedRoles: row.allowedRoles,
		requiresLogin: row.requiresLogin,
		minCompletedOrders: row.minCompletedOrders,
		historyExemptRoles: row.historyExemptRoles,
		minOrderTotal: row.minOrderTotal?.toString() ?? null,
		maxOrderTotal: row.maxOrderTotal?.toString() ?? null,
		conditionalAboveTotal: row.conditionalAboveTotal?.toString() ?? null,
		requiresValidatedVatId: row.requiresValidatedVatId,
	},
	config: row.config,
	/**
	 * One of the three fixed kinds, rather than a leftover from the old
	 * "create a method and pick a type" builder.
	 *
	 * A built-in cannot be deleted — switching it off is how you retire one. A
	 * leftover can be, provided nothing has been bought with it, because
	 * otherwise a shop that experimented with the old builder is stuck looking
	 * at two bank transfers forever.
	 */
	isBuiltIn: OFFLINE_METHODS.some((definition) => definition.code === row.code),
	createdAt: row.createdAt,
})

/**
 * Customer view.
 *
 * `config` as a whole stays out — it is a free-form settings blob that might
 * hold anything. `bankAccounts` is lifted out of it deliberately, because those
 * details exist for precisely one purpose: telling the customer where to send
 * the money. Keeping them buried would mean the shop typing the same IBAN a
 * second time into a text field, and the two drifting apart.
 */
const publicView = (row: MethodRow, locale: LocaleCode) => {
	const t = pick(row.translations, locale)
	return {
		id: row.id,
		code: row.code,
		type: row.type,
		title: t?.title ?? row.code,
		description: t?.description ?? null,
		instructions: t?.instructions ?? null,
		/** What "conditional" means here, in the shop's words. See the schema. */
		conditionalNotice: t?.conditionalNotice ?? null,
		bankAccounts: readBankAccounts(row.config),

		/*
		 * The value window, so the storefront can say what the limit is rather
		 * than only that one was hit.
		 *
		 * "Not available for this order" tells a customer nothing they can act
		 * on; "available up to €10,000" tells them whether to split the order,
		 * pay another way, or call. The rules are printed on the page anyway —
		 * see the note on the eligibility payload — so nothing is revealed here
		 * that the checkout does not already state in words.
		 */
		minOrderTotal: row.minOrderTotal?.toString() ?? null,
		maxOrderTotal: row.maxOrderTotal?.toString() ?? null,
		conditionalAboveTotal: row.conditionalAboveTotal?.toString() ?? null,
	}
}

const notFound = () =>
	new ApiError(httpStatus.NOT_FOUND, "Payment method not found", {
		messageKey: "payment.notFound",
	})

/**
 * Creates any of the three fixed kinds that are not in the database yet.
 *
 * Called at startup, not lazily from whichever screen happens to be opened
 * first. An earlier version materialised these inside the admin `list()`, which
 * meant a shop whose staff had not yet opened the payments screen served a
 * checkout with **no payment methods at all** — the customer-facing path reads
 * the table directly and had nothing to read.
 *
 * Idempotent and cheap: one count when everything is already there.
 *
 * Rows that predate the registry are left alone. A shop that has already taken
 * orders through a custom method must not have it vanish.
 */
const ensureOfflineMethods = async (): Promise<number> => {
	const existing = await prisma.paymentMethod.findMany({ select: { code: true } })
	const known = new Set(existing.map((row) => row.code))

	const missing = OFFLINE_METHODS.filter((definition) => !known.has(definition.code))
	if (!missing.length) return 0

	await prisma.$transaction(
		missing.map((definition) =>
			prisma.paymentMethod.create({
				data: {
					code: definition.code,
					type: definition.type,
					isActive: definition.activeByDefault,
					sortOrder: definition.sortOrder,
					...(DEFAULT_RULES[definition.code] ?? {}),
					translations: { create: definition.translations },
				},
			})
		)
	)

	return missing.length
}

/**
 * Every offline method, always all of them.
 *
 * The kinds are fixed, so this is a plain read — `ensureOfflineMethods` has
 * already run at startup. It is called again here as a safety net for the one
 * case startup cannot cover: a release that adds a kind to the registry while
 * an old process is still serving.
 */
const list = async (locale: LocaleCode) => {
	await ensureOfflineMethods()

	const rows = await prisma.paymentMethod.findMany({ include, orderBy: { sortOrder: "asc" } })
	return rows.map((row) => adminView(row, locale))
}

const getById = async (id: string, locale: LocaleCode) => {
	const row = await prisma.paymentMethod.findUnique({ where: { id }, include })
	if (!row) throw notFound()
	return adminView(row, locale)
}

const update = async (id: string, payload: Record<string, unknown>, locale: LocaleCode) => {
	if (!(await prisma.paymentMethod.findUnique({ where: { id } }))) throw notFound()

	await prisma.$transaction(async (tx) => {
		await tx.paymentMethod.update({
			where: { id },
			data: {
				// code and type are deliberately absent. A method's kind is what it is;
				// editing it would silently change how checkout, the thank-you page and
				// the invoice treat orders already placed against it.
				...(payload.isActive !== undefined ? { isActive: payload.isActive as boolean } : {}),
				...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder as number } : {}),
				...(payload.allowedCountries !== undefined ? { allowedCountries: payload.allowedCountries as string[] } : {}),
				...(payload.allowedRoles !== undefined ? { allowedRoles: payload.allowedRoles as UserRole[] } : {}),
				...(payload.requiresLogin !== undefined ? { requiresLogin: payload.requiresLogin as boolean } : {}),
				...(payload.minCompletedOrders !== undefined ? { minCompletedOrders: payload.minCompletedOrders as number } : {}),
				...(payload.historyExemptRoles !== undefined ? { historyExemptRoles: payload.historyExemptRoles as UserRole[] } : {}),
				...(payload.minOrderTotal !== undefined ? { minOrderTotal: payload.minOrderTotal != null ? String(payload.minOrderTotal) : null } : {}),
				...(payload.maxOrderTotal !== undefined ? { maxOrderTotal: payload.maxOrderTotal != null ? String(payload.maxOrderTotal) : null } : {}),
				...(payload.conditionalAboveTotal !== undefined ? { conditionalAboveTotal: payload.conditionalAboveTotal != null ? String(payload.conditionalAboveTotal) : null } : {}),
				...(payload.requiresValidatedVatId !== undefined ? { requiresValidatedVatId: payload.requiresValidatedVatId as boolean } : {}),
				...(payload.config !== undefined ? { config: (payload.config as Prisma.InputJsonValue) ?? Prisma.JsonNull } : {}),
			},
		})

		for (const t of (payload.translations ?? []) as {
			locale: string
			title: string
			description?: string
			instructions?: string
			conditionalNotice?: string
		}[]) {
			await tx.paymentMethodTranslation.upsert({
				where: { methodId_locale: { methodId: id, locale: t.locale } },
				create: {
					methodId: id,
					locale: t.locale,
					title: t.title,
					description: t.description ?? null,
					instructions: t.instructions ?? null,
					conditionalNotice: t.conditionalNotice ?? null,
				},
				update: {
					title: t.title,
					description: t.description ?? null,
					instructions: t.instructions ?? null,
					conditionalNotice: t.conditionalNotice ?? null,
				},
			})
		}
	})

	return getById(id, locale)
}

/**
 * Which methods this specific customer may use, with the reason for each one
 * that is unavailable — so support can answer "why can't I pay by invoice?"
 * from the API rather than by reading code.
 */
const available = async (
	ctx: {
		userId?: string
		role?: string
		countryCode?: string
		orderTotal: number
	},
	locale: LocaleCode
) => {
	const rows = await prisma.paymentMethod.findMany({ include, orderBy: { sortOrder: "asc" } })

	let completedOrders = 0
	let hasValidatedVatId = false
	/*
	 * Guest until the account says otherwise.
	 *
	 * The caller passes the role off the access token, which is the *stored*
	 * role and says nothing about whether the account has been approved. A B2B
	 * registration creates a RESELLER row immediately and waits on a person, so
	 * a token minted in between would satisfy a reseller-only payment method.
	 * Resolved below from the account itself, exactly as prices are.
	 */
	let role: string | null = null
	const billingCountry = ctx.countryCode ?? null

	if (ctx.userId) {
		/*
		 * Counted, not assumed to be zero.
		 *
		 * This used to return 0 for everybody with a note saying order history had
		 * not landed yet. It has: checkout's own quote counts it properly, which
		 * left the two disagreeing — this endpoint told a returning customer that
		 * payment by invoice was unavailable while the checkout offered it, and the
		 * quote-acceptance screen, which reads only this one, refused it outright.
		 */
		const [user, completed] = await Promise.all([
			prisma.user.findUnique({ where: { id: ctx.userId } }),
			prisma.order.count({ where: previousOrdersWhere(ctx.userId) }),
		])

		hasValidatedVatId = user?.vatValidated ?? false
		completedOrders = completed
		role = effectiveRole(user?.role, user?.status)
	}

	const verdicts = evaluateMethods(
		rows.map((r) => ({
			id: r.id,
			code: r.code,
			isActive: r.isActive,
			sortOrder: r.sortOrder,
			allowedCountries: r.allowedCountries,
			allowedRoles: r.allowedRoles,
			requiresLogin: r.requiresLogin,
			minCompletedOrders: r.minCompletedOrders,
			historyExemptRoles: r.historyExemptRoles,
			minOrderTotal: r.minOrderTotal?.toString() ?? null,
			maxOrderTotal: r.maxOrderTotal?.toString() ?? null,
			conditionalAboveTotal: r.conditionalAboveTotal?.toString() ?? null,
			requiresValidatedVatId: r.requiresValidatedVatId,
		})),
		{
			isLoggedIn: Boolean(ctx.userId),
			role,
			billingCountry,
			completedOrders,
			orderTotal: ctx.orderTotal,
			hasValidatedVatId,
		}
	)

	const byId = new Map(rows.map((r) => [r.id, r]))

	/*
	 * Every active method, with its title, eligible or not.
	 *
	 * An earlier version returned only an id and a code for the ineligible ones,
	 * which meant the checkout could not name them — so they rendered as blank
	 * rows or had to be hidden. Hiding them is worse than showing them: a
	 * customer who cannot see "Payment by invoice" at all has no way to learn it
	 * exists, whereas one who sees it greyed out with a reason knows what to do
	 * about it. Nothing here is secret; the rules are printed on the page.
	 */
	return verdicts.map((v) => ({
		...publicView(byId.get(v.methodId)!, locale),
		eligible: v.eligible,
		...(v.reason ? { reason: v.reason } : {}),
		...(v.conditional ? { conditional: true } : {}),
	}))
}

/**
 * Removes a leftover from the old builder.
 *
 * Nothing is created any more, so this only ever cleans up: a row somebody made
 * back when the admin offered "new payment method", now sitting beside the
 * built-in kind it duplicates.
 *
 * Two refusals. A built-in kind is never deleted — switching it off is how you
 * retire one, and deleting it would only have it reappear on the next read. A
 * method that has taken an order is never deleted either: the order keeps a
 * frozen copy of the title and instructions, but the link is what a refund or a
 * query is traced through.
 */
const remove = async (id: string): Promise<void> => {
	const row = await prisma.paymentMethod.findUnique({ where: { id } })
	if (!row) throw notFound()

	if (OFFLINE_METHODS.some((definition) => definition.code === row.code)) {
		throw new ApiError(httpStatus.CONFLICT, "This is a standard method — switch it off instead", {
			messageKey: "payment.builtIn",
		})
	}

	const used = await prisma.order.count({ where: { paymentMethodId: id } })
	if (used > 0) {
		throw new ApiError(
			httpStatus.CONFLICT,
			`${used} order(s) were paid this way — switch it off instead`,
			{ messageKey: "payment.inUse" }
		)
	}

	await prisma.paymentMethod.delete({ where: { id } })
}

/*
 * No create. The offline kinds are a fixed set materialised by list(), so there
 * is nothing to make — only the three to configure, and the occasional leftover
 * to clear away.
 */
export const PaymentService = { ensureOfflineMethods, list, getById, update, remove, available }
