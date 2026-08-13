import { findMatching, type AddressShape } from "../../../domain/account/sameAddress"
import { logger } from "../../../shared/logger"
import { prisma } from "../../../shared/prisma"

/**
 * Keep the address an order was placed with, so the next checkout can fill the
 * form in.
 *
 * The client's question was "why do I have to type the address again?", and the
 * answer was that nothing ever wrote it down: checkout read the address book,
 * the address book was only ever written from the account pages, and a customer
 * who had never visited those pages had an empty one forever. So the first
 * order now stocks it, and every order after that finds it already filled.
 *
 * What it deliberately does not do is edit anything. An address already in the
 * book is left exactly as the customer wrote it — including its label and which
 * defaults it holds — because this runs behind their back and quietly rewriting
 * an address book entry is not something an order should do.
 */

type Candidate = AddressShape & { phone?: string | null; email?: string | null }

const store = async (userId: string, address: Candidate, defaults: boolean) => {
	await prisma.$transaction(async (tx) => {
		if (defaults) {
			await tx.address.updateMany({
				where: { userId, OR: [{ isDefaultBilling: true }, { isDefaultShipping: true }] },
				data: { isDefaultBilling: false, isDefaultShipping: false },
			})
		}

		await tx.address.create({
			data: {
				userId,
				firstName: address.firstName,
				lastName: address.lastName,
				company: address.company ?? null,
				street1: address.street1,
				street2: address.street2 ?? null,
				city: address.city,
				state: address.state ?? null,
				postcode: address.postcode,
				countryCode: address.countryCode,
				phone: address.phone ?? null,
				email: address.email ?? null,
				// The first thing in an empty book becomes both defaults, matching
				// what the account pages do — an address book with nothing selected
				// prefills nothing, which is the state we are trying to leave.
				isDefaultBilling: defaults,
				isDefaultShipping: defaults,
			},
		})
	})
}

/**
 * Never throws.
 *
 * The order is already placed and paid for by the time this runs. A customer
 * must not see "your order failed" because a convenience feature could not
 * write a row, so a failure is logged and swallowed — the worst outcome is that
 * they type the address again next time, which is where they started.
 */
export const rememberAddresses = async (params: {
	userId: string
	billing: Candidate
	/** Only when the customer asked to deliver somewhere else. */
	shipping?: Candidate
}): Promise<void> => {
	try {
		const book = await prisma.address.findMany({ where: { userId: params.userId } })

		// Both are checked against the same snapshot, then stored in turn, so a
		// customer who bills and ships to the same place gets one row rather than
		// two identical ones.
		const wanted: Candidate[] = [params.billing]
		if (params.shipping && !findMatching([params.billing], params.shipping)) {
			wanted.push(params.shipping)
		}

		const kept = [...book]
		for (const address of wanted) {
			if (findMatching(kept, address)) continue

			await store(params.userId, address, kept.length === 0)
			kept.push(address as (typeof kept)[number])
		}
	} catch (error) {
		logger.warn({ err: error, userId: params.userId }, "Could not remember the checkout address")
	}
}
