import { logger } from "../shared/logger"

/**
 * EU VAT number validation against VIES.
 *
 * ⚠️ FAILS CLOSED. If VIES is unreachable, slow, or returns anything we cannot
 * read, the number is treated as NOT validated and full tax is charged.
 *
 * The alternative — assuming valid on error — hands out reverse charge to
 * anyone who types a plausible-looking number while the service is down, and
 * the shop absorbs the VAT. Charging tax that later turns out to be
 * unnecessary is a refund; not charging it is a liability.
 */

const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms"

/** Countries VIES covers. Greece files under EL, not GR. */
const VIES_COUNTRIES = new Set([
	"AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR",
	"HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
	"SE", "SI", "SK", "XI",
])

export interface VatCheckResult {
	valid: boolean
	countryCode: string
	vatNumber: string
	name?: string
	address?: string
	/// Why it is not valid, when it is not.
	reason?: "MALFORMED" | "COUNTRY_NOT_COVERED" | "NOT_FOUND" | "SERVICE_UNAVAILABLE"
	/// True when the answer came from VIES rather than from a local check.
	checkedRemotely: boolean
}

/**
 * Splits "DE123456789" into its country and number, tolerating spaces, dots and
 * a lowercase prefix — customers paste VAT numbers in every conceivable format.
 */
export const parseVatNumber = (
	input: string
): { countryCode: string; number: string } | null => {
	const cleaned = input.replace(/[\s.\-/]/g, "").toUpperCase()
	const match = /^([A-Z]{2})([0-9A-Z]{2,13})$/.exec(cleaned)
	if (!match) return null

	// Greece uses EL for VAT even though its ISO code is GR.
	const countryCode = match[1] === "GR" ? "EL" : match[1]!
	return { countryCode, number: match[2]! }
}

export const validateVatNumber = async (
	input: string,
	timeoutMs = 8000
): Promise<VatCheckResult> => {
	const parsed = parseVatNumber(input)

	if (!parsed) {
		return {
			valid: false,
			countryCode: "",
			vatNumber: input,
			reason: "MALFORMED",
			checkedRemotely: false,
		}
	}

	if (!VIES_COUNTRIES.has(parsed.countryCode)) {
		return {
			valid: false,
			countryCode: parsed.countryCode,
			vatNumber: parsed.number,
			reason: "COUNTRY_NOT_COVERED",
			checkedRemotely: false,
		}
	}

	// A hung request must not hold a checkout open.
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const response = await fetch(`${VIES_URL}/${parsed.countryCode}/vat/${parsed.number}`, {
			signal: controller.signal,
			headers: { Accept: "application/json" },
		})

		if (!response.ok) {
			logger.warn(
				{ status: response.status, countryCode: parsed.countryCode },
				"VIES returned a non-OK status — treating the number as unvalidated"
			)
			return {
				valid: false,
				countryCode: parsed.countryCode,
				vatNumber: parsed.number,
				reason: "SERVICE_UNAVAILABLE",
				checkedRemotely: false,
			}
		}

		const body = (await response.json()) as {
			isValid?: boolean
			name?: string
			address?: string
		}

		return {
			valid: body.isValid === true,
			countryCode: parsed.countryCode,
			vatNumber: parsed.number,
			name: body.name?.trim() || undefined,
			address: body.address?.trim() || undefined,
			...(body.isValid === true ? {} : { reason: "NOT_FOUND" as const }),
			checkedRemotely: true,
		}
	} catch (error) {
		// Timeout, DNS failure, VIES outage — all the same answer.
		logger.warn({ err: error, countryCode: parsed.countryCode }, "VIES check failed — failing closed")
		return {
			valid: false,
			countryCode: parsed.countryCode,
			vatNumber: parsed.number,
			reason: "SERVICE_UNAVAILABLE",
			checkedRemotely: false,
		}
	} finally {
		clearTimeout(timer)
	}
}
