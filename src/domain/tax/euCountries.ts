/**
 * Which countries are in the EU, and when a business must supply a VAT ID.
 *
 * The rule the client asked for is narrower than "B2B customers have VAT IDs",
 * and the difference is the whole point:
 *
 *  • **Germany → Germany.** A domestic B2B sale is taxed normally, at 19%. The
 *    buyer's VAT ID changes nothing, so asking for it would refuse German
 *    dealers over a field that does not apply to them.
 *  • **Germany → another EU country.** Reverse charge: the seller charges no
 *    VAT and the buyer accounts for it. That is only lawful against a valid VAT
 *    ID, so here it is genuinely required.
 *  • **Germany → outside the EU.** An export. There is no EU VAT ID to give.
 *
 * So the question is not "are you a business" but "are you a business in the EU
 * somewhere other than where the shop is". The shop's own country is a
 * parameter rather than a constant: it is in the settings, and a shop that
 * moves must not need a code change to keep invoicing correctly.
 *
 * Pure — no Prisma, no settings read. Callers hand it the two countries.
 */

/** ISO 3166-1 alpha-2, the 27 member states as of 2026. */
export const EU_COUNTRIES: readonly string[] = [
	"AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR",
	"HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
	"SE", "SI", "SK",
]

export const isEuCountry = (countryCode: string | null | undefined): boolean =>
	Boolean(countryCode) && EU_COUNTRIES.includes(countryCode!.toUpperCase())

/**
 * Whether a business in `countryCode` must supply a VAT ID to this shop.
 *
 * `shopCountry` defaults to Germany, which is where astano is — but reading it
 * from the caller means the rule stays true if that ever changes. An unknown or
 * missing shop country falls back to DE rather than to "require everyone": a
 * misconfigured setting should not start refusing registrations.
 */
export const requiresVatId = (
	countryCode: string | null | undefined,
	shopCountry: string | null | undefined = "DE"
): boolean => {
	if (!countryCode) return false

	const country = countryCode.toUpperCase()
	const shop = (shopCountry || "DE").toUpperCase()

	// Domestic is taxed normally; outside the EU there is no EU VAT ID to give.
	return isEuCountry(country) && country !== shop
}
