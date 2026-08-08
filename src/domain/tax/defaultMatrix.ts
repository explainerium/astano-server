/**
 * The tax matrix the live WordPress shop runs, as data — spec §3.7 and R10.
 *
 * Not invented. Every figure here is what astano charges today; the rebuild
 * reproduces it rather than deciding it. Rates are a legal matter and a
 * developer guessing one is how a shop ends up under-collecting VAT for a
 * quarter before anybody notices.
 *
 *   CH                        → 0 %
 *   DE                        → always 19 %, never reverse charged
 *   other EU + valid VAT ID   → 0 % (reverse charge)
 *   other EU, no valid VAT ID → 19 %
 *   anywhere else             → no rate, and checkout refuses rather than
 *                               invoicing at 0 % by omission
 *
 * The country list is short of a few EU members (BG, HR, MT, PL). That is not
 * an oversight here — it is the list the live shop has, reproduced faithfully.
 * Adding them is a business decision, and the admin screen is where it belongs.
 */

/** Standard rate, applied to everything the shop sells. */
export const STANDARD_RATE = "19.0000"

/** Shown on the invoice line. German, because the invoices are German. */
export const RATE_NAME = "Steuer"

/**
 * EU countries charged the standard rate, minus Germany.
 *
 * Separate from DE because these are the ones where a validated VAT ID zeroes
 * the tax. Germany never is — a German customer pays German VAT whatever their
 * VAT ID says, which is exactly the distinction `reverseChargeWithVatId` exists
 * to record.
 */
export const REVERSE_CHARGEABLE_EU = [
	"AT", "BE", "CY", "CZ", "DK", "EE", "ES", "FI", "FR", "GR",
	"HU", "IE", "IT", "LT", "LU", "LV", "NL", "PT", "RO", "SE",
	"SI", "SK",
]

export interface DefaultRate {
	countryCode: string
	rate: string
	reverseChargeWithVatId: boolean
	appliesToShipping: boolean
}

export const DEFAULT_RATES: DefaultRate[] = [
	// Home country. Always taxable, never reverse charged.
	{ countryCode: "DE", rate: STANDARD_RATE, reverseChargeWithVatId: false, appliesToShipping: true },

	...REVERSE_CHARGEABLE_EU.map((countryCode) => ({
		countryCode,
		rate: STANDARD_RATE,
		reverseChargeWithVatId: true,
		appliesToShipping: true,
	})),

	/*
	 * Switzerland: 0 %, and a real row rather than an absence.
	 *
	 * An absent rate means "unconfigured" and makes checkout refuse the order;
	 * a 0 % row means "we have decided, and it is nothing". The difference is
	 * the whole point of the guard.
	 */
	{ countryCode: "CH", rate: "0.0000", reverseChargeWithVatId: false, appliesToShipping: true },
]

/**
 * The three classes WooCommerce registered. Only the standard one carries
 * rates; the other two exist because products may already reference them.
 */
export const DEFAULT_CLASSES = [
	{
		code: "standard",
		isDefault: true,
		sortOrder: 0,
		translations: [
			{ locale: "en", name: "Standard rate" },
			{ locale: "de", name: "Regelsteuersatz" },
		],
		rates: DEFAULT_RATES,
	},
	{
		code: "reduced",
		isDefault: false,
		sortOrder: 1,
		translations: [
			{ locale: "en", name: "Reduced rate" },
			{ locale: "de", name: "Ermäßigter Steuersatz" },
		],
		rates: [],
	},
	{
		code: "zero",
		isDefault: false,
		sortOrder: 2,
		translations: [
			{ locale: "en", name: "Zero rate" },
			{ locale: "de", name: "Nullsatz" },
		],
		rates: [],
	},
]
