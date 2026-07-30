import Decimal from "decimal.js"

/**
 * Shipping cost resolution. Pure — zones, methods and every band come from
 * admin-entered data; nothing is written into this file.
 *
 * Bands are half-open: `min <= value < max`. The old shop had two rules both
 * claiming exactly 320 kg, so a cart at that weight matched whichever the
 * database returned first. Half-open intervals make that impossible.
 */

export type Numeric = Decimal | string | number

export type ShippingMethodType =
	| "WEIGHT_BANDED"
	| "FLAT_RATE"
	| "FREE_SHIPPING"
	| "PRICE_BANDED"

export interface RateBand {
	minValue: Numeric
	/// Null means open-ended.
	maxValue?: Numeric | null
	cost: Numeric
}

export interface ShippingMethodInput {
	id: string
	code: string
	name: string
	type: ShippingMethodType
	flatCost?: Numeric | null
	freeAboveSubtotal?: Numeric | null
	taxable: boolean
	sortOrder: number
	bands?: RateBand[]
}

export interface ResolveShippingInput {
	/// Total weight of the cart in kg.
	weightKg: Numeric
	/// Net subtotal, used by FREE_SHIPPING thresholds and PRICE_BANDED ladders.
	subtotal: Numeric
	methods: ShippingMethodInput[]
}

export interface ShippingQuote {
	methodId: string
	code: string
	name: string
	cost: string
	taxable: boolean
	/// Why a method could not be offered, when it could not.
	unavailableReason?: "NO_MATCHING_BAND" | "BELOW_FREE_THRESHOLD" | "NOT_CONFIGURED"
}

const round = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

/** Half-open band lookup: min <= value < max, with null max meaning open-ended. */
export const findBand = (bands: RateBand[] | undefined, value: Decimal): RateBand | null => {
	if (!bands?.length) return null

	const matches = bands.filter((b) => {
		const min = new Decimal(b.minValue)
		if (value.lessThan(min)) return false
		if (b.maxValue === null || b.maxValue === undefined) return true
		return value.lessThan(new Decimal(b.maxValue))
	})

	if (!matches.length) return null

	// If an admin has entered overlapping bands anyway, take the most specific
	// (highest minimum) rather than whichever the database happened to return.
	return matches.reduce((best, b) =>
		new Decimal(b.minValue).greaterThan(new Decimal(best.minValue)) ? b : best
	)
}

const quoteFor = (
	method: ShippingMethodInput,
	weight: Decimal,
	subtotal: Decimal
): ShippingQuote => {
	const base = {
		methodId: method.id,
		code: method.code,
		name: method.name,
		taxable: method.taxable,
	}

	switch (method.type) {
		case "FLAT_RATE": {
			if (method.flatCost === null || method.flatCost === undefined) {
				return { ...base, cost: "0.00", unavailableReason: "NOT_CONFIGURED" }
			}
			return { ...base, cost: round(new Decimal(method.flatCost)).toFixed(2) }
		}

		case "FREE_SHIPPING": {
			const threshold = method.freeAboveSubtotal
			if (threshold !== null && threshold !== undefined) {
				if (subtotal.lessThan(new Decimal(threshold))) {
					return { ...base, cost: "0.00", unavailableReason: "BELOW_FREE_THRESHOLD" }
				}
			}
			return { ...base, cost: "0.00" }
		}

		case "PRICE_BANDED": {
			const band = findBand(method.bands, subtotal)
			if (!band) return { ...base, cost: "0.00", unavailableReason: "NO_MATCHING_BAND" }
			return { ...base, cost: round(new Decimal(band.cost)).toFixed(2) }
		}

		case "WEIGHT_BANDED": {
			const band = findBand(method.bands, weight)
			if (!band) return { ...base, cost: "0.00", unavailableReason: "NO_MATCHING_BAND" }
			return { ...base, cost: round(new Decimal(band.cost)).toFixed(2) }
		}
	}
}

/**
 * Every method configured for the destination zone, each with its cost or the
 * reason it cannot be offered. The caller decides what to show — a method that
 * cannot quote is reported rather than silently dropped, because "no shipping
 * available" with no explanation is the worst checkout failure there is.
 */
export const resolveShipping = (input: ResolveShippingInput): ShippingQuote[] => {
	const weight = new Decimal(input.weightKg)
	const subtotal = new Decimal(input.subtotal)

	return input.methods
		.slice()
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((m) => quoteFor(m, weight, subtotal))
}

export const availableQuotes = (quotes: ShippingQuote[]): ShippingQuote[] =>
	quotes.filter((q) => !q.unavailableReason)
