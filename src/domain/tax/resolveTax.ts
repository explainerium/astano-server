import Decimal from "decimal.js"

/**
 * Tax resolution. Pure — the rates come from the database, but no rate,
 * country or rule is written into this file.
 *
 * The old shop's behaviour (19% across the EU, 0% for Switzerland, reverse
 * charge on a validated VAT ID) is reproducible entirely through admin-entered
 * data. If the client changes their mind about any of it, nothing here changes.
 */

export type Numeric = Decimal | string | number

export interface TaxRateInput {
	countryCode: string
	state?: string | null
	name: string
	/// Percentage, e.g. 19 for 19%.
	rate: Numeric
	appliesToShipping: boolean
	priority: number
	reverseChargeWithVatId: boolean
	isActive: boolean
}

export interface ResolveTaxInput {
	/// Destination. The old shop taxed on the SHIPPING address, but that is a
	/// caller decision — this function taxes whatever address it is handed.
	countryCode: string | null | undefined
	state?: string | null
	/// Net amount of the goods.
	netAmount: Numeric
	/// Net shipping charge, if any.
	shippingAmount?: Numeric
	/// Whether the shipping method itself is taxable.
	shippingTaxable?: boolean
	/// True once a VAT ID has been validated against VIES.
	hasValidatedVatId?: boolean
	rates: TaxRateInput[]
}

export interface TaxLine {
	name: string
	ratePercent: string
	taxableBase: string
	amount: string
}

export interface ResolvedTax {
	lines: TaxLine[]
	totalTax: string
	/// True when a rate matched but was zeroed by reverse charge, so the
	/// invoice can carry the required "reverse charge" note.
	reverseCharged: boolean
	/// No rate configured for this destination at all.
	unconfigured: boolean
}

const round = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

export const resolveTax = (input: ResolveTaxInput): ResolvedTax => {
	const net = new Decimal(input.netAmount)
	const shipping = new Decimal(input.shippingAmount ?? 0)

	if (!input.countryCode) {
		return { lines: [], totalTax: "0.00", reverseCharged: false, unconfigured: true }
	}

	const country = input.countryCode.toUpperCase()

	const matching = input.rates
		.filter((r) => r.isActive)
		.filter((r) => r.countryCode.toUpperCase() === country)
		// A rate scoped to a state applies only to that state; an unscoped rate
		// applies to the whole country.
		.filter((r) => !r.state || (input.state && r.state.toLowerCase() === input.state.toLowerCase()))
		.sort((a, b) => a.priority - b.priority)

	if (!matching.length) {
		return { lines: [], totalTax: "0.00", reverseCharged: false, unconfigured: true }
	}

	let reverseCharged = false
	const lines: TaxLine[] = []
	let total = new Decimal(0)

	for (const rate of matching) {
		// Reverse charge: the customer accounts for the tax, so the seller
		// charges nothing — but the line is still recorded at 0 so the invoice
		// can say why.
		if (rate.reverseChargeWithVatId && input.hasValidatedVatId) {
			reverseCharged = true
			lines.push({
				name: rate.name,
				ratePercent: new Decimal(rate.rate).toFixed(2),
				taxableBase: round(net).toFixed(2),
				amount: "0.00",
			})
			continue
		}

		const base = net.plus(rate.appliesToShipping && input.shippingTaxable !== false ? shipping : 0)
		const amount = round(base.mul(new Decimal(rate.rate)).div(100))

		total = total.plus(amount)
		lines.push({
			name: rate.name,
			ratePercent: new Decimal(rate.rate).toFixed(2),
			taxableBase: round(base).toFixed(2),
			amount: amount.toFixed(2),
		})
	}

	return {
		lines,
		totalTax: round(total).toFixed(2),
		reverseCharged,
		unconfigured: false,
	}
}

/**
 * Combines several resolutions into the one breakdown an invoice prints.
 *
 * A basket can need more than one: goods at the standard rate, goods at a
 * reduced one, and the delivery charge, each resolved against the rates of the
 * class that governs it. They are separate calls because they are separate
 * amounts at separate rates — but the customer is owed a single set of totals.
 *
 * Lines that share a name and a rate are added together rather than listed
 * twice, because "MwSt 19%" appearing on two rows of one invoice reads as an
 * error even when both rows are right.
 *
 * `unconfigured` and `reverseCharged` both spread: one destination with no rate
 * entered is enough to refuse the order, and one reverse-charged line is enough
 * for the invoice to have to say so. No resolutions at all is not unconfigured
 * — a basket with nothing taxable in it is an answer, not a missing one.
 */
export const mergeTax = (parts: readonly ResolvedTax[]): ResolvedTax => {
	const byRate = new Map<string, TaxLine>()
	let total = new Decimal(0)

	for (const part of parts) {
		total = total.plus(new Decimal(part.totalTax))

		for (const line of part.lines) {
			const key = `${line.name}:${line.ratePercent}`
			const seen = byRate.get(key)

			if (!seen) {
				byRate.set(key, { ...line })
				continue
			}

			seen.taxableBase = new Decimal(seen.taxableBase).plus(line.taxableBase).toFixed(2)
			seen.amount = new Decimal(seen.amount).plus(line.amount).toFixed(2)
		}
	}

	return {
		lines: [...byRate.values()],
		totalTax: round(total).toFixed(2),
		reverseCharged: parts.some((p) => p.reverseCharged),
		unconfigured: parts.some((p) => p.unconfigured),
	}
}
