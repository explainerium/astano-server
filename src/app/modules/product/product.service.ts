import type { Prisma } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { sanitizeRichText, stripHtml } from "../../../domain/html/sanitizeRichText"
import { effectiveRole, type PricingRole } from "../../../domain/pricing/effectiveRole"
import {
	resolvePrice,
	resolvePriceRange,
	type RolePriceInput,
} from "../../../domain/pricing/resolvePrice"
import { getEffectiveMoq } from "../../../domain/moq/getEffectiveMoq"
import { readArtworkRules } from "../../../domain/product/artwork"
import {
	availableOf,
	DEFAULT_STOCK_RULES,
	isInStock,
	readStockRules,
	type StockRules,
} from "../../../domain/stock/availability"
import { SettingService } from "../setting/setting.service"
import { storage } from "../../../helpers/storage"
import { copyNameFor } from "../../../shared/duplicate"
import { loadExternalTiers, type ExternalTiers } from "./tierSources"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { slugify, uniqueSlug } from "../../../shared/slugify"
import ApiError from "../../errors/ApiError"

// ── Shapes ───────────────────────────────────────────────────────────────────

/** One tab as the editor sends it. */
interface TabInput {
	sortOrder?: number
	translations: { locale: string; title: string; content?: string | null }[]
}

const detailInclude = {
	// A select, not `true`. The relation is a full user row — password hash,
	// VAT number, consent timestamps — and this one is serialised straight into
	// an admin list response. Only the three fields a name is built from.
	createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
	translations: true,
	tabs: { include: { translations: true }, orderBy: { sortOrder: "asc" } },
	categories: { include: { category: { include: { translations: true } } } },
	/*
	 * The attribute and the value, not just their ids.
	 *
	 * The admin form only ever needed the ids — it draws from its own lists —
	 * but the product page has to print "Material: Edelstahl", and neither of
	 * those words is in a ProductAttribute row.
	 */
	attributes: {
		include: {
			attribute: { include: { translations: true } },
			attributeValue: { include: { translations: true } },
		},
	},
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
			// The attribute itself as well as the value: a specification table
			// listing "Ø 60 mm" without saying it is the diameter is a list of
			// numbers nobody can read.
			attributeValues: {
				include: {
					attributeValue: {
						include: { translations: true, attribute: { include: { translations: true } } },
					},
				},
			},
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
const toPublicProduct = (
	row: ProductDetail,
	locale: LocaleCode,
	role: PricingRole,
	quantity: number,
	/**
	 * Ladders from outside the product. The shop pages have no cart to count, so
	 * a category ladder here is measured against the quantity being previewed —
	 * the cart is where it meets the real total.
	 */
	external: ExternalTiers = {},
	/** Shop-wide stock floor. Defaults to the behaviour from before it was settable. */
	stockRules: StockRules = DEFAULT_STOCK_RULES
) => {
	const t = pickTranslation(row.translations, locale)
	const productPrices = toPriceInputs(row.prices, row.priceTiers)

	const defaultVariant = row.variants.find((v) => v.isDefault) ?? row.variants[0]

	const range = resolvePriceRange({
		...external,
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

		/**
		 * The shop's own tabs, after Description and Additional information.
		 *
		 * A tab with no title in this locale is dropped rather than shown with
		 * the other language's heading — a German page with an English tab label
		 * reads worse than one tab fewer. Content may be empty: a tab that is
		 * only a heading is a mistake, and hiding it says so.
		 */
		tabs: row.tabs
			.map((tab) => {
				const tt = pickTranslation(tab.translations, locale)
				return { id: tab.id, title: tt?.title ?? "", content: tt?.content ?? null }
			})
			.filter((tab) => tab.title.trim() !== "" && (tab.content ?? "").trim() !== ""),

		/**
		 * The attributes the shop chose to publish, for the specification table.
		 *
		 * Only `isVisible` ones. That checkbox is in the admin form and until now
		 * governed nothing at all — the product page read a variant's attributes
		 * and never the product's, so a shop that ticked "Material: Edelstahl"
		 * saw it appear nowhere. This is what the client meant by "attributes are
		 * not shown on product page".
		 *
		 * Regrouped to one entry per attribute, because the rows are stored
		 * expanded — an attribute with three values is three rows — and a table
		 * listing "Material" three times is not a specification.
		 */
		attributes: [
			...row.attributes
				.filter((a) => a.isVisible)
				.reduce((map, a) => {
					const name =
						pickTranslation(a.attribute.translations, locale)?.name ?? a.attribute.code
					const label =
						pickTranslation(a.attributeValue.translations, locale)?.label ??
						a.attributeValue.code

					const entry = map.get(a.attributeId) ?? { id: a.attributeId, name, values: [] }
					entry.values.push(label)
					return map.set(a.attributeId, entry)
				}, new Map<string, { id: string; name: string; values: string[] }>())
				.values(),
		],

		quoteOnly: row.quoteEnabled,
		moq: row.moq,
		// What the storefront needs to decide whether to offer an upload box.
		artwork: readArtworkRules(row),

		featuredImage: toImage(row.featuredAsset),
		images: row.assets.map((a) => toImage(a.asset)).filter(Boolean),

		categories: row.categories
			.filter((c) => !c.category.isHidden)
			.map((c) => {
				const ct = pickTranslation(c.category.translations, locale)
				return { id: c.category.id, name: ct?.name ?? "", slug: ct?.slug ?? "" }
			}),

		/**
		 * The variant a listing acts on.
		 *
		 * A card's wishlist button and its quick view both need something to add,
		 * and a card has no variant picker. This is the same default the product
		 * page opens on, so the two agree.
		 */
		defaultVariantId: defaultVariant?.id ?? null,

		priceFrom: range.min?.toFixed(2) ?? null,
		priceTo: range.max?.toFixed(2) ?? null,

		variants: row.variants
			.filter((v) => v.isActive)
			.map((v) => {
				const variantPrices = toPriceInputs(v.prices, v.priceTiers)

				const price = resolvePrice({
					...external,
					quoteEnabled: row.quoteEnabled,
					role,
					quantity,
					productPrices,
					variantPrices,
				})

				/**
				 * Every quantity at which this customer's price changes, from
				 * whichever ladder provides it.
				 *
				 * Built from the thresholds rather than from one ladder's rows: with
				 * three possible sources, a table showing only the product's own
				 * rungs would omit the row where a category discount actually kicks
				 * in. Each threshold is then priced through the resolver, so the
				 * table cannot disagree with the cart about what any of them costs.
				 */
				const thresholds = [
					...(variantPrices.find((p) => p.role === price.resolvedRole)?.tiers ?? []),
					...(productPrices.find((p) => p.role === price.resolvedRole)?.tiers ?? []),
					...(external.customerTiers ?? []),
					...(external.categoryTiers ?? []),
				].map((tr) => tr.minQuantity)

				const tierRows = [...new Set(thresholds)]
					.sort((a, b) => a - b)
					.map((minQuantity) => ({
						minQuantity,
						unitPrice:
							resolvePrice({
								...external,
								role,
								quantity: minQuantity,
								// An archive has no cart, so a category rung is previewed
								// against the quantity being asked about.
								categoryQuantity: minQuantity,
								productPrices,
								variantPrices,
							}).unitPrice?.toFixed(2) ?? null,
					}))

				const vt = pickTranslation(v.translations, locale)

				return {
					id: v.id,
					sku: v.sku,
					isDefault: v.isDefault,
					description: vt?.description ?? null,
					moq: getEffectiveMoq({ productMoq: row.moq, variantMoq: v.moq }),
					inStock: isInStock(v, stockRules),
					// What the customer may actually order, which is the stock on hand
					// less whatever floor the shop holds back — not the raw count.
					stock: availableOf(v, stockRules),
					weightKg: v.weightKg?.toString() ?? null,
					// The three dimensions the "Additional information" tab prints
					// alongside the weight, exactly as WooCommerce does. Null where
					// the admin left the field empty — an unset dimension is not zero.
					lengthCm: v.lengthCm?.toString() ?? null,
					widthCm: v.widthCm?.toString() ?? null,
					heightCm: v.heightCm?.toString() ?? null,
					image: toImage(v.image),
					attributes: v.attributeValues.map((av) => ({
						id: av.attributeValue.id,
						/// The value — "Ø 60 mm". What the variant picker shows.
						label: pickTranslation(av.attributeValue.translations, locale)?.label ?? av.attributeValue.code,
						/// The attribute it belongs to — "Diameter". What the
						/// specification table needs to make the value mean anything.
						name:
							pickTranslation(av.attributeValue.attribute.translations, locale)?.name ??
							av.attributeValue.attribute.code,
					})),
					unitPrice: price.unitPrice?.toFixed(2) ?? null,
					listPrice: price.listPrice?.toFixed(2) ?? null,
					onSale: price.onSale,
					lineTotal: price.lineTotal?.toFixed(2) ?? null,
					// The "Mehr kaufen, mehr sparen" table for this role.
					tiers: tierRows,
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

				/**
				 * The option's own quantity ladder, priced.
				 *
				 * An option is a product, bought in its own quantity, at its own
				 * tiers — the engraving on 500 cutters is not the same unit price as
				 * the engraving on 50. Without this the configurator could only ever
				 * show one figure and the customer would find the real one in the
				 * cart.
				 *
				 * Built from the thresholds the resolved role actually has, and each
				 * priced through the resolver, so it cannot disagree with what the
				 * cart charges.
				 */
				tiers: [
					...new Set(
						(optionPrices.find((p) => p.role === role)?.tiers ?? optionPrices[0]?.tiers ?? []).map(
							(tr) => tr.minQuantity
						)
					),
				]
					.sort((a, b) => a - b)
					.map((minQuantity) => ({
						minQuantity,
						unitPrice:
							resolvePrice({
								quoteEnabled: o.optionProduct.quoteEnabled,
								role,
								quantity: minQuantity,
								productPrices: optionPrices,
							}).unitPrice?.toFixed(2) ?? null,
					})),
			}
		}),
	}
}

/**
 * The staff account that created a product, as a name the admin list can print.
 *
 * Falls back to the email when the profile has no name — a staff account seeded
 * from the command line has one but not the other, and a blank cell in an
 * author column reads as "nobody", which is a different fact from "unnamed".
 * Null only when the column itself is null: a product created before the column
 * existed, or by an account since deleted.
 */
const toAuthor = (user: ProductDetail["createdBy"]) => {
	if (!user) return null

	const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
	return { id: user.id, name: name || user.email, email: user.email }
}

/** Admin shape — everything, including the internal label. */
const toAdminProduct = (row: ProductDetail, locale: LocaleCode) => {
	const t = pickTranslation(row.translations, locale)

	return {
		id: row.id,
		createdBy: toAuthor(row.createdBy),
		kind: row.kind,
		status: row.status,
		visibility: row.visibility,
		quoteEnabled: row.quoteEnabled,
		tabs: row.tabs.map((tab) => ({
			id: tab.id,
			sortOrder: tab.sortOrder,
			translations: tab.translations.map((tt) => ({
				locale: tt.locale,
				title: tt.title,
				content: tt.content,
			})),
		})),
		artworkMaxFiles: row.artworkMaxFiles,
		artworkRequired: row.artworkRequired,
		taxStatus: row.taxStatus,
		moq: row.moq,
		sortOrder: row.sortOrder,
		name: t?.name ?? "(untitled)",
		slug: t?.slug ?? row.id,
		translations: row.translations,
		categoryIds: row.categories.map((c) => c.categoryId),
		// Loaded by detailInclude but previously dropped here, so the editor had
		// no way to show which images a product already had.
		featuredAssetId: row.featuredAssetId,
		assetIds: row.assets.map((a) => a.assetId),
		// The ids are what the editor writes back; these are what it draws with.
		// Without them it would have to re-fetch every asset one by one just to
		// show a thumbnail this query has already loaded.
		featuredImage: toImage(row.featuredAsset),
		images: row.assets.map((a) => toImage(a.asset)).filter((image) => image !== null),
		// Rows regrouped back to one entry per attribute, mirroring the payload.
		attributes: [
			...row.attributes
				.reduce((map, a) => {
					const entry = map.get(a.attributeId) ?? {
						attributeId: a.attributeId,
						attributeValueIds: [] as string[],
						isVisible: a.isVisible,
						isVariation: a.isVariation,
					}
					entry.attributeValueIds.push(a.attributeValueId)
					return map.set(a.attributeId, entry)
				}, new Map<string, { attributeId: string; attributeValueIds: string[]; isVisible: boolean; isVariation: boolean }>())
				.values(),
		],
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
			// All four, not just the weight: the editor writes null for a field
			// the admin cleared, so a dimension the read omits would be wiped by
			// the next save of a form that never showed it.
			weightKg: v.weightKg,
			lengthCm: v.lengthCm,
			widthCm: v.widthCm,
			heightCm: v.heightCm,
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

/**
 * The cheapest and dearest "from" price in a set, for the filter's own track.
 *
 * Rounded outwards — down for the floor, up for the ceiling — so the extremes
 * are always inside the range a slider can reach. A track that stops a cent
 * short of the cheapest product makes it unselectable.
 *
 * Null when nothing in the set has a price: an all-quote-only category has no
 * range, and a slider from 0 to 0 is worse than no slider.
 */
const priceBoundsOf = (
	products: { priceFrom: string | null }[]
): { min: number; max: number } | null => {
	const values = products
		.map((p) => (p.priceFrom === null ? null : Number(p.priceFrom)))
		.filter((v): v is number => v !== null && Number.isFinite(v))

	if (!values.length) return null

	return {
		min: Math.floor(Math.min(...values)),
		max: Math.ceil(Math.max(...values)),
	}
}

/** Only these two visibilities may appear in shop and category listings. */
const SHOP_VISIBILITIES = ["SHOP_AND_SEARCH", "SHOP_ONLY"] as const
const SEARCH_VISIBILITIES = ["SHOP_AND_SEARCH", "SEARCH_ONLY"] as const

const list = async (params: {
	locale: LocaleCode
	role: PricingRole
	/// Signed-in caller, so a negotiated ladder shows on the archive too.
	userId?: string | null
	category?: string
	search?: string
	/// Inclusive bounds on the "from" price, as resolved for this visitor.
	minPrice?: number
	maxPrice?: number
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
		params.sort === "newest"
			? { createdAt: "desc" }
			: params.sort === "name"
				? { translations: { _count: "desc" } }
				: { sortOrder: "asc" }

	/**
	 * Price is not a column, so filtering or sorting by it cannot be a query.
	 *
	 * What a product costs depends on the visitor's role, the quantity, and up
	 * to three tier ladders — `resolvePrice` decides it, and the database has no
	 * way to. `price_asc` used to fall through to `sortOrder` and silently do
	 * nothing at all.
	 *
	 * So when price is actually involved, the whole matching set is loaded,
	 * priced, then filtered, sorted and paginated in memory. That is a real cost
	 * and it is paid **only** on those requests: an ordinary browse still lets
	 * Postgres do the paging. With a catalogue of this size the difference is
	 * milliseconds; if it ever grows into thousands of live products, a
	 * materialised per-role price column is the answer, not a bigger `take`.
	 */
	const byPrice =
		params.sort === "price_asc" ||
		params.sort === "price_desc" ||
		params.minPrice !== undefined ||
		params.maxPrice !== undefined

	const rows = await prisma.product.findMany({
		where,
		include: detailInclude,
		orderBy,
		...(byPrice ? {} : { skip: (params.page - 1) * params.limit, take: params.limit }),
	})

	const [externalTiers, stockRules] = await Promise.all([
		loadExternalTiers({
			productIds: rows.map((r) => r.id),
			role: params.role,
			userId: params.userId,
		}),
		SettingService.getMap().then(readStockRules),
	])

	const priced = rows.map((r) =>
		toPublicProduct(r, params.locale, params.role, params.quantity, externalTiers(r.id), stockRules)
	)

	if (!byPrice) {
		const total = await prisma.product.count({ where })
		return {
			data: priced,
			meta: {
				page: params.page,
				limit: params.limit,
				total,
				totalPages: Math.ceil(total / params.limit) || 1,
				priceBounds: priceBoundsOf(priced),
			},
		}
	}

	/**
	 * Quote-only products have no price at any quantity (R2), so a price filter
	 * cannot include or exclude them on merit — it simply does not apply to
	 * them, and they drop out rather than being treated as free.
	 */
	const inRange = priced.filter((p) => {
		if (params.minPrice === undefined && params.maxPrice === undefined) return true
		if (p.priceFrom === null) return false
		const from = Number(p.priceFrom)
		if (params.minPrice !== undefined && from < params.minPrice) return false
		if (params.maxPrice !== undefined && from > params.maxPrice) return false
		return true
	})

	if (params.sort === "price_asc" || params.sort === "price_desc") {
		const direction = params.sort === "price_asc" ? 1 : -1
		inRange.sort((a, b) => {
			// A product with no price sorts last either way — it is not the
			// cheapest thing in the shop, it is unpriced.
			const av = a.priceFrom === null ? Number.POSITIVE_INFINITY : Number(a.priceFrom)
			const bv = b.priceFrom === null ? Number.POSITIVE_INFINITY : Number(b.priceFrom)
			if (av === bv) return 0
			if (!Number.isFinite(av)) return 1
			if (!Number.isFinite(bv)) return -1
			return (av - bv) * direction
		})
	}

	const start = (params.page - 1) * params.limit

	return {
		data: inRange.slice(start, start + params.limit),
		meta: {
			page: params.page,
			limit: params.limit,
			total: inRange.length,
			totalPages: Math.ceil(inRange.length / params.limit) || 1,
			// Bounds come from everything that matched the *other* filters, not
			// from what survived the price filter — otherwise dragging the slider
			// would shrink its own track.
			priceBounds: priceBoundsOf(priced),
		},
	}
}

const getBySlug = async (
	slug: string,
	locale: LocaleCode,
	role: PricingRole,
	quantity: number,
	/// Signed-in caller, so a ladder negotiated with them is honoured here too.
	userId?: string | null
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

	const [externalTiers, stockRules] = await Promise.all([
		loadExternalTiers({ productIds: [row.id], role, userId }),
		SettingService.getMap().then(readStockRules),
	])

	return toPublicProduct(row, locale, role, quantity, externalTiers(row.id), stockRules)
}

/**
 * Stock is per variant, so a product's stock status is a statement about its
 * variants as a set.
 *
 * IN_STOCK      — at least one variant can be bought right now.
 * ON_BACKORDER  — at least one variant is empty but still orderable.
 * OUT_OF_STOCK  — *every* variant is empty and none accepts backorders. Uses
 *                 `every` rather than `some`, because a product with one sold-out
 *                 variant and one in stock is still in stock.
 */
const stockWhere = (status: string, rules: StockRules): Prisma.ProductWhereInput => {
	// The same floor the product view and the purchase guards apply, expressed
	// as SQL. Filtering on a different number from the one the page displays is
	// how a listing ends up disagreeing with the product it links to.
	const floor = rules.outOfStockThreshold

	switch (status) {
		case "IN_STOCK":
			return { variants: { some: { OR: [{ manageStock: false }, { stock: { gt: floor } }] } } }
		case "ON_BACKORDER":
			return {
				variants: {
					some: { manageStock: true, stock: { lte: floor }, allowBackorder: true },
				},
			}
		case "OUT_OF_STOCK":
			return {
				variants: {
					every: { manageStock: true, stock: { lte: floor }, allowBackorder: false },
				},
			}
		default:
			return {}
	}
}

const adminList = async (params: {
	locale: LocaleCode
	kind?: string
	status?: string
	visibility?: string
	categoryId?: string
	stockStatus?: string
	search?: string
	page: number
	limit: number
}) => {
	const stockRules = params.stockStatus
		? readStockRules(await SettingService.getMap())
		: DEFAULT_STOCK_RULES

	const where: Prisma.ProductWhereInput = {
		...(params.kind ? { kind: params.kind as "MAIN" | "OPTION" } : {}),
		...(params.status ? { status: params.status as "DRAFT" | "PUBLISHED" | "ARCHIVED" } : {}),
		...(params.visibility
			? { visibility: params.visibility as "SHOP_AND_SEARCH" | "SHOP_ONLY" | "SEARCH_ONLY" | "HIDDEN" }
			: {}),
		// By id, not slug: the admin already holds ids, and a slug differs per
		// language while an id does not.
		...(params.categoryId ? { categories: { some: { categoryId: params.categoryId } } } : {}),
		...(params.stockStatus ? stockWhere(params.stockStatus, stockRules) : {}),
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

interface AttributeInput {
	attributeId: string
	attributeValueIds: string[]
	isVisible?: boolean
	isVariation?: boolean
}

/**
 * `{ attributeId, values[], flags }` → one row per value.
 *
 * The join table is keyed on (product, attribute, value), so a three-value
 * attribute is three rows. isVisible and isVariation describe the attribute
 * rather than the value, so they are copied onto each row and read back from
 * the first — grouping in the payload is what keeps them consistent.
 */
const expandAttributes = (input?: AttributeInput[]) =>
	(input ?? []).flatMap((attribute) =>
		attribute.attributeValueIds.map((attributeValueId) => ({
			attributeId: attribute.attributeId,
			attributeValueId,
			isVisible: attribute.isVisible ?? true,
			isVariation: attribute.isVariation ?? false,
		}))
	)

/**
 * A stored price row reduced to the fields a *new* one is created from.
 *
 * The rows loaded by `detailInclude` carry `id`, `productId`/`variantId` and
 * timestamps. Handed to `create`, which passes its `prices` array straight into
 * a nested Prisma `create`, those keys are rejected — and the copy would be
 * claiming the original's row id if they were not.
 */
const stripPriceRow = (row: {
	role: string
	basePrice: unknown
	salePrice: unknown
	saleStartsAt: Date | null
	saleEndsAt: Date | null
}) => ({
	role: row.role as "GUEST" | "B2C" | "RESELLER",
	basePrice: String(row.basePrice),
	salePrice: row.salePrice === null ? null : String(row.salePrice),
	saleStartsAt: row.saleStartsAt,
	saleEndsAt: row.saleEndsAt,
})

/** The same, for a rung of a quantity ladder. */
const stripTierRow = (row: {
	role: string
	minQuantity: number
	type: string
	value: unknown
}) => ({
	role: row.role as "GUEST" | "B2C" | "RESELLER",
	minQuantity: row.minQuantity,
	type: row.type as "FIXED_PRICE" | "PERCENTAGE" | "FIXED_AMOUNT",
	value: String(row.value),
})

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
	variants: { sku?: string | null }[],
	excludeProductId?: string
): Promise<void> => {
	const seen = new Set<string>()
	for (const v of variants) {
		// No SKU is not a clash. Any number of variants may have none, which is
		// why the column is nullable rather than an empty string — "" would
		// collide with itself in a unique index, NULL does not.
		const sku = v.sku?.trim()
		if (!sku) continue

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

		// The column is nullable, but this row was found by matching `seen`, which
		// holds only non-empty SKUs — so it has one. The fallback is unreachable
		// and exists only to satisfy the type.
		const sku = clash.sku ?? ""

		throw new ApiError(httpStatus.CONFLICT, `SKU ${sku} is already used`, {
			messageKey: "product.duplicateSku",
			messageVars: { sku, product: owner },
		})
	}
}

const create = async (payload: any, locale: LocaleCode, createdById?: string) => {
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
			shortDescription: sanitizeRichText(t.shortDescription),
			description: sanitizeRichText(t.description),
			metaTitle: t.metaTitle ?? null,
			metaDescription: stripHtml(t.metaDescription),
		}))
	)

	const created = await prisma.product.create({
		data: {
			// From the session, never the payload. An author a client can name is
			// an author a client can forge, and this is the one column here whose
			// only job is to be trustworthy.
			createdById: createdById ?? null,
			kind: payload.kind,
			status: payload.status,
			visibility: payload.visibility,
			quoteEnabled: payload.quoteEnabled,
			artworkMaxFiles: payload.artworkMaxFiles,
			artworkRequired: payload.artworkRequired,
			taxStatus: payload.taxStatus,
			moq: payload.moq,
			sortOrder: payload.sortOrder,
			featuredAssetId: payload.featuredAssetId ?? null,
			translations: { create: translations },
			tabs: {
				create: (payload.tabs ?? []).map((tab: TabInput, index: number) => ({
					sortOrder: tab.sortOrder ?? index,
					translations: {
						create: tab.translations.map((tt) => ({
							locale: tt.locale,
							title: tt.title,
							content: sanitizeRichText(tt.content),
						})),
					},
				})),
			},
			categories: {
				create: (payload.categoryIds ?? []).map((categoryId: string) => ({ categoryId })),
			},
			assets: {
				create: (payload.assetIds ?? []).map((assetId: string, i: number) => ({
					assetId,
					sortOrder: i,
				})),
			},
			// One row per selected value; the flags belong to the attribute, so
			// every row of an attribute carries the same pair.
			attributes: { create: expandAttributes(payload.attributes) },
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

/**
 * Copies a product, everything about it, as a draft.
 *
 * Built by reading the original and handing it back to `create` rather than
 * writing a second insert path. Slug resolution, SKU checking, the
 * one-default-variant rule and every default already live there; a parallel
 * copy routine would drift from them the first time any of it changed.
 *
 * Four things are deliberately not carried over:
 *
 * - **Status.** A duplicate is by definition identical to something already in
 *   the catalogue, so publishing it on creation puts two indistinguishable
 *   listings in the shop before anyone has edited one of them. It lands as a
 *   draft, which is also what WooCommerce's own Duplicate does. Newly *created*
 *   products still publish by default — that is a different act.
 * - **SKU.** It is unique, and it identifies one product. The copy gets none
 *   rather than an invented variation on the original's.
 * - **Slugs.** Re-derived from the new name, so the copy cannot take a URL that
 *   belongs to the live product.
 * - **The author.** Set to whoever pressed Duplicate. They are the one adding
 *   this row to the catalogue.
 *
 * Everything else is the point of the feature and is copied verbatim: prices,
 * tier ladders, categories, attributes, images, options, MOQ, tax status,
 * dimensions. Assets and option products are copied as *references* — they are
 * shared library rows, not per-product files, so the copy points at the same
 * ones rather than duplicating the media library alongside it.
 */
const duplicate = async (id: string, locale: LocaleCode, createdById?: string) => {
	const row = await prisma.product.findUnique({ where: { id }, include: detailInclude })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Product not found", {
			messageKey: "product.notFound",
		})
	}

	return create(
		{
			kind: row.kind,
			status: "DRAFT",
			visibility: row.visibility,
			quoteEnabled: row.quoteEnabled,
			artworkMaxFiles: row.artworkMaxFiles,
			artworkRequired: row.artworkRequired,
			taxStatus: row.taxStatus,
			moq: row.moq,
			sortOrder: row.sortOrder,
			featuredAssetId: row.featuredAssetId,
			categoryIds: row.categories.map((c) => c.categoryId),
			assetIds: row.assets.map((a) => a.assetId),

			// Slug omitted on purpose: `resolveSlug` derives a fresh one from the
			// copied name, so the duplicate can never claim the original's URL.
			translations: row.translations.map((t) => ({
				locale: t.locale,
				name: copyNameFor(t.name, t.locale),
				shortDescription: t.shortDescription ?? undefined,
				description: t.description ?? undefined,
				metaTitle: t.metaTitle ?? undefined,
				metaDescription: t.metaDescription ?? undefined,
			})),

			// Regrouped to one entry per attribute, the shape `expandAttributes`
			// expects — the table stores one row per selected value.
			attributes: [
				...row.attributes
					.reduce((map, a) => {
						const entry = map.get(a.attributeId) ?? {
							attributeId: a.attributeId,
							attributeValueIds: [] as string[],
							isVisible: a.isVisible,
							isVariation: a.isVariation,
						}
						entry.attributeValueIds.push(a.attributeValueId)
						return map.set(a.attributeId, entry)
					}, new Map<string, AttributeInput>())
					.values(),
			],

			prices: row.prices.map(stripPriceRow),
			tiers: row.priceTiers.map(stripTierRow),

			options: row.options.map((o) => ({
				optionProductId: o.optionProductId,
				sortOrder: o.sortOrder,
				groupLabel: o.groupLabel,
				preselected: o.preselected,
				discountPercent: o.discountPercent,
			})),

			variants: row.variants.map((v) => ({
				// No id — these are new rows, not an update of the originals.
				sku: null,
				isDefault: v.isDefault,
				isActive: v.isActive,
				sortOrder: v.sortOrder,
				moq: v.moq,
				manageStock: v.manageStock,
				// Stock is not inventory the copy owns. Starting a draft at the
				// original's count would claim goods that do not exist.
				stock: 0,
				allowBackorder: v.allowBackorder,
				lowStockThreshold: v.lowStockThreshold,
				weightKg: v.weightKg,
				lengthCm: v.lengthCm,
				widthCm: v.widthCm,
				heightCm: v.heightCm,
				imageAssetId: v.imageAssetId,
				attributeValueIds: v.attributeValues.map((a) => a.attributeValueId),
				prices: v.prices.map(stripPriceRow),
				tiers: v.priceTiers.map(stripTierRow),
			})),
		},
		locale,
		createdById
	)
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
				...(payload.artworkMaxFiles !== undefined ? { artworkMaxFiles: payload.artworkMaxFiles } : {}),
				...(payload.artworkRequired !== undefined ? { artworkRequired: payload.artworkRequired } : {}),
				...(payload.taxStatus !== undefined ? { taxStatus: payload.taxStatus } : {}),
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
					shortDescription: sanitizeRichText(t.shortDescription),
					description: sanitizeRichText(t.description),
					metaTitle: t.metaTitle ?? null,
					metaDescription: stripHtml(t.metaDescription),
				},
				update: {
					name: t.name,
					...(t.slug ? { slug } : {}),
					shortDescription: sanitizeRichText(t.shortDescription),
					description: sanitizeRichText(t.description),
					metaTitle: t.metaTitle ?? null,
					metaDescription: stripHtml(t.metaDescription),
				},
			})
		}

		if (payload.attributes) {
			// Replaced wholesale, like categories: the payload is the complete set
			// of attributes for this product.
			await tx.productAttribute.deleteMany({ where: { productId: id } })
			await tx.productAttribute.createMany({
				data: expandAttributes(payload.attributes).map((row) => ({ ...row, productId: id })),
			})
		}

		if (payload.categoryIds) {
			await tx.productCategory.deleteMany({ where: { productId: id } })
			await tx.productCategory.createMany({
				data: payload.categoryIds.map((categoryId: string) => ({ productId: id, categoryId })),
			})
		}

		// The gallery is an ordered list, so the array's own order becomes
		// sortOrder — that is what the editor's reorder buttons actually change.
		// Create accepted assetIds from the start; without this, a gallery could
		// be set once and never edited again.
		if (payload.assetIds) {
			await tx.productAsset.deleteMany({ where: { productId: id } })
			await tx.productAsset.createMany({
				data: payload.assetIds.map((assetId: string, i: number) => ({
					productId: id,
					assetId,
					sortOrder: i,
				})),
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

		/*
		 * Replaced wholesale, like the other collections on this form.
		 *
		 * Diffing would let a tab keep its id across a save, which matters for
		 * nothing here: nothing else references a tab, and the editor sends the
		 * whole list every time. Deleting and rewriting is the honest reading of
		 * "these are the tabs now".
		 */
		if (payload.tabs) {
			await tx.productTab.deleteMany({ where: { productId: id } })

			for (const [index, tab] of (payload.tabs as TabInput[]).entries()) {
				await tx.productTab.create({
					data: {
						productId: id,
						sortOrder: tab.sortOrder ?? index,
						translations: {
							create: tab.translations.map((tt) => ({
								locale: tt.locale,
								title: tt.title,
								content: sanitizeRichText(tt.content),
							})),
						},
					},
				})
			}
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
			/**
			 * Only keys the caller actually sent.
			 *
			 * `?? default` would turn every omitted field into an overwrite — an
			 * update that never mentioned stock would silently set it to 0. A new
			 * variant still needs the defaults, so those are applied on the create
			 * branch only.
			 */
			const patch = {
				sku: v.sku,
				...(v.isDefault !== undefined ? { isDefault: v.isDefault } : {}),
				...(v.isActive !== undefined ? { isActive: v.isActive } : {}),
				...(v.sortOrder !== undefined ? { sortOrder: v.sortOrder } : {}),
				...(v.moq !== undefined ? { moq: v.moq } : {}),
				...(v.manageStock !== undefined ? { manageStock: v.manageStock } : {}),
				...(v.stock !== undefined ? { stock: v.stock } : {}),
				...(v.allowBackorder !== undefined ? { allowBackorder: v.allowBackorder } : {}),
				...(v.lowStockThreshold !== undefined
					? { lowStockThreshold: v.lowStockThreshold }
					: {}),
				...(v.weightKg !== undefined ? { weightKg: v.weightKg } : {}),
				...(v.lengthCm !== undefined ? { lengthCm: v.lengthCm } : {}),
				...(v.widthCm !== undefined ? { widthCm: v.widthCm } : {}),
				...(v.heightCm !== undefined ? { heightCm: v.heightCm } : {}),
				...(v.imageAssetId !== undefined ? { imageAssetId: v.imageAssetId } : {}),
			}

			const variantId: string = v.id
				? (await tx.productVariant.update({ where: { id: v.id }, data: patch })).id
				: (
						await tx.productVariant.create({
							data: {
								isDefault: false,
								isActive: true,
								sortOrder: 0,
								moq: null,
								manageStock: true,
								stock: 0,
								allowBackorder: false,
								...patch,
								productId: id,
							},
						})
					).id

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
	duplicate,
	update,
	remove,
	pricingRoleFor: (role?: string, status?: string): PricingRole =>
		effectiveRole(
			(role ?? null) as never,
			(status ?? null) as never
		),
}
