import type { Prisma } from "@prisma/client"
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type LocaleCode } from "../../../config/locales"
import { sameLabel, uniqueValueCode } from "../../../domain/product/attributeValueCode"
import { copyCode, copyNameFor } from "../../../shared/duplicate"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { slugify, uniqueSlug } from "../../../shared/slugify"
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
	freeText: row.freeText,
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
	/** Made from the German label when absent. See `codeFromLabels`. */
	code?: string
	sortOrder?: number
	translations: { locale: string; label: string }[]
}

/** The German text first, as the codes typed into a product are made, then any language. */
const germanFirst = <T extends { locale: string }>(rows: T[]): T | undefined =>
	rows.find((r) => r.locale === DEFAULT_LOCALE) ?? rows[0]

/**
 * A code for a value the form sent without one, unique among `taken` — which
 * the caller grows as it goes, so two new values in one save that slug the
 * same still get two codes.
 */
const codeFromLabels = (value: ValueInput, taken: Set<string>): string => {
	const code =
		value.code ?? uniqueValueCode(slugify(germanFirst(value.translations)?.label ?? "", DEFAULT_LOCALE), taken)
	taken.add(code)
	return code
}

const create = async (
	payload: {
		code?: string
		sortOrder?: number
		freeText?: boolean
		translations: { locale: string; name: string }[]
		values?: ValueInput[]
	},
	locale: LocaleCode
) => {
	const code =
		payload.code ??
		(await uniqueSlug(slugify(germanFirst(payload.translations)?.name ?? "", DEFAULT_LOCALE) || "merkmal", async (candidate) =>
			Boolean(await prisma.attribute.findUnique({ where: { code: candidate }, select: { id: true } }))
		))
	const taken = new Set((payload.values ?? []).flatMap((v) => (v.code ? [v.code] : [])))

	const row = await prisma.attribute.create({
		data: {
			code,
			sortOrder: payload.sortOrder ?? 0,
			freeText: payload.freeText ?? false,
			translations: { create: payload.translations },
			values: {
				create: (payload.values ?? []).map((v) => ({
					code: codeFromLabels(v, taken),
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
		freeText?: boolean
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
				...(payload.freeText !== undefined ? { freeText: payload.freeText } : {}),
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
		// A value already saved keeps its code unless one is sent: the storefront's
		// filter links carry it, and renaming a label must not break them.
		const taken = new Set([
			...existing.values.map((v) => v.code),
			...(payload.values ?? []).flatMap((v) => (v.code ? [v.code] : [])),
		])

		for (const v of payload.values ?? []) {
			const valueId = v.id
				? (await tx.attributeValue.update({
						where: { id: v.id },
						data: { ...(v.code ? { code: v.code } : {}), sortOrder: v.sortOrder ?? 0 },
					})).id
				: (await tx.attributeValue.create({
						data: { attributeId: id, code: codeFromLabels(v, taken), sortOrder: v.sortOrder ?? 0 },
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

/**
 * Copies an attribute **with all of its values**.
 *
 * The values are the whole point. An attribute is a heading — "Diameter",
 * "Material" — and its twenty values are what took the time to enter; a copy
 * without them would leave the one part worth duplicating still to do.
 *
 * Value codes are reused verbatim, which is safe because their uniqueness is
 * scoped per attribute (`@@unique([attributeId, code])`). The attribute's own
 * code is global, so it gains a `-copy` suffix, numbered if that is taken too.
 *
 * What is not copied is which products and variants use the attribute. Those
 * are assignments made on the product, and a duplicate that arrived already
 * attached to half the catalogue would be a second attribute silently competing
 * with the first.
 */
const duplicate = async (id: string, locale: LocaleCode) => {
	const row = await prisma.attribute.findUnique({ where: { id }, include })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Attribute not found", {
			messageKey: "attribute.notFound",
		})
	}

	const code = await uniqueSlug(copyCode(row.code), async (candidate) => {
		const clash = await prisma.attribute.findUnique({
			where: { code: candidate },
			select: { id: true },
		})
		return clash !== null
	})

	return create(
		{
			code,
			sortOrder: row.sortOrder,
			freeText: row.freeText,
			translations: row.translations.map((t) => ({
				locale: t.locale,
				name: copyNameFor(t.name, t.locale),
			})),
			values: row.values.map((v) => ({
				code: v.code,
				sortOrder: v.sortOrder,
				// Labels are copied as they are. They belong to the value, not the
				// attribute, and "Ø 60 mm (copy)" would be nonsense on every one.
				translations: v.translations.map((t) => ({ locale: t.locale, label: t.label })),
			})),
		},
		locale
	)
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
	/** Products start this attribute as typed text rather than a list. */
	freeText: boolean
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
	freeText: row.freeText,
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

/**
 * A value typed straight into a product's Attributes tab.
 *
 * The client, 1 October: "Is it possible to make also a free text for the
 * product attributes, not only choosing from the list?" The value still
 * joins the attribute's list rather than living on the one product, so the
 * next product finds it there and it can still build variants.
 *
 * The same label in every language for now — the dashboard has one box, and
 * the English can be corrected under Attributes. A label the attribute already
 * has, in any language and any case, returns that value instead of a twin.
 */
const addValue = async (attributeId: string, label: string) => {
	const attribute = await prisma.attribute.findUnique({ where: { id: attributeId }, include })

	if (!attribute) {
		throw new ApiError(httpStatus.NOT_FOUND, "Attribute not found", {
			messageKey: "attribute.notFound",
		})
	}

	const text = label.trim().replace(/\s+/g, " ")
	const existing = attribute.values.find((v) => v.translations.some((tr) => sameLabel(tr.label, text)))
	if (existing) return { id: existing.id, code: existing.code, label: text, created: false }

	const created = await prisma.attributeValue.create({
		data: {
			attributeId,
			code: uniqueValueCode(slugify(text, DEFAULT_LOCALE), attribute.values.map((v) => v.code)),
			sortOrder: Math.max(-1, ...attribute.values.map((v) => v.sortOrder)) + 1,
			translations: {
				create: SUPPORTED_LOCALES.map((locale) => ({ locale, label: text })),
			},
		},
	})

	return { id: created.id, code: created.code, label: text, created: true }
}

/**
 * An attribute typed into a product's Attributes tab, by name alone.
 *
 * The full form under Attributes asks for a code, which is a word only an
 * importer cares about; from a product the name is enough and the code is made
 * from it. A name already in use, in any language, returns that attribute
 * instead of a second "Material".
 */
const addByName = async (name: string, locale: LocaleCode) => {
	const text = name.trim().replace(/\s+/g, " ")
	const all = await prisma.attribute.findMany({ include })

	const existing = all.find((a) => a.translations.some((tr) => sameLabel(tr.name, text)))
	if (existing) return { ...view(existing, locale), created: false }

	const row = await prisma.attribute.create({
		data: {
			code: uniqueValueCode(slugify(text, DEFAULT_LOCALE), all.map((a) => a.code), "merkmal"),
			sortOrder: Math.max(-1, ...all.map((a) => a.sortOrder)) + 1,
			translations: { create: SUPPORTED_LOCALES.map((l) => ({ locale: l, name: text })) },
		},
		include,
	})

	return { ...view(row, locale), created: true }
}

export const AttributeService = {
	addValue,
	addByName,
	list,
	getById,
	create,
	duplicate,
	update,
	remove,
	removeValue,
	adminList,
	adminGetById,
}
