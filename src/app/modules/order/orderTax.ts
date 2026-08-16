import Decimal from "decimal.js"
import {
	mergeTax,
	resolveTax,
	type ResolvedTax,
	type TaxRateInput,
} from "../../../domain/tax/resolveTax"
import { splitTaxableLines, type TaxableLine } from "../../../domain/tax/taxableGroups"
import { prisma } from "../../../shared/prisma"
import { SettingService } from "../setting/setting.service"

/**
 * The tax on an order, from the goods to the breakdown the invoice prints.
 *
 * Shared by checkout and by quote acceptance, and that is the whole reason it
 * is a file rather than a block inside `quoteCart`. Accepting a quote wrote
 * `taxTotal: "0"` with a comment saying staff would adjust it afterwards —
 * except nothing in the dashboard can adjust an order's totals, so every
 * quote-converted order was invoiced by a German shop at 0% VAT for good. Two
 * ways of ending up with an order is fine; two answers to "what tax does it
 * carry" is not.
 *
 * The rules themselves stay pure and stay in `domain/tax`. This reads the
 * rates, hands them over, and merges what comes back.
 */

export interface OrderTaxInput {
	countryCode: string | null | undefined
	state?: string | null
	/// One entry per goods line, with the two settings from its product.
	lines: TaxableLine[]
	shippingCost: Decimal
	/// Whether the chosen delivery METHOD is taxable. Separate from whether the
	/// basket makes delivery taxable at all, which the goods decide.
	shippingMethodTaxable: boolean
	hasValidatedVatId: boolean
	/// Pre-read settings, where the caller already has them in hand.
	settings?: Record<string, unknown>
}

export const resolveOrderTax = async (input: OrderTaxInput): Promise<ResolvedTax> => {
	const settings = input.settings ?? (await SettingService.getMap())

	/*
	 * The master switch, and what "off" has to mean.
	 *
	 * Explicitly **not** `unconfigured`. That state exists to refuse an order
	 * rather than invoice it at 0% because nobody entered a rate — an accident.
	 * A shop that has deliberately turned tax off has not had an accident, so
	 * checkout must proceed.
	 */
	if (settings["tax.enabled"] === false) {
		return { lines: [], totalTax: "0.00", reverseCharged: false, unconfigured: false }
	}

	/*
	 * Every class, not only the default one.
	 *
	 * Taking the default and applying it to the whole subtotal is what made the
	 * admin's per-product **tax status** and **tax class** govern nothing: a
	 * product marked "not taxed" was invoiced at 19% anyway, and a reduced-rate
	 * class could be entered and never reach a customer.
	 */
	const taxClasses = await prisma.taxClass.findMany({ include: { rates: true } })
	const defaultClass = taxClasses.find((c) => c.isDefault) ?? null

	const ratesFor = (taxClassId: string | null): TaxRateInput[] => {
		const chosen = taxClassId
			? (taxClasses.find((c) => c.id === taxClassId) ?? defaultClass)
			: defaultClass

		return (chosen?.rates ?? []).map(
			(r): TaxRateInput => ({
				countryCode: r.countryCode,
				state: r.state,
				name: r.name,
				rate: r.rate.toString(),
				appliesToShipping: r.appliesToShipping,
				priority: r.priority,
				reverseChargeWithVatId: r.reverseChargeWithVatId,
				isActive: r.isActive,
			})
		)
	}

	const split = splitTaxableLines(input.lines)
	const shippingTaxed =
		input.shippingMethodTaxable && split.shippingTaxable && input.shippingCost.greaterThan(0)

	/*
	 * One resolution per class, plus one for the delivery charge.
	 *
	 * Separate calls rather than one summed base, because they are genuinely
	 * different rates on different amounts — and "19% on €400" beside "7% on
	 * €120" is the breakdown a German invoice has to carry. Delivery is resolved
	 * exactly once, outside the class loop, so a two-class basket cannot tax the
	 * same postage twice.
	 */
	return mergeTax([
		...split.groups.map((group) =>
			resolveTax({
				countryCode: input.countryCode,
				state: input.state,
				netAmount: group.net,
				shippingAmount: 0,
				shippingTaxable: false,
				hasValidatedVatId: input.hasValidatedVatId,
				rates: ratesFor(group.taxClassId),
			})
		),
		...(shippingTaxed
			? [
					resolveTax({
						countryCode: input.countryCode,
						state: input.state,
						netAmount: 0,
						shippingAmount: input.shippingCost,
						shippingTaxable: true,
						hasValidatedVatId: input.hasValidatedVatId,
						rates: ratesFor(split.shippingTaxClassId),
					}),
				]
			: []),
	])
}
