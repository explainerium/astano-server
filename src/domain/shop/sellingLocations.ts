/**
 * Whether the shop will take an order going to a given country.
 *
 * Separate from the shipping zones, and deliberately so. A zone decides where a
 * parcel can travel and what that costs; this decides whether the order may be
 * placed at all. They are usually the same set and occasionally are not — a
 * customer collecting in person, or a country the shop has no licence to trade
 * with but could physically post to.
 *
 * Pure: no database, no request. The checkout filters its country field with
 * this and the API refuses with it, from the same function, so the dropdown and
 * the server can never disagree.
 */

export type SellingMode = "all" | "all_except" | "specific"

export interface SellingRule {
	mode: SellingMode
	/** ISO 3166-1 alpha-2. Meaningless when the mode is `all`. */
	countries: string[]
}

export const canSellTo = (rule: SellingRule, countryCode: string | null | undefined): boolean => {
	if (rule.mode === "all") return true

	// No destination yet is not a refusal — the checkout asks before it knows.
	// Placement supplies one, and that is where a missing country is caught.
	if (!countryCode) return true

	const country = countryCode.toUpperCase()
	const listed = rule.countries.map((code) => code.toUpperCase()).includes(country)

	return rule.mode === "specific" ? listed : !listed
}

/**
 * Reads the rule out of the settings map, tolerating whatever is stored.
 *
 * A malformed value falls back to selling everywhere rather than nowhere. The
 * failure modes are not symmetrical: a bad row that quietly refuses every
 * order is a shop that has stopped trading and nobody can see why, while one
 * that sells too widely is visible in the orders that arrive.
 */
export const readSellingRule = (settings: Record<string, unknown>): SellingRule => {
	const mode = settings["selling.locations"]
	const countries = settings["selling.countries"]

	return {
		mode: mode === "all_except" || mode === "specific" ? mode : "all",
		countries: Array.isArray(countries) ? countries.filter((c): c is string => typeof c === "string") : [],
	}
}
