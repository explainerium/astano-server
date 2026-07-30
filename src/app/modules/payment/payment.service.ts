// Prisma is imported as a value, not a type: JsonNull is a runtime sentinel.
import { Prisma } from "@prisma/client"
import type { UserRole } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { evaluateMethods } from "../../../domain/payment/gatewayEligibility"
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
		minOrderTotal: row.minOrderTotal?.toString() ?? null,
		maxOrderTotal: row.maxOrderTotal?.toString() ?? null,
		requiresValidatedVatId: row.requiresValidatedVatId,
	},
	config: row.config,
	createdAt: row.createdAt,
})

/**
 * Customer view. `config` is deliberately absent — bank details belong in the
 * localized `instructions`, which the customer is meant to read, not in a raw
 * settings blob that might hold anything.
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
	}
}

const notFound = () =>
	new ApiError(httpStatus.NOT_FOUND, "Payment method not found", {
		messageKey: "payment.notFound",
	})

const list = async (locale: LocaleCode) => {
	const rows = await prisma.paymentMethod.findMany({ include, orderBy: { sortOrder: "asc" } })
	return rows.map((r) => adminView(r, locale))
}

const getById = async (id: string, locale: LocaleCode) => {
	const row = await prisma.paymentMethod.findUnique({ where: { id }, include })
	if (!row) throw notFound()
	return adminView(row, locale)
}

const create = async (payload: Record<string, unknown>, locale: LocaleCode) => {
	const row = await prisma.paymentMethod.create({
		data: {
			code: payload.code as string,
			type: payload.type as never,
			isActive: (payload.isActive as boolean) ?? true,
			sortOrder: (payload.sortOrder as number) ?? 0,
			allowedCountries: (payload.allowedCountries as string[]) ?? [],
			allowedRoles: (payload.allowedRoles as UserRole[]) ?? [],
			requiresLogin: (payload.requiresLogin as boolean) ?? false,
			minCompletedOrders: (payload.minCompletedOrders as number) ?? 0,
			minOrderTotal: payload.minOrderTotal != null ? String(payload.minOrderTotal) : null,
			maxOrderTotal: payload.maxOrderTotal != null ? String(payload.maxOrderTotal) : null,
			requiresValidatedVatId: (payload.requiresValidatedVatId as boolean) ?? false,
			config: (payload.config as Prisma.InputJsonValue) ?? Prisma.JsonNull,
			translations: { create: payload.translations as never },
		},
		include,
	})

	return adminView(row, locale)
}

const update = async (id: string, payload: Record<string, unknown>, locale: LocaleCode) => {
	if (!(await prisma.paymentMethod.findUnique({ where: { id } }))) throw notFound()

	await prisma.$transaction(async (tx) => {
		await tx.paymentMethod.update({
			where: { id },
			data: {
				...(payload.code !== undefined ? { code: payload.code as string } : {}),
				...(payload.type !== undefined ? { type: payload.type as never } : {}),
				...(payload.isActive !== undefined ? { isActive: payload.isActive as boolean } : {}),
				...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder as number } : {}),
				...(payload.allowedCountries !== undefined ? { allowedCountries: payload.allowedCountries as string[] } : {}),
				...(payload.allowedRoles !== undefined ? { allowedRoles: payload.allowedRoles as UserRole[] } : {}),
				...(payload.requiresLogin !== undefined ? { requiresLogin: payload.requiresLogin as boolean } : {}),
				...(payload.minCompletedOrders !== undefined ? { minCompletedOrders: payload.minCompletedOrders as number } : {}),
				...(payload.minOrderTotal !== undefined ? { minOrderTotal: payload.minOrderTotal != null ? String(payload.minOrderTotal) : null } : {}),
				...(payload.maxOrderTotal !== undefined ? { maxOrderTotal: payload.maxOrderTotal != null ? String(payload.maxOrderTotal) : null } : {}),
				...(payload.requiresValidatedVatId !== undefined ? { requiresValidatedVatId: payload.requiresValidatedVatId as boolean } : {}),
				...(payload.config !== undefined ? { config: (payload.config as Prisma.InputJsonValue) ?? Prisma.JsonNull } : {}),
			},
		})

		for (const t of (payload.translations ?? []) as {
			locale: string
			title: string
			description?: string
			instructions?: string
		}[]) {
			await tx.paymentMethodTranslation.upsert({
				where: { methodId_locale: { methodId: id, locale: t.locale } },
				create: {
					methodId: id,
					locale: t.locale,
					title: t.title,
					description: t.description ?? null,
					instructions: t.instructions ?? null,
				},
				update: {
					title: t.title,
					description: t.description ?? null,
					instructions: t.instructions ?? null,
				},
			})
		}
	})

	return getById(id, locale)
}

const remove = async (id: string) => {
	if (!(await prisma.paymentMethod.findUnique({ where: { id } }))) throw notFound()
	await prisma.paymentMethod.delete({ where: { id } })
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
	let billingCountry = ctx.countryCode ?? null

	if (ctx.userId) {
		const user = await prisma.user.findUnique({ where: { id: ctx.userId } })
		hasValidatedVatId = user?.vatValidated ?? false
		// Order history lands with 3C; until then every customer counts as new,
		// which is the safe direction — it hides invoice payment rather than
		// offering it to someone who has never ordered.
		completedOrders = 0
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
			minOrderTotal: r.minOrderTotal?.toString() ?? null,
			maxOrderTotal: r.maxOrderTotal?.toString() ?? null,
			requiresValidatedVatId: r.requiresValidatedVatId,
		})),
		{
			isLoggedIn: Boolean(ctx.userId),
			role: ctx.role ?? null,
			billingCountry,
			completedOrders,
			orderTotal: ctx.orderTotal,
			hasValidatedVatId,
		}
	)

	const byId = new Map(rows.map((r) => [r.id, r]))

	return verdicts.map((v) => ({
		...(v.eligible ? publicView(byId.get(v.methodId)!, locale) : { id: v.methodId, code: v.code }),
		eligible: v.eligible,
		...(v.reason ? { reason: v.reason } : {}),
	}))
}

export const PaymentService = { list, getById, create, update, remove, available }
