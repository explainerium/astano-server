import type { Address, Prisma } from "@prisma/client"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"
import { toPublicUser, type PublicUser } from "../auth/auth.interface"

const notFound = () =>
	new ApiError(httpStatus.NOT_FOUND, "Address not found", { messageKey: "account.addressNotFound" })

const view = (a: Address) => ({
	id: a.id,
	label: a.label,
	firstName: a.firstName,
	lastName: a.lastName,
	company: a.company,
	street1: a.street1,
	street2: a.street2,
	city: a.city,
	state: a.state,
	postcode: a.postcode,
	countryCode: a.countryCode,
	phone: a.phone,
	email: a.email,
	isDefaultBilling: a.isDefaultBilling,
	isDefaultShipping: a.isDefaultShipping,
	createdAt: a.createdAt,
})

const updateProfile = async (
	userId: string,
	payload: {
		firstName?: string | null
		lastName?: string | null
		company?: string | null
		phone?: string | null
		locale?: string
	}
): Promise<PublicUser> => {
	const user = await prisma.user.update({
		where: { id: userId },
		data: {
			...(payload.firstName !== undefined ? { firstName: payload.firstName } : {}),
			...(payload.lastName !== undefined ? { lastName: payload.lastName } : {}),
			...(payload.company !== undefined ? { company: payload.company } : {}),
			...(payload.phone !== undefined ? { phone: payload.phone } : {}),
			...(payload.locale !== undefined ? { locale: payload.locale } : {}),
		},
	})

	return toPublicUser(user)
}

const listAddresses = async (userId: string) => {
	const rows = await prisma.address.findMany({
		where: { userId },
		orderBy: [{ isDefaultBilling: "desc" }, { isDefaultShipping: "desc" }, { createdAt: "asc" }],
	})
	return rows.map(view)
}

const getAddress = async (userId: string, id: string) => {
	// Scoped by userId, so one customer can never read another's address book.
	const row = await prisma.address.findFirst({ where: { id, userId } })
	if (!row) throw notFound()
	return view(row)
}

/** Exactly one default of each kind. Setting a new one clears the old. */
const clearDefaults = async (
	tx: Prisma.TransactionClient,
	userId: string,
	opts: { billing?: boolean; shipping?: boolean },
	exceptId?: string
) => {
	if (opts.billing) {
		await tx.address.updateMany({
			where: { userId, isDefaultBilling: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
			data: { isDefaultBilling: false },
		})
	}
	if (opts.shipping) {
		await tx.address.updateMany({
			where: { userId, isDefaultShipping: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
			data: { isDefaultShipping: false },
		})
	}
}

const createAddress = async (userId: string, payload: Record<string, unknown>) => {
	const existingCount = await prisma.address.count({ where: { userId } })

	// The first address a customer saves becomes both defaults — otherwise they
	// have an address book with nothing selected, which helps nobody.
	const isFirst = existingCount === 0
	const billing = Boolean(payload.isDefaultBilling) || isFirst
	const shipping = Boolean(payload.isDefaultShipping) || isFirst

	const row = await prisma.$transaction(async (tx) => {
		await clearDefaults(tx, userId, { billing, shipping })

		return tx.address.create({
			data: {
				userId,
				label: (payload.label as string) ?? null,
				firstName: payload.firstName as string,
				lastName: payload.lastName as string,
				company: (payload.company as string) ?? null,
				street1: payload.street1 as string,
				street2: (payload.street2 as string) ?? null,
				city: payload.city as string,
				state: (payload.state as string) ?? null,
				postcode: payload.postcode as string,
				countryCode: payload.countryCode as string,
				phone: (payload.phone as string) ?? null,
				email: (payload.email as string) ?? null,
				isDefaultBilling: billing,
				isDefaultShipping: shipping,
			},
		})
	})

	return view(row)
}

const updateAddress = async (userId: string, id: string, payload: Record<string, unknown>) => {
	if (!(await prisma.address.findFirst({ where: { id, userId } }))) throw notFound()

	const row = await prisma.$transaction(async (tx) => {
		await clearDefaults(
			tx,
			userId,
			{ billing: payload.isDefaultBilling === true, shipping: payload.isDefaultShipping === true },
			id
		)

		return tx.address.update({
			where: { id },
			data: Object.fromEntries(
				Object.entries(payload).filter(([, v]) => v !== undefined)
			) as Prisma.AddressUpdateInput,
		})
	})

	return view(row)
}

const removeAddress = async (userId: string, id: string) => {
	const row = await prisma.address.findFirst({ where: { id, userId } })
	if (!row) throw notFound()

	await prisma.address.delete({ where: { id } })

	// Promote another entry so the customer is never left with a book that has
	// no default selected.
	if (row.isDefaultBilling || row.isDefaultShipping) {
		const next = await prisma.address.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } })
		if (next) {
			await prisma.address.update({
				where: { id: next.id },
				data: {
					isDefaultBilling: row.isDefaultBilling || next.isDefaultBilling,
					isDefaultShipping: row.isDefaultShipping || next.isDefaultShipping,
				},
			})
		}
	}
}

export const AccountService = {
	updateProfile,
	listAddresses,
	getAddress,
	createAddress,
	updateAddress,
	removeAddress,
}
