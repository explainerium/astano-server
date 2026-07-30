import type { Prisma } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { effectiveRole, type PricingRole } from "../../../domain/pricing/effectiveRole"
import {
	resolvePrice,
	resolvePriceRange,
	type RolePriceInput,
} from "../../../domain/pricing/resolvePrice"
import { getEffectiveMoq } from "../../../domain/moq/getEffectiveMoq"
import { storage } from "../../../helpers/storage"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { slugify, uniqueSlug } from "../../../shared/slugify"
import ApiError from "../../errors/ApiError"

// ── Shapes ───────────────────────────────────────────────────────────────────

const detailInclude = {
	translations: true,
	categories: { include: { category: { include: { translations: true } } } },
	prices: true,
	priceTiers: true,
	assets: { include: { asset: true }, orderBy: { sortOrder: "asc" } },
	featuredAsset: true,
	variants: {
		include: {
			translations: true,
			prices: true,
			priceTiers: true,
			image: true,
			attributeValues: { include: { attributeValue: { include: { translations: true } } } },
		},
		orderBy: { sortOrder: "asc" },
	},
	options: {
		include: {
			optionProduct: {
				include: { translations: true, prices: true, priceTiers: true, featuredAsset: true },
			},
		},
		orderBy: { sortOrder: "asc" },
	},
} satisfies Prisma.ProductInclude

type ProductDetail = Prisma.ProductGetPayload<{ include: typeof detailInclude }>

/**
 * Images leave the API as ready-to-use URLs, never storage keys. The frontend
 * must not have to know which bucket or CDN is behind them — that is exactly
 * the coupling the storage driver exists to prevent.
 */
const toImage = (
	asset: { id: string; storageKey: string; derivatives: unknown; width: number | null; height: number | null } | null
) => {
	if (!asset) return null

	const derivatives = (asset.derivatives ?? {}) as Record<string, string>

	return {
		id: asset.id,
		url: storage.publicUrl(asset.storageKey),
		width: asset.width,
		height: asset.height,
		srcset: Object.fromEntries(
			Object.entries(derivatives).map(([name, key]) => [name, storage.publicUrl(key)])
		),
	}
}

const pickTranslation = <T extends { locale: string }>(rows: T[], locale: LocaleCode): T | undefined =>
	rows.find((r) => r.locale === locale) ??
	rows.find((r) => r.locale === DEFAULT_LOCALE) ??
	rows[0]

/** Maps database price + tier rows into the pure domain's input shape. */
const toPriceInputs = (
	prices: { role: string; basePrice: unknown; salePrice: unknown; saleStartsAt: Date | null; saleEndsAt: Date | null }[],
	tiers: { role: string; minQuantity: number; type: string; value: unknown }[]
): RolePriceInput[] =>
	prices.map((p) => ({
		role: p.role as PricingRole,
		basePrice: p.basePrice as string,
		salePrice: (p.salePrice ?? null) as string | null,
		saleStartsAt: p.saleStartsAt,
		saleEndsAt: p.saleEndsAt,
		tiers: tiers
			.filter((t) => t.role === p.role)
			.map((t) => ({
				minQuantity: t.minQuantity,
				type: t.type as "FIXED_PRICE" | "PERCENTAGE" | "FIXED_AMOUNT",
				value: t.value as string,
			})),
	}))

/**
 * Public product shape.
 *
 * `kind` is deliberately absent: it is an admin-only dashboard label and must
 * never reach the frontend.
 */
const toPublicProduct = (row: ProductDetail, locale: LocaleCode, role: PricingRole, quantity: number) => {
	const t = pickTranslation(row.translations, locale)
	const productPrices = toPriceInputs(row.prices, row.priceTiers)

	const defaultVariant = row.variants.find((v) => v.isDefault) ?? row.variants[0]

	const range = resolvePriceRange({
		quoteEnabled: row.quoteEnabled,
		role,
		productPrices,
		variantPrices: defaultVariant
			? toPriceInputs(defaultVariant.prices, defaultVariant.priceTiers)
			: undefined,
	})

	return {
		id: row.id,
		slug: t?.slug ?? row.id,
		name: t?.name ?? "(untitled)",
		shortDescription: t?.shortDescription ?? null,
		description: t?.description ?? null,
		metaTitle: t?.metaTitle ?? null,
		metaDescription: t?.metaDescription ?? null,

		quoteOnly: row.quoteEnabled,
		moq: row.moq,

		featuredImage: toImage(row.featuredAsset),
		images: row.assets.map((a) => toImage(a.asset)).filter(Boolean),

		categories: row.categories
			.filter((c) => !c.category.isHidden)
			.map((c) => {
				const ct = pickTranslation(c.category.translations, locale)
				return { id: c.category.id, name: ct?.name ?? "", slug: ct?.slug ?? "" }
			}),

		priceFrom: range.min?.toFixed(2) ?? null,
		priceTo: range.max?.toFixed(2) ?? null,

		variants: row.variants
			.filter((v) => v.isActive)
			.map((v) => {
				const price = resolvePrice({
					quoteEnabled: row.quoteEnabled,
					role,
					quantity,
					productPrices,
					variantPrices: toPriceInputs(v.prices, v.priceTiers),
				})

				const vt = pickTranslation(v.translations, locale)

				return {
					id: v.id,
					sku: v.sku,
					isDefault: v.isDefault,
					description: vt?.description ?? null,
					moq: getEffectiveMoq({ productMoq: row.moq, variantMoq: v.moq }),
					inStock: !v.manageStock || v.stock > 0 || v.allowBackorder,
					stock: v.manageStock ? v.stock : null,
					weightKg: v.weightKg?.toString() ?? null,
					image: toImage(v.image),
					attributes: v.attributeValues.map((av) => ({
						id: av.attributeValue.id,
						label: pickTranslation(av.attributeValue.translations, locale)?.label ?? av.attributeValue.code,
					})),
					unitPrice: price.unitPrice?.toFixed(2) ?? null,
					listPrice: price.listPrice?.toFixed(2) ?? null,
					onSale: price.onSale,
					lineTotal: price.lineTotal?.toFixed(2) ?? null,
					// The "Mehr kaufen, mehr sparen" table for this role.
					tiers: toPriceInputs(v.prices, v.priceTiers)
						.find((p) => p.role === price.resolvedRole)
						?.tiers?.map((tr) => ({
							minQuantity: tr.minQuantity,
							unitPrice:
								resolvePrice({
									role,
									quantity: tr.minQuantity,
									productPrices,
									variantPrices: toPriceInputs(v.prices, v.priceTiers),
								}).unitPrice?.toFixed(2) ?? null,
						})) ??
						productPrices
							.find((p) => p.role === price.resolvedRole)
							?.tiers?.map((tr) => ({
								minQuantity: tr.minQuantity,
								unitPrice:
									resolvePrice({ role, quantity: tr.minQuantity, productPrices }).unitPrice?.toFixed(2) ??
									null,
							})) ??
						[],
				}
			}),

		options: row.options.map((o) => {
			const ot = pickTranslation(o.optionProduct.translations, locale)
			const optionPrices = toPriceInputs(o.optionProduct.prices, o.optionProduct.priceTiers)
			const optionMoq = o.optionProduct.moq

			return {
				id: o.optionProduct.id,
				name: ot?.name ?? "(untitled)",
				slug: ot?.slug ?? o.optionProduct.id,
				groupLabel: o.groupLabel,
				// Options start unselected, and their quantity starts at their own
				// MOQ rather than 1 (§4.6).
				preselected: o.preselected,
				moq: optionMoq,
				startQuantity: optionMoq > 0 ? optionMoq : 1,
				discountPercent: o.discountPercent?.toString() ?? null,
				image: toImage(o.optionProduct.featuredAsset),
				unitPrice:
					resolvePrice({
						quoteEnabled: o.optionProduct.quoteEnabled,
						role,
						quantity: optionMoq > 0 ? optionMoq : 1,
						productPrices: optionPrices,
					}).unitPrice?.toFixed(2) ?? null,
			}
		}),
	}
}

/** Admin shape — everything, including the internal label. */
const toAdminProduct = (row: ProductDetail, locale: LocaleCode) => {
	const t = pickTranslation(row.translations, locale)

	return {
		id: row.id,
		kind: row.kind,
		status: row.status,
		visibility: row.visibility,
		quoteEnabled: row.quoteEnabled,
		moq: row.moq,
		sortOrder: row.sortOrder,
		name: t?.name ?? "(untitled)",
		slug: t?.slug ?? row.id,
		translations: row.translations,
		categoryIds: row.categories.map((c) => c.categoryId),
		prices: row.prices,
		tiers: row.priceTiers,
		variants: row.variants.map((v) => ({
			id: v.id,
			sku: v.sku,
			isDefault: v.isDefault,
			isActive: v.isActive,
			moq: v.moq,
			stock: v.stock,
			manageStock: v.manageStock,
			allowBackorder: v.allowBackorder,
			lowStockThreshold: v.lowStockThreshold,
			weightKg: v.weightKg,
			prices: v.prices,
			tiers: v.priceTiers,
			attributeValueIds: v.attributeValues.map((a) => a.attributeValueId),
		})),
		options: row.options.map((o) => ({
			optionProductId: o.optionProductId,
			name: pickTranslation(o.optionProduct.translations, locale)?.name ?? "",
			groupLabel: o.groupLabel,
			sortOrder: o.sortOrder,
			preselected: o.preselected,
			discountPercent: o.discountPercent,
		})),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Only these two visibilities may appear in shop and category listings. */
const SHOP_VISIBILITIES = ["SHOP_AND_SEARCH", "SHOP_ONLY"] as const
const SEARCH_VISIBILITIES = ["SHOP_AND_SEARCH", "SEARCH_ONLY"] as const

const list = async (params: {
	locale: LocaleCode
	role: PricingRole
	category?: string
	search?: string
	quantity: number
	page: number
	limit: number
	sort: string
}) => {
	// A search request and a browse request respect different visibility rules,
	// exactly as WooCommerce does.
	const visibility = params.search ? SEARCH_VISIBILITIES : SHOP_VISIBILITIES

	const where: Prisma.ProductWhereInput = {
		status: "PUBLISHED",
		visibility: { in: [...visibility] },
		...(params.category
			? { categories: { some: { category: { translations: { some: { slug: params.category } }, isHidden: false } } } }
			: {}),
		...(params.search
			? {
					translations: {
						some: {
							OR: [
								{ name: { contains: params.search, mode: "insensitive" } },
								{ shortDescription: { contains: params.search, mode: "insensitive" } },
							],
						},
					},
				}
			: {}),
	}

	const orderBy: Prisma.ProductOrderByWithRelationInput =
		params.sort === "newest" ? { createdAt: "desc" } : { sortOrder: "asc" }

	const [rows, total] = await Promise.all([
		prisma.product.findMany({
			where,
			include: detailInclude,
			orderBy,
			skip: (params.page - 1) * params.limit,
			take: params.limit,
		}),
		prisma.product.count({ where }),
	])

	return {
		data: rows.map((r) => toPublicProduct(r, params.locale, params.role, params.quantity)),
		meta: {
			page: params.page,
			limit: params.limit,
			total,
			totalPages: Math.ceil(total / params.limit) || 1,
		},
	}
}

const getBySlug = async (
	slug: string,
	locale: LocaleCode,
	role: PricingRole,
	quantity: number
) => {
	const row = await prisma.product.findFirst({
		where: { translations: { some: { slug } }, status: "PUBLISHED" },
		include: detailInclude,
	})

	// A HIDDEN product is still reachable by direct link — it is excluded from
	// listings, not unpublished. That mirrors WooCommerce and is what makes an
	// option product orderable through its parent.
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Product not found", {
			messageKey: "product.notFound",
		})
	}

	return toPublicProduct(row, locale, role, quantity)
}

const adminList = async (params: {
	locale: LocaleCode
	kind?: string
	status?: string
	visibility?: string
	search?: string
	page: number
	limit: number
}) => {
	const where: Prisma.ProductWhereInput = {
		...(params.kind ? { kind: params.kind as "MAIN" | "OPTION" } : {}),
		...(params.status ? { status: params.status as "DRAFT" | "PUBLISHED" | "ARCHIVED" } : {}),
		...(params.visibility
			? { visibility: params.visibility as "SHOP_AND_SEARCH" | "SHOP_ONLY" | "SEARCH_ONLY" | "HIDDEN" }
			: {}),
		...(params.search
			? {
					OR: [
						{ translations: { some: { name: { contains: params.search, mode: "insensitive" } } } },
						{ variants: { some: { sku: { contains: params.search, mode: "insensitive" } } } },
					],
				}
			: {}),
	}

	const [rows, total] = await Promise.all([
		prisma.product.findMany({
			where,
			include: detailInclude,
			orderBy: { updatedAt: "desc" },
			skip: (params.page - 1) * params.limit,
			take: params.limit,
		}),
		prisma.product.count({ where }),
	])

	return {
		data: rows.map((r) => toAdminProduct(r, params.locale)),
		meta: {
			page: params.page,
			limit: params.limit,
			total,
			totalPages: Math.ceil(total / params.limit) || 1,
		},
	}
}

const adminGetById = async (id: string, locale: LocaleCode) => {
	const row = await prisma.product.findUnique({ where: { id }, include: detailInclude })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Product not found", {
			messageKey: "product.notFound",
		})
	}
	return toAdminProduct(row, locale)
}

// ── Writes ───────────────────────────────────────────────────────────────────

interface TranslationInput {
	locale: string
	name: string
	slug?: string
	shortDescription?: string
	description?: string
	metaTitle?: string
	metaDescription?: string
}

const resolveSlug = async (t: TranslationInput, excludeProductId?: string): Promise<string> => {
	const base = t.slug ?? slugify(t.name, t.locale as LocaleCode)

	return uniqueSlug(base || "product", async (candidate) => {
		const clash = await prisma.productTranslation.findFirst({
			where: {
				locale: t.locale,
				slug: candidate,
				...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
			},
			select: { id: true },
		})
		return clash !== null
	})
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * SKUs are unique across the whole catalogue. Checking here rather than letting
 * the database constraint fire means the admin is told *which* SKU clashed and
 * *which product* already owns it — a raw unique-constraint error tells them
 * neither.
 */
const assertSkusAvailable = async (
	variants: { sku: string }[],
	excludeProductId?: string
): Promise<void> => {
	const seen = new Set<string>()
	for (const v of variants) {
		const sku = v.sku.trim()
		if (seen.has(sku)) {
			throw new ApiError(httpStatus.CONFLICT, `Duplicate SKU ${sku} in this product`, {
				messageKey: "product.duplicateSkuInPayload",
				messageVars: { sku },
			})
		}
		seen.add(sku)
	}

	const clashes = await prisma.productVariant.findMany({
		where: {
			sku: { in: [...seen] },
			...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
		},
		select: { sku: true, product: { select: { translations: true } } },
	})

	const clash = clashes[0]
	if (clash) {
		const owner =
			clash.product.translations.find((t) => t.locale === DEFAULT_LOCALE)?.name ??
			clash.product.translations[0]?.name ??
			"another product"

		throw new ApiError(httpStatus.CONFLICT, `SKU ${clash.sku} is already used`, {
			messageKey: "product.duplicateSku",
			messageVars: { sku: clash.sku, product: owner },
		})
	}
}

const create = async (payload: any, locale: LocaleCode) => {
	const defaults = payload.variants.filter((v: any) => v.isDefault)
	if (defaults.length > 1) {
		throw new ApiError(httpStatus.BAD_REQUEST, "Only one variant can be the default", {
			messageKey: "product.multipleDefaults",
		})
	}

	await assertSkusAvailable(payload.variants)

	const translations = await Promise.all(
		payload.translations.map(async (t: TranslationInput) => ({
			locale: t.locale,
			name: t.name,
			slug: await resolveSlug(t),
			shortDescription: t.shortDescription ?? null,
			description: t.description ?? null,
			metaTitle: t.metaTitle ?? null,
			metaDescription: t.metaDescription ?? null,
		}))
	)

	const created = await prisma.product.create({
		data: {
			kind: payload.kind,
			status: payload.status,
			visibility: payload.visibility,
			quoteEnabled: payload.quoteEnabled,
			moq: payload.moq,
			sortOrder: payload.sortOrder,
			featuredAssetId: payload.featuredAssetId ?? null,
			translations: { create: translations },
			categories: {
				create: (payload.categoryIds ?? []).map((categoryId: string) => ({ categoryId })),
			},
			assets: {
				create: (payload.assetIds ?? []).map((assetId: string, i: number) => ({
					assetId,
					sortOrder: i,
				})),
			},
			prices: { create: payload.prices ?? [] },
			priceTiers: { create: payload.tiers ?? [] },
			options: {
				create: (payload.options ?? []).map((o: any) => ({
					optionProductId: o.optionProductId,
					sortOrder: o.sortOrder,
					groupLabel: o.groupLabel ?? null,
					preselected: o.preselected,
					discountPercent: o.discountPercent ?? null,
				})),
			},
			variants: {
				create: payload.variants.map((v: any, i: number) => ({
					sku: v.sku,
					// Guarantee exactly one default even if the caller set none.
					isDefault: defaults.length ? v.isDefault : i === 0,
					isActive: v.isActive,
					sortOrder: v.sortOrder,
					moq: v.moq ?? null,
					manageStock: v.manageStock,
					stock: v.stock,
					allowBackorder: v.allowBackorder,
					lowStockThreshold: v.lowStockThreshold ?? null,
					weightKg: v.weightKg ?? null,
					lengthCm: v.lengthCm ?? null,
					widthCm: v.widthCm ?? null,
					heightCm: v.heightCm ?? null,
					imageAssetId: v.imageAssetId ?? null,
					prices: { create: v.prices ?? [] },
					priceTiers: { create: v.tiers ?? [] },
					attributeValues: {
						create: (v.attributeValueIds ?? []).map((attributeValueId: string) => ({
							attributeValueId,
						})),
					},
				})),
			},
		},
		include: detailInclude,
	})

	return toAdminProduct(created, locale)
}

const update = async (id: string, payload: any, locale: LocaleCode) => {
	const existing = await prisma.product.findUnique({ where: { id } })
	if (!existing) {
		throw new ApiError(httpStatus.NOT_FOUND, "Product not found", {
			messageKey: "product.notFound",
		})
	}

	if (payload.variants?.length) {
		await assertSkusAvailable(payload.variants, id)
	}

	await prisma.$transaction(async (tx) => {
		await tx.product.update({
			where: { id },
			data: {
				...(payload.kind !== undefined ? { kind: payload.kind } : {}),
				...(payload.status !== undefined ? { status: payload.status } : {}),
				...(payload.visibility !== undefined ? { visibility: payload.visibility } : {}),
				...(payload.quoteEnabled !== undefined ? { quoteEnabled: payload.quoteEnabled } : {}),
				...(payload.moq !== undefined ? { moq: payload.moq } : {}),
				...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
				...(payload.featuredAssetId !== undefined
					? { featuredAssetId: payload.featuredAssetId }
					: {}),
			},
		})

		for (const t of payload.translations ?? []) {
			const slug = await resolveSlug(t, id)
			await tx.productTranslation.upsert({
				where: { productId_locale: { productId: id, locale: t.locale } },
				create: {
					productId: id,
					locale: t.locale,
					name: t.name,
					slug,
					shortDescription: t.shortDescription ?? null,
					description: t.description ?? null,
					metaTitle: t.metaTitle ?? null,
					metaDescription: t.metaDescription ?? null,
				},
				update: {
					name: t.name,
					...(t.slug ? { slug } : {}),
					shortDescription: t.shortDescription ?? null,
					description: t.description ?? null,
					metaTitle: t.metaTitle ?? null,
					metaDescription: t.metaDescription ?? null,
				},
			})
		}

		if (payload.categoryIds) {
			await tx.productCategory.deleteMany({ where: { productId: id } })
			await tx.productCategory.createMany({
				data: payload.categoryIds.map((categoryId: string) => ({ productId: id, categoryId })),
			})
		}

		// Prices and tiers are replaced wholesale rather than diffed: a ladder is
		// edited as a unit in the admin, and a partial update is how a stale rung
		// survives a price change.
		if (payload.prices) {
			await tx.productPrice.deleteMany({ where: { productId: id } })
			await tx.productPrice.createMany({
				data: payload.prices.map((p: any) => ({ ...p, productId: id })),
			})
		}

		if (payload.tiers) {
			await tx.productPriceTier.deleteMany({ where: { productId: id } })
			await tx.productPriceTier.createMany({
				data: payload.tiers.map((t: any) => ({ ...t, productId: id })),
			})
		}

		if (payload.options) {
			await tx.productOption.deleteMany({ where: { productId: id } })
			for (const o of payload.options) {
				await tx.productOption.create({
					data: {
						productId: id,
						optionProductId: o.optionProductId,
						sortOrder: o.sortOrder ?? 0,
						groupLabel: o.groupLabel ?? null,
						preselected: o.preselected ?? false,
						discountPercent: o.discountPercent ?? null,
					},
				})
			}
		}

		for (const v of payload.variants ?? []) {
			const data = {
				sku: v.sku,
				isDefault: v.isDefault ?? false,
				isActive: v.isActive ?? true,
				sortOrder: v.sortOrder ?? 0,
				moq: v.moq ?? null,
				manageStock: v.manageStock ?? true,
				stock: v.stock ?? 0,
				allowBackorder: v.allowBackorder ?? false,
				lowStockThreshold: v.lowStockThreshold ?? null,
				weightKg: v.weightKg ?? null,
				lengthCm: v.lengthCm ?? null,
				widthCm: v.widthCm ?? null,
				heightCm: v.heightCm ?? null,
				imageAssetId: v.imageAssetId ?? null,
			}

			const variantId: string = v.id
				? (await tx.productVariant.update({ where: { id: v.id }, data })).id
				: (await tx.productVariant.create({ data: { ...data, productId: id } })).id

			if (v.prices) {
				await tx.variantPrice.deleteMany({ where: { variantId } })
				await tx.variantPrice.createMany({
					data: v.prices.map((p: any) => ({ ...p, variantId })),
				})
			}

			if (v.tiers) {
				await tx.variantPriceTier.deleteMany({ where: { variantId } })
				await tx.variantPriceTier.createMany({
					data: v.tiers.map((t: any) => ({ ...t, variantId })),
				})
			}
		}
	})

	return adminGetById(id, locale)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const remove = async (id: string): Promise<void> => {
	const row = await prisma.product.findUnique({
		where: { id },
		include: { _count: { select: { offeredBy: true } } },
	})

	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Product not found", {
			messageKey: "product.notFound",
		})
	}

	// Deleting a product that other products offer as an option would silently
	// strip that option from their pages. Make the admin unpick it deliberately.
	if (row._count.offeredBy > 0) {
		throw new ApiError(
			httpStatus.CONFLICT,
			"This product is attached as an option to other products",
			{ messageKey: "product.attachedAsOption" }
		)
	}

	await prisma.product.delete({ where: { id } })
}

export const ProductService = {
	list,
	getBySlug,
	adminList,
	adminGetById,
	create,
	update,
	remove,
	pricingRoleFor: (role?: string, status?: string): PricingRole =>
		effectiveRole(
			(role ?? null) as never,
			(status ?? null) as never
		),
}
