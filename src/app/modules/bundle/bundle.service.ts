import type { Prisma } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import {
	priceBundle,
	startingQuantityFor,
	type ConfigurableLine,
} from "../../../domain/bundle/priceBundle"
import { effectiveRole, type PricingRole } from "../../../domain/pricing/effectiveRole"
import type { RolePriceInput } from "../../../domain/pricing/resolvePrice"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"

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

const variantInclude = {
	prices: true,
	priceTiers: true,
	product: { include: { translations: true, prices: true, priceTiers: true } },
} satisfies Prisma.ProductVariantInclude

type VariantRow = Prisma.ProductVariantGetPayload<{ include: typeof variantInclude }>

const toLine = (
	variant: VariantRow,
	quantity: number,
	locale: LocaleCode,
	discountPercent?: string | null
): ConfigurableLine => ({
	variantId: variant.id,
	sku: variant.sku,
	name: pick(variant.product.translations, locale)?.name ?? variant.sku,
	quantity,
	productMoq: variant.product.moq,
	variantMoq: variant.moq,
	quoteEnabled: variant.product.quoteEnabled,
	productPrices: toPriceInputs(variant.product.prices, variant.product.priceTiers),
	variantPrices: toPriceInputs(variant.prices, variant.priceTiers),
	discountPercent: discountPercent ?? null,
})

interface Selection {
	variantId: string
	quantity: number
}

/**
 * Loads the main variant and every selected option, checking that each option
 * is genuinely offered by this product. A client could otherwise post any
 * variant id as an "option" and buy it at the bundle discount.
 */
const loadConfiguration = async (
	variantId: string,
	options: Selection[],
	locale: LocaleCode
) => {
	const main = await prisma.productVariant.findUnique({
		where: { id: variantId },
		include: variantInclude,
	})

	if (!main || !main.isActive || main.product.status !== "PUBLISHED") {
		throw new ApiError(httpStatus.NOT_FOUND, "That product is not available", {
			messageKey: "bundle.mainUnavailable",
		})
	}

	const offered = await prisma.productOption.findMany({
		where: { productId: main.productId },
		include: {
			optionProduct: {
				include: { translations: true, variants: { include: variantInclude } },
			},
		},
		orderBy: { sortOrder: "asc" },
	})

	const offeredVariants = new Map<string, { variant: VariantRow; discountPercent: string | null }>()
	for (const o of offered) {
		for (const v of o.optionProduct.variants) {
			offeredVariants.set(v.id, {
				variant: v as VariantRow,
				discountPercent: o.discountPercent?.toString() ?? null,
			})
		}
	}

	const optionLines: ConfigurableLine[] = []

	for (const sel of options) {
		const entry = offeredVariants.get(sel.variantId)
		if (!entry) {
			throw new ApiError(httpStatus.BAD_REQUEST, "That option is not offered with this product", {
				messageKey: "bundle.optionNotOffered",
			})
		}
		if (!entry.variant.isActive || entry.variant.product.status !== "PUBLISHED") {
			throw new ApiError(httpStatus.CONFLICT, "An option is no longer available", {
				messageKey: "bundle.optionUnavailable",
				messageVars: { sku: entry.variant.sku },
			})
		}

		optionLines.push(toLine(entry.variant, sel.quantity, locale, entry.discountPercent))
	}

	return { main, offered, optionLines }
}

const roleOf = (ctx: { role?: string; status?: string }): PricingRole =>
	effectiveRole((ctx.role ?? null) as never, (ctx.status ?? null) as never)

/** Live repricing as the customer ticks options and changes quantities. */
const price = async (
	ctx: { role?: string; status?: string },
	payload: { variantId: string; quantity: number; options: Selection[] },
	locale: LocaleCode
) => {
	const { main, offered, optionLines } = await loadConfiguration(
		payload.variantId,
		payload.options,
		locale
	)

	const priced = priceBundle({
		role: roleOf(ctx),
		main: toLine(main, payload.quantity, locale),
		options: optionLines,
	})

	return {
		...priced,
		/// Everything on offer, with the quantity each would start at if ticked.
		available: offered.flatMap((o) =>
			o.optionProduct.variants
				.filter((v) => v.isActive)
				.map((v) => ({
					variantId: v.id,
					sku: v.sku,
					name: pick(o.optionProduct.translations, locale)?.name ?? v.sku,
					groupLabel: o.groupLabel,
					preselected: o.preselected,
					startQuantity: startingQuantityFor(o.optionProduct.moq, v.moq),
					moq: o.optionProduct.moq,
					discountPercent: o.discountPercent?.toString() ?? null,
				}))
		),
	}
}

/**
 * Adds the whole configuration to the cart in ONE transaction.
 *
 * Atomic on purpose: a cutter without its engraving is not a smaller order, it
 * is the wrong order. Either every line lands or none does — the old code added
 * lines one at a time and compensated by hand when something failed part-way.
 */
const addToCart = async (
	owner: { userId?: string; cartId: string },
	ctx: { role?: string; status?: string },
	payload: { variantId: string; quantity: number; options: Selection[] },
	locale: LocaleCode
) => {
	const { main, optionLines } = await loadConfiguration(payload.variantId, payload.options, locale)

	const priced = priceBundle({
		role: roleOf(ctx),
		main: toLine(main, payload.quantity, locale),
		options: optionLines,
	})

	// Validate in the SERVICE layer, not in an HTTP hook. The old shop's bundle
	// path called the cart directly and skipped add-time validation entirely,
	// so MOQ and quote-only rules simply did not apply to configurator lines
	// (risk #17). Every path reaches this check.
	if (!priced.addable) {
		const first = priced.issues[0]!
		const messageKey =
			first.problem === "BELOW_MOQ"
				? "bundle.lineBelowMoq"
				: first.problem === "QUOTE_ONLY"
					? "bundle.lineQuoteOnly"
					: "bundle.lineNoPrice"

		throw new ApiError(httpStatus.CONFLICT, "This configuration cannot be added", {
			messageKey,
			messageVars: { sku: first.line, moq: String(first.moq ?? 0) },
		})
	}

	// Stock, checked across the whole configuration before anything is written.
	for (const line of [
		{ variantId: main.id, quantity: payload.quantity, v: main },
		...optionLines.map((o) => ({
			variantId: o.variantId,
			quantity: o.quantity,
			v: null as VariantRow | null,
		})),
	]) {
		const variant =
			line.v ?? (await prisma.productVariant.findUnique({ where: { id: line.variantId } }))
		if (variant?.manageStock && !variant.allowBackorder && line.quantity > variant.stock) {
			throw new ApiError(httpStatus.CONFLICT, "Not enough stock", {
				messageKey: "cart.insufficientStock",
				messageVars: { available: String(variant.stock) },
			})
		}
	}

	await prisma.$transaction(async (tx) => {
		const parent = await tx.cartItem.create({
			data: { cartId: owner.cartId, variantId: main.id, quantity: payload.quantity },
		})

		for (const option of optionLines) {
			await tx.cartItem.create({
				data: {
					cartId: owner.cartId,
					variantId: option.variantId,
					quantity: option.quantity,
					// Cascades on delete, so removing the cutter removes its
					// engraving — the customer never ends up owning an option on
					// its own.
					parentItemId: parent.id,
				},
			})
		}
	})
}

export const BundleService = { price, addToCart, loadConfiguration }
