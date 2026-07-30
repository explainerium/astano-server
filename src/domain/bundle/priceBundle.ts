import Decimal from "decimal.js"
import { getEffectiveMoq, isBelowMoq } from "../moq/getEffectiveMoq"
import { resolvePrice, type RolePriceInput } from "../pricing/resolvePrice"
import type { PricingRole } from "../pricing/effectiveRole"

/**
 * The product-option configurator (§4.6).
 *
 * This is NOT an upsell widget. For bespoke goods it is the only way to order
 * engraving, coating, alloy or packaging, and each selected option becomes its
 * own order line with its own SKU, MOQ and tier ladder. A "custom cookie cutter
 * with gold coating in a gift box" is three lines, not one.
 *
 * Rules this encodes, from the old shop's behaviour:
 *   • options start UNSELECTED
 *   • each option's quantity starts at ITS OWN MOQ, not at 1 and not at the
 *     main product's quantity
 *   • every line is priced independently through resolvePrice(), so tier
 *     ladders apply per line
 *   • MOQ is validated per line — the old code added bundle lines through a
 *     path that skipped validation entirely (risk #17)
 *
 * Pure: no Prisma, no Express, no clock.
 */

export interface ConfigurableLine {
	/// Identifies the line back to the caller — a variant id in practice.
	variantId: string
	sku: string
	name: string
	quantity: number
	productMoq: number
	variantMoq?: number | null
	quoteEnabled?: boolean
	productPrices: RolePriceInput[]
	variantPrices?: RolePriceInput[]
	/// Extra discount for taking this option with the main product.
	discountPercent?: Decimal | string | number | null
}

export interface PricedLine {
	variantId: string
	sku: string
	name: string
	quantity: number
	moq: number
	belowMoq: boolean
	unitPrice: string | null
	lineTotal: string | null
	/// Set when a bundle discount changed the price.
	discountedFrom?: string | null
	quoteOnly: boolean
}

export interface PriceBundleInput {
	role: PricingRole
	main: ConfigurableLine
	options: ConfigurableLine[]
	now?: Date
}

export interface PricedBundle {
	main: PricedLine
	options: PricedLine[]
	subtotal: string
	/// Everything wrong with this configuration, so the UI can disable the
	/// button and say why rather than failing at add-to-cart.
	issues: {
		line: string
		problem: "BELOW_MOQ" | "NO_PRICE" | "QUOTE_ONLY"
		moq?: number
	}[]
	addable: boolean
}

const priceLine = (line: ConfigurableLine, role: PricingRole, now?: Date): PricedLine => {
	const moq = getEffectiveMoq({ productMoq: line.productMoq, variantMoq: line.variantMoq })

	const resolved = resolvePrice({
		quoteEnabled: line.quoteEnabled,
		role,
		quantity: line.quantity,
		productPrices: line.productPrices,
		variantPrices: line.variantPrices,
		now,
	})

	let unitPrice = resolved.unitPrice
	let discountedFrom: string | null = null

	// The bundle discount applies on top of whatever tier the quantity earned,
	// so a customer buying 500 engravings keeps their tier price and the bundle
	// saving as well.
	if (unitPrice && line.discountPercent !== null && line.discountPercent !== undefined) {
		const percent = new Decimal(line.discountPercent)
		if (percent.greaterThan(0)) {
			discountedFrom = unitPrice.toFixed(2)
			unitPrice = unitPrice.mul(new Decimal(100).minus(percent)).div(100)
			if (unitPrice.lessThan(0)) unitPrice = new Decimal(0)
		}
	}

	const lineTotal = unitPrice
		? unitPrice.mul(line.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
		: null

	return {
		variantId: line.variantId,
		sku: line.sku,
		name: line.name,
		quantity: line.quantity,
		moq,
		belowMoq: isBelowMoq(line.quantity, moq),
		unitPrice: unitPrice?.toFixed(2) ?? null,
		lineTotal: lineTotal?.toFixed(2) ?? null,
		discountedFrom,
		quoteOnly: Boolean(line.quoteEnabled),
	}
}

export const priceBundle = (input: PriceBundleInput): PricedBundle => {
	const main = priceLine(input.main, input.role, input.now)
	const options = input.options.map((o) => priceLine(o, input.role, input.now))

	const issues: PricedBundle["issues"] = []

	for (const line of [main, ...options]) {
		if (line.quoteOnly) {
			issues.push({ line: line.sku, problem: "QUOTE_ONLY" })
			continue
		}
		if (line.belowMoq) issues.push({ line: line.sku, problem: "BELOW_MOQ", moq: line.moq })
		if (line.lineTotal === null) issues.push({ line: line.sku, problem: "NO_PRICE" })
	}

	const subtotal = [main, ...options].reduce(
		(sum, l) => (l.lineTotal ? sum.plus(l.lineTotal) : sum),
		new Decimal(0)
	)

	return {
		main,
		options,
		subtotal: subtotal.toFixed(2),
		issues,
		addable: issues.length === 0,
	}
}

/**
 * The quantity an option should start at when the customer first ticks it.
 *
 * Its own MOQ, never 1 and never the main product's quantity — ordering 50
 * cutters does not mean ordering 50 engravings when engraving comes in units
 * of 500.
 */
export const startingQuantityFor = (productMoq: number, variantMoq?: number | null): number => {
	const moq = getEffectiveMoq({ productMoq, variantMoq })
	return moq > 0 ? moq : 1
}
