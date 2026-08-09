import type { Prisma } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { effectiveRole, type PricingRole } from "../../../domain/pricing/effectiveRole"
import { resolvePrice, type RolePriceInput } from "../../../domain/pricing/resolvePrice"
import { DEFAULT_STOCK_RULES, isInStock, readStockRules, type StockRules } from "../../../domain/stock/availability"
import { SettingService } from "../setting/setting.service"
import { storage } from "../../../helpers/storage"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { generateToken } from "../../../shared/token"
import ApiError from "../../errors/ApiError"

const include = {
	items: {
		include: {
			variant: {
				include: {
					prices: true,
					priceTiers: true,
					image: true,
					product: {
						include: { translations: true, prices: true, priceTiers: true, featuredAsset: true },
					},
				},
			},
		},
		orderBy: { createdAt: "desc" },
	},
} satisfies Prisma.WishlistInclude

type Row = Prisma.WishlistGetPayload<{ include: typeof include }>

const pick = <T extends { locale: string }>(rows: T[], locale: LocaleCode): T | undefined =>
	rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === DEFAULT_LOCALE) ?? rows[0]

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

const view = (
	row: Row,
	locale: LocaleCode,
	role: PricingRole,
	stockRules: StockRules = DEFAULT_STOCK_RULES
) => ({
	id: row.id,
	itemCount: row.items.length,
	items: row.items.map((i) => {
		const product = i.variant.product
		const t = pick(product.translations, locale)
		const image = i.variant.image ?? product.featuredAsset

		// Priced live, like everywhere else. A list kept for months must not show
		// a price from the day it was saved.
		const price = resolvePrice({
			quoteEnabled: product.quoteEnabled,
			role,
			quantity: Math.max(product.moq, 1),
			productPrices: toPriceInputs(product.prices, product.priceTiers),
			variantPrices: toPriceInputs(i.variant.prices, i.variant.priceTiers),
		})

		return {
			id: i.id,
			variantId: i.variantId,
			productId: product.id,
			sku: i.variant.sku,
			name: t?.name ?? "(untitled)",
			slug: t?.slug ?? product.id,
			image: image ? { id: image.id, url: storage.publicUrl(image.storageKey) } : null,
			quoteOnly: product.quoteEnabled,
			moq: product.moq,
			inStock: isInStock(i.variant, stockRules),
			/// False once a product is unpublished or a variant disabled — the
			/// entry stays visible so the customer knows why it cannot be bought.
			available: i.variant.isActive && product.status === "PUBLISHED",
			unitPrice: price.unitPrice?.toFixed(2) ?? null,
			addedAt: i.createdAt,
		}
	}),
})

export interface Owner {
	userId?: string
	token?: string
	role?: string
	status?: string
}

const TTL_DAYS = 180

/** Guests keep a list too; it merges into the account on sign-in. */
const resolveList = async (owner: Owner): Promise<{ list: Row; token: string | null }> => {
	if (owner.userId) {
		let mine = await prisma.wishlist.findUnique({ where: { userId: owner.userId }, include })

		if (owner.token) {
			const guest = await prisma.wishlist.findUnique({ where: { token: owner.token }, include })

			if (guest && !guest.userId) {
				if (!mine) {
					await prisma.wishlist.update({
						where: { id: guest.id },
						data: { userId: owner.userId, token: null, expiresAt: null },
					})
				} else {
					await prisma.$transaction(async (tx) => {
						for (const item of guest.items) {
							// A product on both lists is one entry, not two.
							await tx.wishlistItem.upsert({
								where: {
									wishlistId_variantId: { wishlistId: mine!.id, variantId: item.variantId },
								},
								create: { wishlistId: mine!.id, variantId: item.variantId },
								update: {},
							})
						}
						await tx.wishlist.delete({ where: { id: guest.id } })
					})
				}

				mine = await prisma.wishlist.findUnique({ where: { userId: owner.userId }, include })
			}
		}

		if (!mine) {
			mine = await prisma.wishlist.create({ data: { userId: owner.userId }, include })
		}

		return { list: mine, token: null }
	}

	if (owner.token) {
		const existing = await prisma.wishlist.findUnique({ where: { token: owner.token }, include })
		if (existing && !existing.userId) return { list: existing, token: owner.token }
	}

	const token = generateToken()
	const list = await prisma.wishlist.create({
		data: { token, expiresAt: new Date(Date.now() + TTL_DAYS * 864e5) },
		include,
	})

	return { list, token }
}

const roleOf = (o: Owner): PricingRole =>
	effectiveRole((o.role ?? null) as never, (o.status ?? null) as never)

const reload = async (id: string, locale: LocaleCode, role: PricingRole) => {
	const fresh = await prisma.wishlist.findUnique({ where: { id }, include })
	return view(fresh!, locale, role, readStockRules(await SettingService.getMap()))
}

const get = async (owner: Owner, locale: LocaleCode) => {
	const { list, token } = await resolveList(owner)
	return {
		list: view(list, locale, roleOf(owner), readStockRules(await SettingService.getMap())),
		token,
	}
}

const add = async (owner: Owner, variantId: string, locale: LocaleCode) => {
	const { list, token } = await resolveList(owner)

	const variant = await prisma.productVariant.findUnique({
		where: { id: variantId },
		include: { product: true },
	})

	if (!variant || variant.product.status !== "PUBLISHED") {
		throw new ApiError(httpStatus.NOT_FOUND, "That product is not available", {
			messageKey: "wishlist.unavailable",
		})
	}

	// Adding twice is not an error — the button is a toggle, and a duplicate
	// click should be quietly idempotent.
	await prisma.wishlistItem.upsert({
		where: { wishlistId_variantId: { wishlistId: list.id, variantId } },
		create: { wishlistId: list.id, variantId },
		update: {},
	})

	return { list: await reload(list.id, locale, roleOf(owner)), token }
}

const remove = async (owner: Owner, variantId: string, locale: LocaleCode) => {
	const { list, token } = await resolveList(owner)
	await prisma.wishlistItem.deleteMany({ where: { wishlistId: list.id, variantId } })
	return { list: await reload(list.id, locale, roleOf(owner)), token }
}

const clear = async (owner: Owner, locale: LocaleCode) => {
	const { list, token } = await resolveList(owner)
	await prisma.wishlistItem.deleteMany({ where: { wishlistId: list.id } })
	return { list: await reload(list.id, locale, roleOf(owner)), token }
}

export const WishlistService = { get, add, remove, clear }
