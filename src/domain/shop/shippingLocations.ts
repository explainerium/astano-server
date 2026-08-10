import { canSellTo, type SellingRule } from "./sellingLocations"

/**
 * Where the shop will deliver.
 *
 * A gate in front of the shipping zones, not a second copy of them. A zone
 * answers "what does delivery to Austria cost"; this answers "is Austria
 * offered delivery at all". They look like the same question until a shop sells
 * everywhere and ships to two countries — which is why WooCommerce asks both,
 * and why the two must not be allowed to drift into contradicting each other.
 *
 * So this never *adds* a country: "everywhere I sell to" is the default, and
 * the specific list is intersected with the selling rule rather than replacing
 * it. A country the shop refuses to sell to cannot become shippable by being
 * typed into the wrong box.
 */

export type ShippingMode = "selling" | "all" | "specific" | "disabled"

export interface ShippingRule {
	mode: ShippingMode
	/** ISO 3166-1 alpha-2. Only read when the mode is `specific`. */
	countries: string[]
}

export const DEFAULT_SHIPPING_RULE: ShippingRule = { mode: "selling", countries: [] }

/**
 * Reads the rule, tolerating whatever is stored.
 *
 * Falls back to "everywhere I sell to" — the same asymmetry the selling rule
 * uses. A bad value that quietly refuses delivery everywhere stops the shop
 * trading with nothing to see; one that offers too much is caught at checkout.
 */
export const readShippingRule = (settings: Record<string, unknown>): ShippingRule => {
	const mode = settings["shipping.locations"]
	const countries = settings["shipping.countries"]

	return {
		mode:
			mode === "all" || mode === "specific" || mode === "disabled"
				? mode
				: DEFAULT_SHIPPING_RULE.mode,
		countries: Array.isArray(countries)
			? countries.filter((code): code is string => typeof code === "string")
			: [],
	}
}

/** Whether the shop delivers to a country at all, before any zone is consulted. */
export const canShipTo = (
	rule: ShippingRule,
	selling: SellingRule,
	countryCode: string | null | undefined
): boolean => {
	if (rule.mode === "disabled") return false

	// Nothing to judge yet. The checkout asks what it may offer before anyone
	// has typed an address, and refusing there would empty the form it is about
	// to render.
	if (!countryCode) return true

	const country = countryCode.toUpperCase()

	// "All countries" still means all countries the shop *sells* to — shipping
	// somewhere an order cannot be placed is not a state worth expressing.
	if (!canSellTo(selling, country)) return false

	if (rule.mode === "specific") {
		return rule.countries.map((code) => code.toUpperCase()).includes(country)
	}

	return true
}

/** True when the shop delivers nowhere — a downloads-only or collection-only shop. */
export const shippingDisabled = (rule: ShippingRule): boolean => rule.mode === "disabled"
