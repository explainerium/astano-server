import type { Prisma } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"

const include = {
	translations: true,
	values: { include: { translations: true }, orderBy: { sortOrder: "asc" } },
} satisfies Prisma.AttributeInclude

type AttributeRow = Prisma.AttributeGetPayload<{ include: typeof include }>

const pick = <T extends { locale: string }>(rows: T[], locale: LocaleCode): T | undefined =>
	rows.find((r) => r.locale === locale) ??
	rows.find((r) => r.locale === DEFAULT_LOCALE) ??
	rows[0]

const view = (row: AttributeRow, locale: LocaleCode) => ({
	id: row.id,
	code: row.code,
	sortOrder: row.sortOrder,
	name: pick(row.translations, locale)?.name ?? row.code,
	values: row.values.map((v) => ({
		id: v.id,
		code: v.code,
		sortOrder: v.sortOrder,
		label: pick(v.translations, locale)?.label ?? v.code,
	})),
})

const list = async (locale: LocaleCode) => {
	const rows = await prisma.attribute.findMany({
		include,
		orderBy: { sortOrder: "asc" },
	})

	return rows.map((r) => view(r, locale))
}

const getById = async (id: string, locale: LocaleCode) => {
	const row = await prisma.attribute.findUnique({ where: { id }, include })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Attribute not found", {
			messageKey: "attribute.notFound",
		})
	}
	return view(row, locale)
}

interface ValueInput {
	id?: string
	code: string
	sortOrder?: number
	translations: { locale: string; label: string }[]
}

const create = async (
	payload: {
		code: string
		sortOrder?: number
		translations: { locale: string; name: string }[]
		values?: ValueInput[]
	},
	locale: LocaleCode
) => {
	const row = await prisma.attribute.create({
		data: {
			code: payload.code,
			sortOrder: payload.sortOrder ?? 0,
			translations: { create: payload.translations },
			values: {
				create: (payload.values ?? []).map((v) => ({
					code: v.code,
					sortOrder: v.sortOrder ?? 0,
					translations: { create: v.translations },
				})),
			},
		},
		include,
	})

	return view(row, locale)
}

const update = async (
	id: string,
	payload: {
		code?: string
		sortOrder?: number
		translations?: { locale: string; name: string }[]
		values?: ValueInput[]
	},
	locale: LocaleCode
) => {
	const existing = await prisma.attribute.findUnique({ where: { id }, include })
	if (!existing) {
		throw new ApiError(httpStatus.NOT_FOUND, "Attribute not found", {
			messageKey: "attribute.notFound",
		})
	}

	await prisma.$transaction(async (tx) => {
		await tx.attribute.update({
			where: { id },
			data: {
				...(payload.code !== undefined ? { code: payload.code } : {}),
				...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
			},
		})

		for (const t of payload.translations ?? []) {
			await tx.attributeTranslation.upsert({
				where: { attributeId_locale: { attributeId: id, locale: t.locale } },
				create: { attributeId: id, locale: t.locale, name: t.name },
				update: { name: t.name },
			})
		}

		// Values are upserted rather than replaced. Deleting and recreating them
		// would cascade through variant_attribute_values and silently detach every
		// variant that used them.
		for (const v of payload.values ?? []) {
			const valueId = v.id
				? (await tx.attributeValue.update({
						where: { id: v.id },
						data: { code: v.code, sortOrder: v.sortOrder ?? 0 },
					})).id
				: (await tx.attributeValue.create({
						data: { attributeId: id, code: v.code, sortOrder: v.sortOrder ?? 0 },
					})).id

			for (const t of v.translations) {
				await tx.attributeValueTranslation.upsert({
					where: { attributeValueId_locale: { attributeValueId: valueId, locale: t.locale } },
					create: { attributeValueId: valueId, locale: t.locale, label: t.label },
					update: { label: t.label },
				})
			}
		}
	})

	return getById(id, locale)
}

const remove = async (id: string): Promise<void> => {
	const row = await prisma.attribute.findUnique({
		where: { id },
		include: { _count: { select: { products: true, values: true } } },
	})

	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Attribute not found", {
			messageKey: "attribute.notFound",
		})
	}

	if (row._count.products > 0) {
		throw new ApiError(httpStatus.CONFLICT, "This attribute is used by products", {
			messageKey: "attribute.inUse",
		})
	}

	await prisma.attribute.delete({ where: { id } })
}

const removeValue = async (valueId: string): Promise<void> => {
	const row = await prisma.attributeValue.findUnique({
		where: { id: valueId },
		include: { _count: { select: { variants: true, products: true } } },
	})

	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Attribute value not found", {
			messageKey: "attribute.valueNotFound",
		})
	}

	// Removing a value that variants are built from would leave those variants
	// unidentifiable — "Small" would simply vanish from the product page.
	if (row._count.variants > 0 || row._count.products > 0) {
		throw new ApiError(httpStatus.CONFLICT, "This value is in use", {
			messageKey: "attribute.valueInUse",
		})
	}

	await prisma.attributeValue.delete({ where: { id: valueId } })
}

// ─── Staff reads ─────────────────────────────────────────────────────────────

/**
 * What staff see: every translation, for the attribute **and** each of its
 * values.
 *
 * The public view resolves to one language, which is right for a variant picker
 * and useless for an editor — you cannot edit the German label of "Large" if the
 * only thing the API returns is the English one.
 */
export interface AdminAttributeView {
	id: string
	code: string
	sortOrder: number
	translations: { locale: string; name: string }[]
	values: {
		id: string
		code: string
		sortOrder: number
		translations: { locale: string; label: string }[]
	}[]
}

const adminView = (row: AttributeRow): AdminAttributeView => ({
	id: row.id,
	code: row.code,
	sortOrder: row.sortOrder,
	translations: row.translations.map((t) => ({ locale: t.locale, name: t.name })),
	values: row.values.map((v) => ({
		id: v.id,
		code: v.code,
		sortOrder: v.sortOrder,
		translations: v.translations.map((t) => ({ locale: t.locale, label: t.label })),
	})),
})

const adminList = async (): Promise<AdminAttributeView[]> => {
	const rows = await prisma.attribute.findMany({ include, orderBy: { sortOrder: "asc" } })
	return rows.map(adminView)
}

const adminGetById = async (id: string): Promise<AdminAttributeView> => {
	const row = await prisma.attribute.findUnique({ where: { id }, include })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Attribute not found", {
			messageKey: "attribute.notFound",
		})
	}
	return adminView(row)
}

export const AttributeService = {
	list,
	getById,
	create,
	update,
	remove,
	removeValue,
	adminList,
	adminGetById,
}
