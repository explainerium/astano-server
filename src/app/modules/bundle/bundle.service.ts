import type { Prisma } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import {
	priceBundle,
	startingQuantityFor,
	type ConfigurableLine,
} from "../../../domain/bundle/priceBundle"
import { effectiveRole, type PricingRole } from "../../../domain/pricing/effectiveRole"
import type { RolePriceInput } from "../../../domain/pricing/resolvePrice"
import { availableOf, canTake, readStockRules } from "../../../domain/stock/availability"
import { SettingService } from "../setting/setting.service"
import { loadExternalTiers, type ExternalTiers } from "../product/tierSources"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"

const pick = <T extends { locale: string }>(rows: T[], locale: LocaleCode): T | undefined =>
	rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === DEFAULT_LOCALE) ?? rows[0]

/**
 * How to name a variant in a message to a customer.
 *
 * SKU first — it is what appears on the cart line they are being asked to fix —
 * then the product name for the products that have no SKU. Reads correctly
 * either way: every message using this interpolates a bare identifier
 * ("{sku} is no longer available"), never the literal word "SKU".
 */
const labelFor = (
	variant: { sku: string | null; product: { translations: { locale: string; name: string }[] } },
	locale: LocaleCode
): string => variant.sku ?? pick(variant.product.translations, locale)?.name ?? "This item"

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
	discountPercent?: string | null,
	/**
	 * The ladders that live outside the product, for this variant's product.
	 *
	 * Optional only so the signature reads the same as it did; every caller
	 * passes it. Leaving it out is what made the configurator quote a dealer the
	 * catalogue price and the cart then charge the agreed one.
	 */
	external?: ExternalTiers
): ConfigurableLine => ({
	variantId: variant.id,
	sku: variant.sku,
	name: pick(variant.product.translations, locale)?.name ?? variant.sku ?? "(untitled)",
	quantity,
	productMoq: variant.product.moq,
	variantMoq: variant.moq,
	quoteEnabled: variant.product.quoteEnabled,
	productPrices: toPriceInputs(variant.product.prices, variant.product.priceTiers),
	variantPrices: toPriceInputs(variant.prices, variant.priceTiers),
	discountPercent: discountPercent ?? null,
	...external,
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

	/*
	 * The chosen variants, not lines built from them.
	 *
	 * Pricing needs the ladders that hang off each option's *product*, and those
	 * are loaded in one batch by the caller — which it can only do once it knows
	 * which products are involved. Handing back the rows keeps that possible;
	 * handing back finished lines meant they were priced before anybody had
	 * looked a customer ladder up.
	 */
	const chosen: { variant: VariantRow; quantity: number; discountPercent: string | null }[] = []

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
				messageVars: { sku: labelFor(entry.variant, locale) },
			})
		}

		chosen.push({
			variant: entry.variant,
			quantity: sel.quantity,
			discountPercent: entry.discountPercent,
		})
	}

	return { main, offered, chosen }
}

interface Viewer {
	userId?: string
	role?: string
	status?: string
}

const roleOf = (ctx: Viewer): PricingRole =>
	effectiveRole((ctx.role ?? null) as never, (ctx.status ?? null) as never)

/**
 * The ladders outside the product, for every product in one configuration.
 *
 * `withCategoryQuantities` is deliberately off, matching the product page: a
 * category ladder is measured against the whole basket, and the configurator is
 * answering "what would this line cost", not "what does my basket now cost".
 * The cart remains the authority on the second question.
 */
const externalTiersFor = async (ctx: Viewer, productIds: string[]) =>
	loadExternalTiers({
		productIds: [...new Set(productIds)],
		role: roleOf(ctx),
		userId: ctx.userId,
	})

/** Live repricing as the customer ticks options and changes quantities. */
const price = async (
	ctx: Viewer,
	payload: { variantId: string; quantity: number; options: Selection[] },
	locale: LocaleCode
) => {
	const { main, offered, chosen } = await loadConfiguration(
		payload.variantId,
		payload.options,
		locale
	)

	const external = await externalTiersFor(ctx, [
		main.productId,
		...chosen.map((option) => option.variant.productId),
	])

	const priced = priceBundle({
		role: roleOf(ctx),
		main: toLine(main, payload.quantity, locale, null, external(main.productId)),
		options: chosen.map((option) =>
			toLine(
				option.variant,
				option.quantity,
				locale,
				option.discountPercent,
				external(option.variant.productId)
			)
		),
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
	ctx: Viewer,
	payload: { variantId: string; quantity: number; options: Selection[] },
	locale: LocaleCode
) => {
	const { main, chosen } = await loadConfiguration(payload.variantId, payload.options, locale)

	const external = await externalTiersFor(ctx, [
		main.productId,
		...chosen.map((option) => option.variant.productId),
	])

	const priced = priceBundle({
		role: roleOf(ctx),
		main: toLine(main, payload.quantity, locale, null, external(main.productId)),
		options: chosen.map((option) =>
			toLine(
				option.variant,
				option.quantity,
				locale,
				option.discountPercent,
				external(option.variant.productId)
			)
		),
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
	const stockRules = readStockRules(await SettingService.getMap())

	// `chosen` already carries the whole variant row, so this no longer fetches
	// each option again one at a time.
	for (const line of [
		{ variant: main, quantity: payload.quantity },
		...chosen.map((option) => ({ variant: option.variant, quantity: option.quantity })),
	]) {
		if (!canTake(line.variant, line.quantity, stockRules)) {
			throw new ApiError(httpStatus.CONFLICT, "Not enough stock", {
				messageKey: "cart.insufficientStock",
				messageVars: { available: String(availableOf(line.variant, stockRules) ?? 0) },
			})
		}
	}

	await prisma.$transaction(async (tx) => {
		const parent = await tx.cartItem.create({
			data: { cartId: owner.cartId, variantId: main.id, quantity: payload.quantity },
		})

		for (const option of chosen) {
			await tx.cartItem.create({
				data: {
					cartId: owner.cartId,
					variantId: option.variant.id,
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
