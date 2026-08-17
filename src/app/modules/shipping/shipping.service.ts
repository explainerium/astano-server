import type { Prisma } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { resolveShipping, type ShippingMethodType } from "../../../domain/shipping/resolveShipping"
import { readSellingRule } from "../../../domain/shop/sellingLocations"
import { canShipTo, readShippingRule } from "../../../domain/shop/shippingLocations"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"
import { SettingService } from "../setting/setting.service"

const zoneInclude = {
	translations: true,
	countries: true,
	methods: {
		include: { translations: true, rates: { orderBy: { minValue: "asc" } } },
		orderBy: { sortOrder: "asc" },
	},
} satisfies Prisma.ShippingZoneInclude

type ZoneRow = Prisma.ShippingZoneGetPayload<{ include: typeof zoneInclude }>

const pick = <T extends { locale: string }>(rows: T[], locale: LocaleCode): T | undefined =>
	rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === DEFAULT_LOCALE) ?? rows[0]

const view = (row: ZoneRow, locale: LocaleCode) => ({
	id: row.id,
	code: row.code,
	name: pick(row.translations, locale)?.name ?? row.code,
	// Every locale, not just the resolved one: `name` is for display, but the
	// admin editor needs all of them or the German name is invisible and
	// uneditable. Same reason staff category and tax-class reads carry them.
	translations: row.translations.map((t) => ({ locale: t.locale, name: t.name })),
	sortOrder: row.sortOrder,
	isActive: row.isActive,
	countries: row.countries.map((c) => c.countryCode),
	methods: row.methods.map((m) => ({
		id: m.id,
		code: m.code,
		type: m.type,
		name: pick(m.translations, locale)?.name ?? m.code,
		description: pick(m.translations, locale)?.description ?? null,
		translations: m.translations.map((t) => ({
			locale: t.locale,
			name: t.name,
			description: t.description,
		})),
		flatCost: m.flatCost?.toString() ?? null,
		freeAboveSubtotal: m.freeAboveSubtotal?.toString() ?? null,
		taxable: m.taxable,
		isActive: m.isActive,
		sortOrder: m.sortOrder,
		bands: m.rates.map((r) => ({
			id: r.id,
			minValue: r.minValue.toString(),
			maxValue: r.maxValue?.toString() ?? null,
			cost: r.cost.toString(),
		})),
	})),
})

const notFound = (key: string) => new ApiError(httpStatus.NOT_FOUND, "Not found", { messageKey: key })

const listZones = async (locale: LocaleCode) => {
	const rows = await prisma.shippingZone.findMany({ include: zoneInclude, orderBy: { sortOrder: "asc" } })
	return rows.map((r) => view(r, locale))
}

const getZone = async (id: string, locale: LocaleCode) => {
	const row = await prisma.shippingZone.findUnique({ where: { id }, include: zoneInclude })
	if (!row) throw notFound("shipping.zoneNotFound")
	return view(row, locale)
}

/**
 * A country may belong to only one zone, so a destination always resolves to
 * exactly one. Assigning it elsewhere is reported rather than silently moved —
 * quietly re-homing a country would change shipping prices with no trace.
 */
const assertCountriesFree = async (countries: string[], exceptZoneId?: string) => {
	if (!countries.length) return

	const clash = await prisma.shippingZoneCountry.findFirst({
		where: {
			countryCode: { in: countries },
			...(exceptZoneId ? { zoneId: { not: exceptZoneId } } : {}),
		},
		include: { zone: { include: { translations: true } } },
	})

	if (clash) {
		throw new ApiError(httpStatus.CONFLICT, "Country already in another zone", {
			messageKey: "shipping.countryTaken",
			messageVars: {
				country: clash.countryCode,
				zone: clash.zone.translations[0]?.name ?? clash.zone.code,
			},
		})
	}
}

const createZone = async (payload: {
	code: string
	sortOrder?: number
	isActive?: boolean
	countries?: string[]
	translations: { locale: string; name: string }[]
}, locale: LocaleCode) => {
	await assertCountriesFree(payload.countries ?? [])

	const row = await prisma.shippingZone.create({
		data: {
			code: payload.code,
			sortOrder: payload.sortOrder ?? 0,
			isActive: payload.isActive ?? true,
			translations: { create: payload.translations },
			countries: { create: (payload.countries ?? []).map((countryCode) => ({ countryCode })) },
		},
		include: zoneInclude,
	})

	return view(row, locale)
}

const updateZone = async (
	id: string,
	payload: {
		code?: string
		sortOrder?: number
		isActive?: boolean
		countries?: string[]
		translations?: { locale: string; name: string }[]
	},
	locale: LocaleCode
) => {
	if (!(await prisma.shippingZone.findUnique({ where: { id } }))) throw notFound("shipping.zoneNotFound")
	if (payload.countries) await assertCountriesFree(payload.countries, id)

	await prisma.$transaction(async (tx) => {
		await tx.shippingZone.update({
			where: { id },
			data: {
				...(payload.code !== undefined ? { code: payload.code } : {}),
				...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
				...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
			},
		})

		for (const t of payload.translations ?? []) {
			await tx.shippingZoneTranslation.upsert({
				where: { zoneId_locale: { zoneId: id, locale: t.locale } },
				create: { zoneId: id, locale: t.locale, name: t.name },
				update: { name: t.name },
			})
		}

		if (payload.countries) {
			await tx.shippingZoneCountry.deleteMany({ where: { zoneId: id } })
			await tx.shippingZoneCountry.createMany({
				data: payload.countries.map((countryCode) => ({ zoneId: id, countryCode })),
			})
		}
	})

	return getZone(id, locale)
}

const removeZone = async (id: string) => {
	if (!(await prisma.shippingZone.findUnique({ where: { id } }))) throw notFound("shipping.zoneNotFound")
	await prisma.shippingZone.delete({ where: { id } })
}

const createMethod = async (payload: Record<string, unknown>, locale: LocaleCode) => {
	const zoneId = payload.zoneId as string
	if (!(await prisma.shippingZone.findUnique({ where: { id: zoneId } }))) {
		throw notFound("shipping.zoneNotFound")
	}

	const bands = (payload.bands ?? []) as { minValue: string; maxValue?: string | null; cost: string }[]

	await prisma.shippingMethod.create({
		data: {
			zoneId,
			code: payload.code as string,
			type: payload.type as ShippingMethodType,
			flatCost: payload.flatCost != null ? String(payload.flatCost) : null,
			freeAboveSubtotal: payload.freeAboveSubtotal != null ? String(payload.freeAboveSubtotal) : null,
			taxable: (payload.taxable as boolean) ?? true,
			isActive: (payload.isActive as boolean) ?? true,
			sortOrder: (payload.sortOrder as number) ?? 0,
			translations: { create: payload.translations as { locale: string; name: string }[] },
			rates: {
				create: bands.map((b) => ({
					minValue: String(b.minValue),
					maxValue: b.maxValue != null ? String(b.maxValue) : null,
					cost: String(b.cost),
				})),
			},
		},
	})

	return getZone(zoneId, locale)
}

const updateMethod = async (id: string, payload: Record<string, unknown>, locale: LocaleCode) => {
	const existing = await prisma.shippingMethod.findUnique({ where: { id } })
	if (!existing) throw notFound("shipping.methodNotFound")

	await prisma.$transaction(async (tx) => {
		await tx.shippingMethod.update({
			where: { id },
			data: {
				...(payload.code !== undefined ? { code: payload.code as string } : {}),
				...(payload.type !== undefined ? { type: payload.type as ShippingMethodType } : {}),
				...(payload.flatCost !== undefined ? { flatCost: payload.flatCost != null ? String(payload.flatCost) : null } : {}),
				...(payload.freeAboveSubtotal !== undefined ? { freeAboveSubtotal: payload.freeAboveSubtotal != null ? String(payload.freeAboveSubtotal) : null } : {}),
				...(payload.taxable !== undefined ? { taxable: payload.taxable as boolean } : {}),
				...(payload.isActive !== undefined ? { isActive: payload.isActive as boolean } : {}),
				...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder as number } : {}),
			},
		})

		for (const t of (payload.translations ?? []) as { locale: string; name: string; description?: string }[]) {
			await tx.shippingMethodTranslation.upsert({
				where: { methodId_locale: { methodId: id, locale: t.locale } },
				create: { methodId: id, locale: t.locale, name: t.name, description: t.description ?? null },
				update: { name: t.name, description: t.description ?? null },
			})
		}

		// A ladder is edited as a unit; a partial update is how a stale band
		// survives a price change.
		if (payload.bands) {
			const bands = payload.bands as { minValue: string; maxValue?: string | null; cost: string }[]
			await tx.shippingRate.deleteMany({ where: { methodId: id } })
			await tx.shippingRate.createMany({
				data: bands.map((b) => ({
					methodId: id,
					minValue: String(b.minValue),
					maxValue: b.maxValue != null ? String(b.maxValue) : null,
					cost: String(b.cost),
				})),
			})
		}
	})

	return getZone(existing.zoneId, locale)
}

const removeMethod = async (id: string) => {
	if (!(await prisma.shippingMethod.findUnique({ where: { id } }))) {
		throw notFound("shipping.methodNotFound")
	}
	await prisma.shippingMethod.delete({ where: { id } })
}

/** What a customer shipping to `countryCode` would be offered and charged. */
const quote = async (
	params: { countryCode: string; weightKg: number; subtotal: number },
	locale: LocaleCode
) => {
	const zoneCountry = await prisma.shippingZoneCountry.findUnique({
		where: { countryCode: params.countryCode.toUpperCase() },
		include: { zone: { include: zoneInclude } },
	})

	if (!zoneCountry || !zoneCountry.zone.isActive) {
		return { zone: null, quotes: [], deliverable: false }
	}

	const zone = zoneCountry.zone

	const quotes = resolveShipping({
		weightKg: params.weightKg,
		subtotal: params.subtotal,
		methods: zone.methods
			.filter((m) => m.isActive)
			.map((m) => ({
				id: m.id,
				code: m.code,
				name: pick(m.translations, locale)?.name ?? m.code,
				type: m.type,
				flatCost: m.flatCost?.toString() ?? null,
				freeAboveSubtotal: m.freeAboveSubtotal?.toString() ?? null,
				taxable: m.taxable,
				sortOrder: m.sortOrder,
				bands: m.rates.map((r) => ({
					minValue: r.minValue.toString(),
					maxValue: r.maxValue?.toString() ?? null,
					cost: r.cost.toString(),
				})),
			})),
	})

	return {
		zone: { id: zone.id, code: zone.code, name: pick(zone.translations, locale)?.name ?? zone.code },
		quotes,
		deliverable: quotes.some((q) => !q.unavailableReason),
	}
}

/**
 * The countries the shop will actually deliver to.
 *
 * Public, and the reason it exists is that there was no way to ask. The zones
 * are an admin-only endpoint, so every country dropdown in the storefront read
 * a list hardcoded in the frontend instead — and the two drifted, exactly as
 * the comment above that list predicted. At the time of writing the hardcoded
 * seventeen offered Latvia and Lithuania, which have no zone and therefore no
 * delivery method, while five countries the shop had configured — Czechia,
 * Estonia, Finland, Monaco, the Netherlands — could not be chosen at all.
 *
 * Three gates, in the order they actually apply:
 *
 *  1. the zone is active and has at least one active method — a zone with no
 *     way to ship to it is a country the checkout will refuse;
 *  2. the shop sells there (`selling.locations`);
 *  3. the shop delivers there (`shipping.locations`), which is intersected
 *     with the selling rule rather than replacing it.
 *
 * Codes only. The display name is the frontend's business — `Intl.DisplayNames`
 * translates all of them for free, which is what the old list could not do.
 */
const deliverableCountries = async (): Promise<string[]> => {
	const settings = await SettingService.getMap()
	const selling = readSellingRule(settings)
	const shipping = readShippingRule(settings)

	const rows = await prisma.shippingZoneCountry.findMany({
		where: {
			zone: {
				isActive: true,
				// A zone nobody can be shipped through is not a destination on
				// offer, however many countries are filed under it.
				methods: { some: { isActive: true } },
			},
		},
		select: { countryCode: true },
	})

	return [...new Set(rows.map((row) => row.countryCode.toUpperCase()))]
		.filter((code) => canShipTo(shipping, selling, code))
		.sort()
}

export const ShippingService = {
	deliverableCountries,
	listZones,
	getZone,
	createZone,
	updateZone,
	removeZone,
	createMethod,
	updateMethod,
	removeMethod,
	quote,
}
