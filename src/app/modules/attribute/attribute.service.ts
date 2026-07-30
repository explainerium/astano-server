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
	isVariantAxis: row.isVariantAxis,
	sortOrder: row.sortOrder,
	name: pick(row.translations, locale)?.name ?? row.code,
	values: row.values.map((v) => ({
		id: v.id,
		code: v.code,
		sortOrder: v.sortOrder,
		label: pick(v.translations, locale)?.label ?? v.code,
	})),
})

const list = async (locale: LocaleCode, variantAxisOnly: boolean) => {
	const rows = await prisma.attribute.findMany({
		where: variantAxisOnly ? { isVariantAxis: true } : {},
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
		isVariantAxis?: boolean
		sortOrder?: number
		translations: { locale: string; name: string }[]
		values?: ValueInput[]
	},
	locale: LocaleCode
) => {
	const row = await prisma.attribute.create({
		data: {
			code: payload.code,
			isVariantAxis: payload.isVariantAxis ?? false,
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
		isVariantAxis?: boolean
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
				...(payload.isVariantAxis !== undefined ? { isVariantAxis: payload.isVariantAxis } : {}),
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

export const AttributeService = { list, getById, create, update, remove, removeValue }
