import Decimal from "decimal.js"
import type { Prisma } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { applyMoqFloor, getEffectiveMoq, isBelowMoq } from "../../../domain/moq/getEffectiveMoq"
import { effectiveRole, type PricingRole } from "../../../domain/pricing/effectiveRole"
import { resolvePrice, type RolePriceInput } from "../../../domain/pricing/resolvePrice"
import {
	availableOf,
	canTake,
	DEFAULT_STOCK_RULES,
	readStockRules,
	type StockRules,
} from "../../../domain/stock/availability"
import { SettingService } from "../setting/setting.service"
import { storage } from "../../../helpers/storage"
import { ArtworkService } from "../media/artwork.service"
import { checkArtwork, checkArtworkComplete, readArtworkRules } from "../../../domain/product/artwork"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { generateToken } from "../../../shared/token"
import ApiError from "../../errors/ApiError"
import { GUEST_CART_TTL_DAYS } from "./cart.constant"
import { applyBundleDiscount, loadBundleDiscounts } from "./bundleDiscount"
import { loadExternalTiers, type ExternalTiers } from "../product/tierSources"

const cartInclude = {
	items: {
		include: {
			files: {
				include: { asset: { select: { id: true, originalName: true, sizeBytes: true, createdAt: true } } },
				orderBy: { sortOrder: "asc" },
			},
			variant: {
				include: {
					prices: true,
					priceTiers: true,
					image: true,
					translations: true,
					attributeValues: { include: { attributeValue: { include: { translations: true } } } },
					product: {
						include: { translations: true, prices: true, priceTiers: true, featuredAsset: true },
					},
				},
			},
		},
		orderBy: { createdAt: "asc" },
	},
} satisfies Prisma.CartInclude

type CartRow = Prisma.CartGetPayload<{ include: typeof cartInclude }>
type ItemRow = CartRow["items"][number]

const toArtworkFile = ArtworkService.toFile
const refuseArtwork = ArtworkService.refuse

const pick = <T extends { locale: string }>(rows: T[], locale: LocaleCode): T | undefined =>
	rows.find((r) => r.locale === locale) ??
	rows.find((r) => r.locale === DEFAULT_LOCALE) ??
	rows[0]

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
 * Prices every line from scratch on each read. Nothing is cached and nothing is
 * frozen at add-to-cart time: the tier depends on the current quantity, and the
 * role can change while a cart sits there.
 *
 * `bundleDiscounts` maps an option line's id to the discount its parent product
 * offers. Without it the configurator would quote 0.72 and the cart would then
 * charge 0.80 for the same line — the customer sees a price change between one
 * screen and the next, which is exactly the disagreement risk #1 is about.
 */
const priceLine = (
	item: ItemRow,
	role: PricingRole,
	bundleDiscounts?: Map<string, Decimal>,
	/**
	 * Ladders that live outside the product — the customer's own, and the
	 * categories'. Loaded once for the whole cart and handed in, because a
	 * category ladder is measured against every line at once and cannot be
	 * answered from a single line.
	 */
	externalTiers?: (productId: string) => ExternalTiers
) => {
	const product = item.variant.product

	const resolved = resolvePrice({
		quoteEnabled: product.quoteEnabled,
		role,
		quantity: item.quantity,
		productPrices: toPriceInputs(product.prices, product.priceTiers),
		variantPrices: toPriceInputs(item.variant.prices, item.variant.priceTiers),
		...(externalTiers?.(product.id) ?? {}),
	})

	const discount = bundleDiscounts?.get(item.id)
	if (!discount || !resolved.unitPrice) return resolved

	const unitPrice = applyBundleDiscount(resolved.unitPrice, discount)

	return {
		...resolved,
		unitPrice,
		lineTotal: unitPrice.mul(item.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
	}
}

const view = (
	cart: CartRow,
	locale: LocaleCode,
	role: PricingRole,
	bundleDiscounts?: Map<string, Decimal>,
	externalTiers?: (productId: string) => ExternalTiers,
	stockRules: StockRules = DEFAULT_STOCK_RULES
) => {
	const lines = cart.items
		// Option lines are nested under their parent rather than listed flat.
		.filter((i) => !i.parentItemId)
		.map((item) => {
			const build = (i: ItemRow) => {
				const product = i.variant.product
				const t = pick(product.translations, locale)
				const price = priceLine(i, role, bundleDiscounts, externalTiers)
				const moq = getEffectiveMoq({ productMoq: product.moq, variantMoq: i.variant.moq })
				const image = i.variant.image ?? product.featuredAsset

				return {
					id: i.id,
					variantId: i.variantId,
					productId: product.id,
					sku: i.variant.sku,
					name: t?.name ?? "(untitled)",
					slug: t?.slug ?? product.id,
					attributes: i.variant.attributeValues.map(
						(av) => pick(av.attributeValue.translations, locale)?.label ?? av.attributeValue.code
					),
					image: image ? { id: image.id, url: storage.publicUrl(image.storageKey) } : null,
					quantity: i.quantity,
					moq,
					belowMoq: isBelowMoq(i.quantity, moq),
					// The drawing this line is to be made from. Ordered as the customer
					// arranged it — the first file is the one production opens first.
					files: i.files.map((f) => toArtworkFile(f.asset)),
					artwork: readArtworkRules(product),
					// Flagged rather than refused: the cart is where the file is
					// attached, so blocking the page would leave nowhere to fix it.
					artworkMissing: checkArtworkComplete(readArtworkRules(product), i.files.length)?.kind === "REQUIRED",
					inStock: canTake(i.variant, i.quantity, stockRules),
					availableStock: availableOf(i.variant, stockRules),
					unitPrice: price.unitPrice?.toFixed(2) ?? null,
					listPrice: price.listPrice?.toFixed(2) ?? null,
					onSale: price.onSale,
					lineTotal: price.lineTotal?.toFixed(2) ?? null,
				}
			}

			return {
				...build(item),
				options: cart.items.filter((o) => o.parentItemId === item.id).map(build),
			}
		})

	// Sum every line including nested options. Each line total is already
	// rounded to 2dp, matching the old store's line-level rounding (§3.1).
	const subtotal = cart.items.reduce((sum, i) => {
		const total = priceLine(i, role, bundleDiscounts, externalTiers).lineTotal
		return total ? sum.plus(total) : sum
	}, new Decimal(0))

	const issues: string[] = []
	if (lines.some((l) => l.belowMoq || l.options.some((o) => o.belowMoq))) issues.push("BELOW_MOQ")
	if (lines.some((l) => !l.inStock || l.options.some((o) => !o.inStock))) issues.push("OUT_OF_STOCK")
	if (lines.some((l) => l.artworkMissing || l.options.some((o) => o.artworkMissing)))
		issues.push("ARTWORK_REQUIRED")

	const blocking = issues.filter((issue) => issue !== "ARTWORK_REQUIRED")

	return {
		id: cart.id,
		items: lines,
		itemCount: cart.items.reduce((n, i) => n + i.quantity, 0),
		lineCount: lines.length,
		subtotal: subtotal.toFixed(2),
		currency: "EUR",
		/// Flags the frontend must act on before allowing checkout.
		issues,
		/**
		 * A missing drawing is reported but does not hold anyone back.
		 *
		 * The upload field lives on the checkout page — the client asked for it
		 * there rather than here — so refusing to let the customer reach checkout
		 * would leave them with nowhere to fix what they are being told to fix.
		 * Nothing is lost by letting them through: `place` re-checks every line
		 * and refuses the order outright if a file is still missing.
		 */
		checkoutReady: blocking.length === 0 && lines.length > 0,
	}
}

export interface CartOwner {
	userId?: string
	token?: string
	role?: string
	status?: string
}

const expiryDate = (): Date =>
	new Date(Date.now() + GUEST_CART_TTL_DAYS * 24 * 60 * 60 * 1000)

/**
 * Finds the caller's cart, creating one if needed.
 *
 * When a signed-in user arrives holding a guest token, the guest cart is merged
 * into theirs and the token retired — filling a basket then signing in must not
 * lose the basket.
 */
const resolveCart = async (
	owner: CartOwner
): Promise<{ cart: CartRow; token: string | null; merged: boolean }> => {
	if (owner.userId) {
		let userCart = await prisma.cart.findFirst({
			where: { userId: owner.userId },
			include: cartInclude,
			orderBy: { updatedAt: "desc" },
		})

		let merged = false

		if (owner.token) {
			const guestCart = await prisma.cart.findUnique({
				where: { token: owner.token },
				include: cartInclude,
			})

			if (guestCart && !guestCart.userId) {
				if (!userCart) {
					// Nothing to merge into — simply claim it.
					await prisma.cart.update({
						where: { id: guestCart.id },
						data: { userId: owner.userId, token: null, expiresAt: null },
					})
					merged = true
				} else {
					await prisma.$transaction(async (tx) => {
						for (const item of guestCart.items) {
							const existing = userCart!.items.find(
								(i) => i.variantId === item.variantId && i.parentItemId === item.parentItemId
							)

							if (existing) {
								await tx.cartItem.update({
									where: { id: existing.id },
									data: { quantity: existing.quantity + item.quantity },
								})
							} else {
								await tx.cartItem.create({
									data: {
										cartId: userCart!.id,
										variantId: item.variantId,
										quantity: item.quantity,
									},
								})
							}
						}
						await tx.cart.delete({ where: { id: guestCart.id } })
					})
					merged = true
				}

				userCart = await prisma.cart.findFirst({
					where: { userId: owner.userId },
					include: cartInclude,
					orderBy: { updatedAt: "desc" },
				})
			}
		}

		if (!userCart) {
			userCart = await prisma.cart.create({
				data: { userId: owner.userId },
				include: cartInclude,
			})
		}

		return { cart: userCart, token: null, merged }
	}

	// Anonymous visitor.
	if (owner.token) {
		const existing = await prisma.cart.findUnique({
			where: { token: owner.token },
			include: cartInclude,
		})
		if (existing && !existing.userId) return { cart: existing, token: owner.token, merged: false }
	}

	const token = generateToken()
	const cart = await prisma.cart.create({
		data: { token, expiresAt: expiryDate() },
		include: cartInclude,
	})

	return { cart, token, merged: false }
}

const roleOf = (owner: CartOwner): PricingRole =>
	effectiveRole((owner.role ?? null) as never, (owner.status ?? null) as never)

const get = async (owner: CartOwner, locale: LocaleCode) => {
	const { cart, token } = await resolveCart(owner)
	/**
	 * Loaded once per read, for the whole cart.
	 *
	 * A category ladder is measured against every line at once, so it cannot be
	 * resolved line by line — and loading per line would turn a twenty-line cart
	 * into forty queries.
	 */
	const role = roleOf(owner)
	const externalTiers = await loadExternalTiers({
		productIds: [...new Set(cart.items.map((i) => i.variant.productId))],
		role,
		userId: owner.userId,
		cartId: cart.id,
		withCategoryQuantities: true,
	})

	return {
		cart: view(
			cart,
			locale,
			role,
			await loadBundleDiscounts(cart.items),
			externalTiers,
			readStockRules(await SettingService.getMap())
		),
		token,
	}
}

const addItem = async (
	owner: CartOwner,
	payload: {
		variantId: string
		quantity: number
		parentItemId?: string | null
		/** Design files, uploaded before the add and owned by the caller. */
		assetIds?: string[]
	},
	locale: LocaleCode
) => {
	const { cart, token } = await resolveCart(owner)

	const variant = await prisma.productVariant.findUnique({
		where: { id: payload.variantId },
		include: { product: true },
	})

	if (!variant || !variant.isActive || variant.product.status !== "PUBLISHED") {
		throw new ApiError(httpStatus.NOT_FOUND, "That product is not available", {
			messageKey: "cart.variantUnavailable",
		})
	}

	// R2: quote-only products can never enter the cart. They are ordered through
	// the inquiry basket instead.
	if (variant.product.quoteEnabled) {
		throw new ApiError(httpStatus.CONFLICT, "This product is available only through a quote", {
			messageKey: "cart.quoteOnly",
		})
	}

	const moq = getEffectiveMoq({ productMoq: variant.product.moq, variantMoq: variant.moq })

	// R4: reject on add — do not silently raise. The customer asked for a
	// specific number and deserves to be told the minimum, not surprised by it.
	if (isBelowMoq(payload.quantity, moq)) {
		throw new ApiError(httpStatus.BAD_REQUEST, "Below the minimum order quantity", {
			messageKey: "cart.belowMoq",
			messageVars: { moq: String(moq), quantity: String(payload.quantity) },
		})
	}

	const assetIds = payload.assetIds ?? []

	/*
	 * Two of the same part cut to two different drawings are not the same line,
	 * so an add carrying files never merges — and neither does a line that
	 * already has some. Merging them would silently make one drawing win.
	 */
	const existing = assetIds.length
		? undefined
		: cart.items.find(
				(i) =>
					i.variantId === payload.variantId &&
					i.parentItemId === (payload.parentItemId ?? null) &&
					i.files.length === 0
			)

	const newQuantity = (existing?.quantity ?? 0) + payload.quantity

	const stockRules = readStockRules(await SettingService.getMap())

	if (!canTake(variant, newQuantity, stockRules)) {
		throw new ApiError(httpStatus.CONFLICT, "Not enough stock", {
			messageKey: "cart.insufficientStock",
			messageVars: { available: String(availableOf(variant, stockRules) ?? 0) },
		})
	}

	if (existing) {
		await prisma.cartItem.update({
			where: { id: existing.id },
			data: { quantity: newQuantity },
		})
	} else {
		// Checked before the line exists, so a refusal leaves nothing behind.
		refuseArtwork(checkArtwork(readArtworkRules(variant.product), assetIds.length))
		const assets = await ArtworkService.assertOwned(assetIds, owner.userId)

		await prisma.cartItem.create({
			data: {
				cartId: cart.id,
				variantId: payload.variantId,
				quantity: payload.quantity,
				parentItemId: payload.parentItemId ?? null,
				files: {
					create: assets.map((asset, index) => ({ assetId: asset.id, sortOrder: index })),
				},
			},
		})
	}

	await prisma.cart.update({
		where: { id: cart.id },
		data: { expiresAt: cart.userId ? null : expiryDate() },
	})

	const fresh = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude })
	return {
		cart: view(fresh!, locale, roleOf(owner), await loadBundleDiscounts(fresh!.items), undefined, stockRules),
		token,
	}
}

const updateItem = async (
	owner: CartOwner,
	itemId: string,
	quantity: number,
	locale: LocaleCode
) => {
	const { cart, token } = await resolveCart(owner)

	const item = cart.items.find((i) => i.id === itemId)
	if (!item) {
		throw new ApiError(httpStatus.NOT_FOUND, "That line is not in your cart", {
			messageKey: "cart.itemNotFound",
		})
	}

	// Quantity 0 means remove — the usual meaning of typing 0 into a cart field.
	if (quantity === 0) {
		await prisma.cartItem.delete({ where: { id: itemId } })
		const fresh = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude })
		return { cart: view(fresh!, locale, roleOf(owner), await loadBundleDiscounts(fresh!.items)), token, adjusted: false }
	}

	const moq = getEffectiveMoq({
		productMoq: item.variant.product.moq,
		variantMoq: item.variant.moq,
	})

	// R4: on update the quantity is RAISED to the minimum rather than rejected,
	// and the caller is told so it can show a notice. Different from add-to-cart
	// on purpose — the line already exists, so refusing would just strand it.
	const { quantity: finalQuantity, adjusted } = applyMoqFloor(quantity, moq)

	const stockRules = readStockRules(await SettingService.getMap())

	if (!canTake(item.variant, finalQuantity, stockRules)) {
		throw new ApiError(httpStatus.CONFLICT, "Not enough stock", {
			messageKey: "cart.insufficientStock",
			messageVars: { available: String(availableOf(item.variant, stockRules) ?? 0) },
		})
	}

	await prisma.cartItem.update({ where: { id: itemId }, data: { quantity: finalQuantity } })

	const fresh = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude })
	return {
		cart: view(fresh!, locale, roleOf(owner), await loadBundleDiscounts(fresh!.items), undefined, stockRules),
		token,
		adjusted,
	}
}

const removeItem = async (owner: CartOwner, itemId: string, locale: LocaleCode) => {
	const { cart, token } = await resolveCart(owner)

	const item = cart.items.find((i) => i.id === itemId)
	if (!item) {
		throw new ApiError(httpStatus.NOT_FOUND, "That line is not in your cart", {
			messageKey: "cart.itemNotFound",
		})
	}

	// Option lines cascade with their parent (§4.6) — the database FK handles it.
	await prisma.cartItem.delete({ where: { id: itemId } })

	const fresh = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude })
	return {
		cart: view(
			fresh!,
			locale,
			roleOf(owner),
			await loadBundleDiscounts(fresh!.items),
			undefined,
			readStockRules(await SettingService.getMap())
		),
		token,
	}
}

const clear = async (owner: CartOwner, locale: LocaleCode) => {
	const { cart, token } = await resolveCart(owner)
	await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })

	const fresh = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude })
	return {
		cart: view(
			fresh!,
			locale,
			roleOf(owner),
			await loadBundleDiscounts(fresh!.items),
			undefined,
			readStockRules(await SettingService.getMap())
		),
		token,
	}
}

export const CartService = { get, addItem, updateItem, removeItem, clear }
