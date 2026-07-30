import type { Prisma } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"

const include = { translations: true, rates: { orderBy: { priority: "asc" } } } satisfies Prisma.TaxClassInclude
type ClassRow = Prisma.TaxClassGetPayload<{ include: typeof include }>

const pick = <T extends { locale: string }>(rows: T[], locale: LocaleCode): T | undefined =>
	rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === DEFAULT_LOCALE) ?? rows[0]

const view = (row: ClassRow, locale: LocaleCode) => ({
	id: row.id,
	code: row.code,
	isDefault: row.isDefault,
	sortOrder: row.sortOrder,
	name: pick(row.translations, locale)?.name ?? row.code,
	rates: row.rates.map((r) => ({
		id: r.id,
		countryCode: r.countryCode,
		state: r.state,
		name: r.name,
		rate: r.rate.toString(),
		appliesToShipping: r.appliesToShipping,
		priority: r.priority,
		reverseChargeWithVatId: r.reverseChargeWithVatId,
		isActive: r.isActive,
	})),
})

const notFound = (key = "tax.classNotFound") =>
	new ApiError(httpStatus.NOT_FOUND, "Not found", { messageKey: key })

const listClasses = async (locale: LocaleCode) => {
	const rows = await prisma.taxClass.findMany({ include, orderBy: { sortOrder: "asc" } })
	return rows.map((r) => view(r, locale))
}

const getClass = async (id: string, locale: LocaleCode) => {
	const row = await prisma.taxClass.findUnique({ where: { id }, include })
	if (!row) throw notFound()
	return view(row, locale)
}

/** Only one class can be the default; setting a new one clears the old. */
const clearOtherDefaults = async (tx: Prisma.TransactionClient, exceptId?: string) => {
	await tx.taxClass.updateMany({
		where: { isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
		data: { isDefault: false },
	})
}

const createClass = async (payload: {
	code: string
	isDefault?: boolean
	sortOrder?: number
	translations: { locale: string; name: string }[]
}, locale: LocaleCode) => {
	const row = await prisma.$transaction(async (tx) => {
		const created = await tx.taxClass.create({
			data: {
				code: payload.code,
				isDefault: payload.isDefault ?? false,
				sortOrder: payload.sortOrder ?? 0,
				translations: { create: payload.translations },
			},
			include,
		})
		if (payload.isDefault) await clearOtherDefaults(tx, created.id)
		return created
	})

	return view(row, locale)
}

const updateClass = async (
	id: string,
	payload: {
		code?: string
		isDefault?: boolean
		sortOrder?: number
		translations?: { locale: string; name: string }[]
	},
	locale: LocaleCode
) => {
	if (!(await prisma.taxClass.findUnique({ where: { id } }))) throw notFound()

	await prisma.$transaction(async (tx) => {
		await tx.taxClass.update({
			where: { id },
			data: {
				...(payload.code !== undefined ? { code: payload.code } : {}),
				...(payload.isDefault !== undefined ? { isDefault: payload.isDefault } : {}),
				...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
			},
		})
		if (payload.isDefault) await clearOtherDefaults(tx, id)

		for (const t of payload.translations ?? []) {
			await tx.taxClassTranslation.upsert({
				where: { taxClassId_locale: { taxClassId: id, locale: t.locale } },
				create: { taxClassId: id, locale: t.locale, name: t.name },
				update: { name: t.name },
			})
		}
	})

	return getClass(id, locale)
}

const removeClass = async (id: string) => {
	const row = await prisma.taxClass.findUnique({
		where: { id },
		include: { _count: { select: { products: true } } },
	})
	if (!row) throw notFound()

	if (row._count.products > 0) {
		throw new ApiError(httpStatus.CONFLICT, "Tax class is in use", {
			messageKey: "tax.classInUse",
			messageVars: { count: String(row._count.products) },
		})
	}

	await prisma.taxClass.delete({ where: { id } })
}

const createRate = async (payload: {
	taxClassId: string
	countryCode: string
	state?: string | null
	name: string
	rate: string | number
	appliesToShipping?: boolean
	priority?: number
	reverseChargeWithVatId?: boolean
	isActive?: boolean
}) => {
	if (!(await prisma.taxClass.findUnique({ where: { id: payload.taxClassId } }))) throw notFound()

	const row = await prisma.taxRate.create({
		data: {
			taxClassId: payload.taxClassId,
			countryCode: payload.countryCode,
			state: payload.state ?? null,
			name: payload.name,
			rate: String(payload.rate),
			appliesToShipping: payload.appliesToShipping ?? true,
			priority: payload.priority ?? 1,
			reverseChargeWithVatId: payload.reverseChargeWithVatId ?? false,
			isActive: payload.isActive ?? true,
		},
	})

	return { ...row, rate: row.rate.toString() }
}

const updateRate = async (id: string, payload: Record<string, unknown>) => {
	if (!(await prisma.taxRate.findUnique({ where: { id } }))) throw notFound("tax.rateNotFound")

	const row = await prisma.taxRate.update({
		where: { id },
		data: {
			...(payload.countryCode !== undefined ? { countryCode: payload.countryCode as string } : {}),
			...(payload.state !== undefined ? { state: payload.state as string | null } : {}),
			...(payload.name !== undefined ? { name: payload.name as string } : {}),
			...(payload.rate !== undefined ? { rate: String(payload.rate) } : {}),
			...(payload.appliesToShipping !== undefined ? { appliesToShipping: payload.appliesToShipping as boolean } : {}),
			...(payload.priority !== undefined ? { priority: payload.priority as number } : {}),
			...(payload.reverseChargeWithVatId !== undefined ? { reverseChargeWithVatId: payload.reverseChargeWithVatId as boolean } : {}),
			...(payload.isActive !== undefined ? { isActive: payload.isActive as boolean } : {}),
		},
	})

	return { ...row, rate: row.rate.toString() }
}

const removeRate = async (id: string) => {
	if (!(await prisma.taxRate.findUnique({ where: { id } }))) throw notFound("tax.rateNotFound")
	await prisma.taxRate.delete({ where: { id } })
}

export const TaxService = {
	listClasses,
	getClass,
	createClass,
	updateClass,
	removeClass,
	createRate,
	updateRate,
	removeRate,
}
