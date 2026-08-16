import Decimal from "decimal.js"

/**
 * Which part of an order is taxable, and under which class.
 *
 * `resolveTax` answers "what is the tax on this amount in this country". It
 * cannot answer "which amount", because that depends on two per-product
 * settings it has never been shown: **tax status** (whether the goods are taxed
 * at all) and **tax class** (which rate applies when they are). Both are in the
 * admin's product form, both are stored, and until this file existed the
 * checkout read neither — it took the default class and applied it to the whole
 * subtotal, so a product marked "not taxed" was invoiced at 19% anyway.
 *
 * Status and class are deliberately separate, exactly as WooCommerce keeps
 * them: a zero-rated line is still a taxable supply and the invoice has to be
 * able to say so, which is a different statement from "no tax applies".
 *
 * Pure — no Prisma, no rates, no countries. It splits amounts; the rates
 * decide what happens to them.
 */

export type TaxStatus = "TAXABLE" | "SHIPPING_ONLY" | "NONE"

export interface TaxableLine {
	/// Net line total.
	net: Decimal | string | number
	taxStatus: TaxStatus
	/// Null means "whichever class the shop marked as the default".
	taxClassId: string | null
}

export interface TaxableGroup {
	taxClassId: string | null
	net: Decimal
}

export interface TaxableSplit {
	/// One entry per class that has taxable goods, in the order first seen.
	groups: TaxableGroup[]
	/// Whether the delivery charge is taxed at all.
	shippingTaxable: boolean
	/// The class the delivery charge is taxed under. Null = the default class.
	shippingTaxClassId: string | null
}

export const splitTaxableLines = (lines: readonly TaxableLine[]): TaxableSplit => {
	const byClass = new Map<string | null, Decimal>()

	for (const line of lines) {
		// SHIPPING_ONLY taxes the delivery and not the goods; NONE taxes neither.
		// Both contribute nothing to the goods base — what separates them is the
		// shipping question, answered below.
		if (line.taxStatus !== "TAXABLE") continue

		const key = line.taxClassId
		byClass.set(key, (byClass.get(key) ?? new Decimal(0)).plus(new Decimal(line.net)))
	}

	const groups = [...byClass].map(([taxClassId, net]) => ({ taxClassId, net }))

	/*
	 * Delivery is taxed unless *nothing* in the basket is.
	 *
	 * One untaxed product does not make the delivery of the rest untaxed, and a
	 * basket of nothing but untaxed goods has no supply to attach a shipping tax
	 * to. SHIPPING_ONLY exists precisely to be the second case with the answer
	 * reversed, which is why the test is against NONE rather than TAXABLE.
	 */
	const shippingTaxable = lines.some((line) => line.taxStatus !== "NONE")

	/*
	 * Which class the delivery charge falls under, WooCommerce's "based on cart
	 * items". Shipping a basket of reduced-rate goods at the standard rate
	 * overcharges the customer; the other way round short-pays the tax office.
	 * The largest taxable group decides, and the default class answers for a
	 * basket that has something to deliver but no taxable goods.
	 */
	const largest = groups.reduce<TaxableGroup | null>(
		(best, group) => (best === null || group.net.greaterThan(best.net) ? group : best),
		null
	)

	return {
		groups,
		shippingTaxable,
		shippingTaxClassId:
			largest?.taxClassId ??
			lines.find((line) => line.taxStatus === "SHIPPING_ONLY")?.taxClassId ??
			null,
	}
}
