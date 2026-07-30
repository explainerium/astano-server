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
