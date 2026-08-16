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

/**
 * Where a quantity ladder came from.
 *
 * `catalogue` covers both the product's own ladder and a variant's — which of
 * those two applies is already decided by the price row, and a variant ladder
 * is not a separate *kind* of rule, only a more specific place to put one.
 *
 * The other two are genuinely different rules that happen to share the rung
 * shape: one attached to a customer, one attached to a category.
 */
export type TierSource = "customer" | "catalogue" | "category"

/**
 * Which ladder wins when more than one has a rung the quantity reaches.
 *
 * The most specific first. A ladder negotiated with one customer should not be
 * overridden by a blanket category discount, and a price set on the product
 * itself is a deliberate act that outranks a rule covering everything in a
 * category.
 *
 * Sources fall *through*, they are not exclusive: a higher-priority source with
 * no matching rung leaves the next one to answer. Only the first source that
 * actually produces a rung is used.
 */
export const DEFAULT_TIER_PRIORITY: TierSource[] = ["customer", "catalogue", "category"]

export interface ResolvePriceInput {
	/// "Preis auf Anfrage" — no price is shown and nothing can be bought (R2).
	quoteEnabled?: boolean
	role: PricingRole
	quantity: number
	/// Price rows defined on the product.
	productPrices: RolePriceInput[]
	/// Variant overrides. When a row exists for the resolved role it wins.
	variantPrices?: RolePriceInput[]

	/**
	 * A ladder negotiated with this one customer, for this product.
	 *
	 * Already filtered to the customer and to products this ladder covers — the
	 * resolver does not know who the customer is, only that a ladder was handed
	 * to it.
	 */
	customerTiers?: TierInput[]

	/// Ladders from the categories this product is filed under.
	categoryTiers?: TierInput[]

	/**
	 * The quantity a category ladder is measured against.
	 *
	 * Deliberately separate from `quantity`. A category ladder rewards a customer
	 * for buying across the category — five different cutters, ten of each, reach
	 * a threshold of 50 that no single line reaches. Falls back to the line
	 * quantity when the caller has no cart to count.
	 */
	categoryQuantity?: number

	/// Overrides `DEFAULT_TIER_PRIORITY`, e.g. from a store setting.
	tierPriority?: TierSource[]

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
	/// Which ladder the applied tier came from. Null when no tier applied.
	tierSource: TierSource | null
	/// Which role's row was actually used — may differ from the requested role
	/// when that role has no price defined.
	resolvedRole: PricingRole | null
	/// Whether the winning row came from the variant or the product.
	source: "variant" | "product" | null
	/// True when a sale price was in effect.
	onSale: boolean
}

/**
 * Fallback order when the requested role has nothing of its own.
 *
 * Always falls back toward the MORE expensive role. Charging a Reseller the
 * B2C price because nobody entered a wholesale price is a visible annoyance;
 * charging a guest the Reseller price is lost revenue nobody notices.
 *
 * Exported because it governs more than the rows in this file. The shop enters
 * one ladder and expects everyone to follow it, so anything that picks a ladder
 * by role — including the category ladders loaded before this function ever
 * runs — has to walk the same chain. Two chains would be two answers to "what
 * does a signed-in retail customer pay", and only one of them would be right.
 */
export const ROLE_FALLBACK: Record<PricingRole, PricingRole[]> = {
	RESELLER: ["RESELLER", "B2C", "GUEST"],
	B2C: ["B2C", "GUEST"],
	GUEST: ["GUEST", "B2C"],
}

const FALLBACK = ROLE_FALLBACK

/**
 * The rows belonging to the most specific role in the chain that has any.
 *
 * All of one role's rows or none of them, never a mixture. Merging a category's
 * guest and reseller rungs together would let a guest rung undercut the
 * reseller one that was meant to replace it — the ladders are alternatives, not
 * layers.
 *
 * Lives here rather than beside its one caller because it *is* the fallback
 * rule, and the rule having a second implementation somewhere else is how a
 * signed-in retail customer ends up paying a different price on the product
 * page than in the cart.
 */
export const pickByRole = <T extends { role: PricingRole }>(
	rows: readonly T[],
	role: PricingRole
): T[] => {
	for (const candidate of ROLE_FALLBACK[role]) {
		const found = rows.filter((row) => row.role === candidate)
		if (found.length) return found
	}

	return []
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

/**
 * The ladder to apply, which is not always the picked row's own.
 *
 * A price row and a quantity ladder are entered separately, so a role can
 * easily have one without the other — a Retail price with no rungs is the
 * common case, because the shop enters one ladder and expects every role to
 * follow it. Without this, that customer is quoted the single-unit price at
 * any quantity while a guest ordering the same 500 gets the discount.
 *
 * Falls back down the same chain as the price, and only when the row has no
 * ladder at all. A role that defines even one rung has said what it wants.
 */
const pickTiers = (
	rows: RolePriceInput[] | undefined,
	row: RolePriceInput,
	role: PricingRole
): RolePriceInput["tiers"] => {
	if (row.tiers?.length) return row.tiers

	for (const candidate of FALLBACK[role]) {
		const other = rows?.find((r) => r.role === candidate)
		if (other?.tiers?.length) return other.tiers
	}

	return row.tiers
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

/**
 * Walks the priority order and returns the first source that has a rung the
 * quantity reaches.
 *
 * Falls through rather than stopping: a customer ladder that only starts at
 * 1000 leaves the catalogue ladder to answer an order of 200. Only a source
 * that actually produces a rung ends the walk.
 */
const pickTierBySource = (
	input: ResolvePriceInput,
	catalogueTiers: TierInput[] | undefined,
	quantity: number
): { tier: TierInput; tierSource: TierSource } | null => {
	const order = input.tierPriority?.length ? input.tierPriority : DEFAULT_TIER_PRIORITY

	for (const candidate of order) {
		switch (candidate) {
			case "customer": {
				const tier = pickTier(input.customerTiers, quantity)
				if (tier) return { tier, tierSource: "customer" }
				break
			}
			case "catalogue": {
				const tier = pickTier(catalogueTiers, quantity)
				if (tier) return { tier, tierSource: "catalogue" }
				break
			}
			case "category": {
				// Measured against the whole category's cart total, not this line.
				const tier = pickTier(input.categoryTiers, input.categoryQuantity ?? quantity)
				if (tier) return { tier, tierSource: "category" }
				break
			}
		}
	}

	return null
}

export const resolvePrice = (input: ResolvePriceInput): ResolvedPrice => {
	const empty: ResolvedPrice = {
		quoteOnly: false,
		unitPrice: null,
		listPrice: null,
		lineTotal: null,
		appliedTier: null,
		tierSource: null,
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

	/**
	 * Every ladder discounts from the same base — the role's own price.
	 *
	 * A category or customer ladder does not carry a price of its own, only
	 * rungs, so a percentage rung means "off what this customer would otherwise
	 * pay for this product". Rungs never compound with one another either: only
	 * one applies, and it applies to the base.
	 */
	const ladder = pickTiers(source === "variant" ? input.variantPrices : input.productPrices, row, role)
	const applied = pickTierBySource(input, ladder, quantity)
	let unitPrice = applied ? applyTier(base, applied.tier) : base

	// A percentage over 100 or an oversized fixed amount must not produce a
	// negative price and pay the customer to order.
	if (unitPrice.lessThan(0)) unitPrice = new Decimal(0)

	return {
		quoteOnly: false,
		unitPrice,
		listPrice,
		lineTotal: unitPrice.mul(quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
		appliedTier: applied?.tier ?? null,
		tierSource: applied?.tierSource ?? null,
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

	const variant = pickRow(input.variantPrices, input.role)
	const picked = variant ?? pickRow(input.productPrices, input.role)
	if (!picked) return { min: null, max: null, quoteOnly: false }

	/**
	 * The ladder the price will actually be resolved against, fallback included.
	 *
	 * Reading `picked.row.tiers` directly was the same mistake `pickTiers` exists
	 * to prevent, one layer up: a Retail row with no rungs of its own borrows the
	 * guest ladder at checkout, but the range never learned that and advertised a
	 * single price. The shop enters one ladder and expects it to be followed
	 * everywhere, so the range has to follow the same chain the cart does.
	 */
	const ladder = pickTiers(
		variant ? input.variantPrices : input.productPrices,
		picked.row,
		picked.role
	)

	/**
	 * The top of the range is the deepest rung *any* eligible ladder reaches.
	 *
	 * Taking only the product's own would advertise "from €1.24" while a customer
	 * ladder actually reaches €0.90 — a range that understates the saving is as
	 * wrong as one that overstates it.
	 */
	const highestRung = [
		...(ladder ?? []),
		...(input.customerTiers ?? []),
		...(input.categoryTiers ?? []),
	].reduce((max, t) => Math.max(max, t.minQuantity), 1)

	// `categoryQuantity` follows the probe quantity here: an archive has no cart
	// to count, so the range shows what one line of that size would cost.
	const at = (quantity: number) =>
		resolvePrice({ ...input, quantity, categoryQuantity: quantity }).unitPrice

	const one = at(1)
	const top = at(highestRung)
	if (!one || !top) return { min: null, max: null, quoteOnly: false }

	return {
		min: Decimal.min(one, top),
		max: Decimal.max(one, top),
		quoteOnly: false,
	}
}
