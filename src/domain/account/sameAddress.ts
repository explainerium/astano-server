/**
 * Whether two addresses name the same place.
 *
 * Checkout writes the address it was given into the customer's address book, so
 * that the next order can fill the form in for them. Without a comparison that
 * survives ordinary typing, a customer who writes "Hauptstr. 4" one week and
 * "Hauptstr.  4" the next collects a book full of the same house, and the
 * prefill starts guessing between near-identical entries.
 *
 * Phone and email are deliberately not part of it. The same building with a new
 * contact number is still the same building — and treating a corrected phone
 * number as a new address is exactly the duplication this exists to stop.
 *
 * Nothing here is clever about postal formats. A comparison that tried to
 * understand German street abbreviations would be wrong in a different country,
 * and being occasionally too strict only costs a duplicate row; being too loose
 * would silently merge two real addresses, which costs a misdelivered order.
 */

export interface AddressShape {
	firstName: string
	lastName: string
	company?: string | null
	street1: string
	street2?: string | null
	city: string
	state?: string | null
	postcode: string
	countryCode: string
}

/** Case, accidental double spaces and stray padding are not differences. */
const norm = (value: string | null | undefined): string =>
	(value ?? "").trim().replace(/\s+/g, " ").toLowerCase()

/** Postcodes compare without spaces: "SW1A 1AA" and "SW1A1AA" are one code. */
const normPostcode = (value: string): string => norm(value).replace(/\s/g, "")

/**
 * Joined on a null byte, because it cannot be typed into a form. On a space,
 * city "a b" with no state would read the same as city "a" with state "b" —
 * two different places comparing equal.
 */
const SEPARATOR = "\u0000"

const identity = (address: AddressShape): string =>
	[
		norm(address.firstName),
		norm(address.lastName),
		norm(address.company),
		norm(address.street1),
		norm(address.street2),
		norm(address.city),
		norm(address.state),
		normPostcode(address.postcode),
		norm(address.countryCode),
	].join(SEPARATOR)

export const sameAddress = (a: AddressShape, b: AddressShape): boolean =>
	identity(a) === identity(b)

/** The entry in the book that already names this place, if there is one. */
export const findMatching = <T extends AddressShape>(
	book: readonly T[],
	candidate: AddressShape
): T | null => book.find((entry) => sameAddress(entry, candidate)) ?? null
