import Decimal from "decimal.js"
import type { PricingRole } from "./effectiveRole"

/**
 * THE pricing function. Spec risk #1.
 *
 * Six surfaces must agree on what a product costs — archive price range,
 * product page, tier table, cart, options preview, quote line. They agree
 * because they all call this and nothing computes a price inline.
 *
 * Pure: no Prisma, no Express, no clock of its own (pass `now`). That is what
 * makes it testable against fixtures and impossible to bypass.
 *
 * Uses decimal.js rather than Prisma.Decimal so the domain layer stays free of
 * framework imports. Prisma.Decimal *is* a decimal.js instance, so values pass
 * straight through from the database.
 */

export type TierType = "FIXED_PRICE" | "PERCENTAGE" | "FIXED_AMOUNT"

export type Numeric = Decimal | string | number

export interface TierInput {
	minQuantity: number
	type: TierType
	value: Numeric
}

export interface RolePriceInput {
	role: PricingRole
	basePrice: Numeric
	salePrice?: Numeric | null
	saleStartsAt?: Date | null
	saleEndsAt?: Date | null
	tiers?: TierInput[]
}

export interface ResolvePriceInput {
	/// "Preis auf Anfrage" — no price is shown and nothing can be bought (R2).
	quoteEnabled?: boolean
	role: PricingRole
	quantity: number
	/// Price rows defined on the product.
	productPrices: RolePriceInput[]
	/// Variant overrides. When a row exists for the resolved role it wins.
	variantPrices?: RolePriceInput[]
	now?: Date
}

export interface ResolvedPrice {
	/// True when this product is quote-only; every price field is then null.
	quoteOnly: boolean
	/// Price for one unit at this quantity, after sale and tier.
	unitPrice: Decimal | null
	/// Undiscounted reference price, for strikethrough display.
	listPrice: Decimal | null
	/// Line total, rounded to 2dp. Rounding happens per line, not on the
	/// subtotal, matching the old store's configuration (§3.1).
	lineTotal: Decimal | null
	/// The tier that applied, if any.
	appliedTier: TierInput | null
	/// Which role's row was actually used — may differ from the requested role
	/// when that role has no price defined.
	resolvedRole: PricingRole | null
	/// Whether the winning row came from the variant or the product.
	source: "variant" | "product" | null
	/// True when a sale price was in effect.
	onSale: boolean
}

/**
 * Fallback order when the requested role has no price row.
 *
 * Always falls back toward the MORE expensive role. Charging a Reseller the
 * B2C price because nobody entered a wholesale price is a visible annoyance;
 * charging a guest the Reseller price is lost revenue nobody notices.
 */
const FALLBACK: Record<PricingRole, PricingRole[]> = {
	RESELLER: ["RESELLER", "B2C", "GUEST"],
	B2C: ["B2C", "GUEST"],
	GUEST: ["GUEST", "B2C"],
}

const pickRow = (
	rows: RolePriceInput[] | undefined,
	role: PricingRole
): { row: RolePriceInput; role: PricingRole } | null => {
	if (!rows?.length) return null

	for (const candidate of FALLBACK[role]) {
		const row = rows.find((r) => r.role === candidate)
		if (row) return { row, role: candidate }
	}

	return null
}

const saleActive = (row: RolePriceInput, now: Date): boolean => {
	if (row.salePrice === null || row.salePrice === undefined) return false
	if (row.saleStartsAt && now < row.saleStartsAt) return false
	if (row.saleEndsAt && now > row.saleEndsAt) return false
	return true
}

/** Highest rung whose threshold the quantity has reached. */
const pickTier = (tiers: TierInput[] | undefined, quantity: number): TierInput | null => {
	if (!tiers?.length) return null

	return tiers
		.filter((t) => quantity >= t.minQuantity)
		.reduce<TierInput | null>(
			(best, t) => (best === null || t.minQuantity > best.minQuantity ? t : best),
			null
		)
}

const applyTier = (base: Decimal, tier: TierInput): Decimal => {
	const value = new Decimal(tier.value)

	switch (tier.type) {
		case "FIXED_PRICE":
			return value
		case "PERCENTAGE":
			return base.mul(new Decimal(100).minus(value)).div(100)
		case "FIXED_AMOUNT":
			return base.minus(value)
	}
}

export const resolvePrice = (input: ResolvePriceInput): ResolvedPrice => {
	const empty: ResolvedPrice = {
		quoteOnly: false,
		unitPrice: null,
		listPrice: null,
		lineTotal: null,
		appliedTier: null,
		resolvedRole: null,
		source: null,
		onSale: false,
	}

	// R2: quote-only products have no price at any quantity, for anyone.
	if (input.quoteEnabled) return { ...empty, quoteOnly: true }

	const now = input.now ?? new Date()
	const quantity = Math.max(1, Math.floor(input.quantity))

	// Variant rows win outright when the role resolves there; otherwise fall
	// back to the product. A variant priced for B2C only must not silently
	// borrow the product's Reseller price, so the whole lookup happens against
	// one source or the other, never a mixture.
	const variant = pickRow(input.variantPrices, input.role)
	const product = pickRow(input.productPrices, input.role)
	const picked = variant ?? product
	if (!picked) return empty

	const source: "variant" | "product" = variant ? "variant" : "product"
	const { row, role } = picked

	const listPrice = new Decimal(row.basePrice)
	const onSale = saleActive(row, now)
	const base = onSale ? new Decimal(row.salePrice as Numeric) : listPrice

	const tier = pickTier(row.tiers, quantity)
	let unitPrice = tier ? applyTier(base, tier) : base

	// A percentage over 100 or an oversized fixed amount must not produce a
	// negative price and pay the customer to order.
	if (unitPrice.lessThan(0)) unitPrice = new Decimal(0)

	return {
		quoteOnly: false,
		unitPrice,
		listPrice,
		lineTotal: unitPrice.mul(quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
		appliedTier: tier,
		resolvedRole: role,
		source,
		onSale,
	}
}

/**
 * The "from X" range shown on archive pages (§4.2). Cheapest is the price at
 * the highest tier rung; dearest is the price at quantity 1.
 */
export const resolvePriceRange = (
	input: Omit<ResolvePriceInput, "quantity">
): { min: Decimal | null; max: Decimal | null; quoteOnly: boolean } => {
	if (input.quoteEnabled) return { min: null, max: null, quoteOnly: true }

	const picked = pickRow(input.variantPrices, input.role) ?? pickRow(input.productPrices, input.role)
	if (!picked) return { min: null, max: null, quoteOnly: false }

	const highestRung = (picked.row.tiers ?? []).reduce(
		(max, t) => Math.max(max, t.minQuantity),
		1
	)

	const at = (quantity: number) => resolvePrice({ ...input, quantity }).unitPrice

	const one = at(1)
	const top = at(highestRung)
	if (!one || !top) return { min: null, max: null, quoteOnly: false }

	return {
		min: Decimal.min(one, top),
		max: Decimal.max(one, top),
		quoteOnly: false,
	}
}
