import bcrypt from "bcrypt"
import type { Address, Prisma } from "@prisma/client"
import { env } from "../../../config"
import { localePrefix, type LocaleCode } from "../../../config/locales"
import { sendEmailChanged, sendEmailChangeVerification } from "../../../helpers/mailer"
import { t } from "../../../i18n"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { durationToMs, generateToken, hashToken } from "../../../shared/token"
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

/**
 * A customer edits their own details.
 *
 * **Email is not here.** It is the account's identity and the address invoices
 * go to, so it changes only through the verified flow below — see
 * `requestEmailChange`. Role and status are not here either: what someone is,
 * and whether they may trade, is never their own decision.
 *
 * A changed VAT number drops its validated flag. Reverse charge (R10) depends on
 * that flag, and a number nobody has checked against VIES must not inherit the
 * previous one's approval — that would be a way to zero the tax on an invoice by
 * typing over a field.
 */
const updateProfile = async (
	userId: string,
	payload: {
		salutation?: string | null
		firstName?: string | null
		lastName?: string | null
		company?: string | null
		phone?: string | null
		vatNumber?: string | null
		foundingDate?: Date | null
		psiMember?: boolean
		locale?: string
	}
): Promise<PublicUser> => {
	const current = await prisma.user.findUnique({
		where: { id: userId },
		select: { vatNumber: true },
	})

	const vatChanged =
		payload.vatNumber !== undefined && payload.vatNumber !== current?.vatNumber

	const user = await prisma.user.update({
		where: { id: userId },
		data: {
			...(payload.salutation !== undefined ? { salutation: payload.salutation } : {}),
			...(payload.firstName !== undefined ? { firstName: payload.firstName } : {}),
			...(payload.lastName !== undefined ? { lastName: payload.lastName } : {}),
			...(payload.company !== undefined ? { company: payload.company } : {}),
			...(payload.phone !== undefined ? { phone: payload.phone } : {}),
			...(payload.foundingDate !== undefined ? { foundingDate: payload.foundingDate } : {}),
			...(payload.psiMember !== undefined ? { psiMember: payload.psiMember } : {}),
			...(payload.locale !== undefined ? { locale: payload.locale } : {}),
			...(payload.vatNumber !== undefined ? { vatNumber: payload.vatNumber } : {}),
			...(vatChanged ? { vatValidated: false, vatValidatedAt: null } : {}),
		},
	})

	return toPublicUser(user)
}

// ─── Email change ───────────────────────────────────────────────────────────

/**
 * Changing the address an account signs in with, and the one its invoices go to.
 *
 * The rule is that the new address proves it can receive mail *before* it
 * becomes the account's. Nothing about the user row changes when the form is
 * saved: the request is parked in EmailChangeToken and only the link swaps it
 * over. Anything less and a typo locks somebody out of their own shop account,
 * with the reset link going to an address that does not exist.
 */

const EMAIL_CHANGE_TTL = "24h"

/**
 * Where the confirmation link points.
 *
 * Duplicates the frontend's own routing map, which is unavoidable — the mail is
 * composed here and the page lives there. Keep in step with `pathnames` in
 * frontend/src/i18n/routing.ts; the proxy carries the same warning for the same
 * reason.
 */
const VERIFY_PATH: Record<string, string> = {
	en: "/verify-email",
	de: "/e-mail-bestaetigen",
}

const verifyUrl = (locale: LocaleCode, token: string): string =>
	`${env.PUBLIC_BASE_URL}${localePrefix(locale)}${VERIFY_PATH[locale] ?? VERIFY_PATH.en}?token=${token}`

const sendVerification = async (to: string, locale: LocaleCode, token: string): Promise<void> => {
	// Composed in the mailer like every other message, so it picks up the shop's
	// branding and the admin's settings. It used to build its own layout here,
	// which meant it quietly ignored both.
	await sendEmailChangeVerification({ to, locale, verifyUrl: verifyUrl(locale, token) })
}

/**
 * Tell the address that is losing the account that it is losing the account.
 *
 * This is the part that makes the flow safe rather than merely correct. If
 * somebody else changes the address, the only person who finds out from the
 * verification mail is the attacker — the owner learns about it here, at the
 * address they still control, while they can still act on it.
 */
const notifyOldAddress = async (to: string, locale: LocaleCode, newEmail: string): Promise<void> => {
	await sendEmailChanged({ to, locale, newEmail })
}

/** Whether the address is free — including accounts that are only soft-deleted. */
const assertAddressFree = async (email: string, exceptUserId: string): Promise<void> => {
	const taken = await prisma.user.findFirst({
		where: { email, id: { not: exceptUserId } },
		select: { id: true },
	})

	if (taken) {
		throw new ApiError(httpStatus.CONFLICT, "Another account already uses that email", {
			messageKey: "user.emailTakenByOther",
		})
	}
}

const requestEmailChange = async (
	userId: string,
	newEmail: string,
	currentPassword: string
): Promise<{ pendingEmail: string; expiresAt: Date }> => {
	const user = await prisma.user.findUnique({ where: { id: userId } })
	if (!user) {
		throw new ApiError(httpStatus.NOT_FOUND, "User not found", { messageKey: "user.notFound" })
	}

	/*
	 * The password, before anything else.
	 *
	 * The link proves the new address is real; this proves the request came from
	 * the account's owner. Without it a borrowed session is enough to redirect
	 * somebody's account to an attacker's mailbox and then reset the password
	 * from there.
	 */
	if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
		throw new ApiError(httpStatus.UNAUTHORIZED, "That password is not correct", {
			messageKey: "auth.invalidCredentials",
		})
	}

	if (user.email === newEmail) {
		throw new ApiError(httpStatus.CONFLICT, "That is already your email address", {
			messageKey: "account.emailUnchanged",
		})
	}

	await assertAddressFree(newEmail, userId)

	const token = generateToken()
	const expiresAt = new Date(Date.now() + durationToMs(EMAIL_CHANGE_TTL))

	/*
	 * Earlier requests are spent, not left lying around. Asking again — because
	 * the first mail went astray, or because the address was mistyped twice —
	 * must not leave two live links, one of which points at an address the
	 * customer has already thought better of.
	 */
	await prisma.$transaction([
		prisma.emailChangeToken.updateMany({
			where: { userId, usedAt: null },
			data: { usedAt: new Date() },
		}),
		prisma.emailChangeToken.create({
			data: { userId, newEmail, tokenHash: hashToken(token), expiresAt },
		}),
	])

	await sendVerification(newEmail, user.locale as LocaleCode, token)

	return { pendingEmail: newEmail, expiresAt }
}

/** What the profile screen shows while a change is waiting. */
const pendingEmailChange = async (
	userId: string
): Promise<{ pendingEmail: string; expiresAt: Date } | null> => {
	const row = await prisma.emailChangeToken.findFirst({
		where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
		orderBy: { createdAt: "desc" },
	})

	return row ? { pendingEmail: row.newEmail, expiresAt: row.expiresAt } : null
}

const cancelEmailChange = async (userId: string): Promise<void> => {
	const { count } = await prisma.emailChangeToken.updateMany({
		where: { userId, usedAt: null },
		data: { usedAt: new Date() },
	})

	if (count === 0) {
		throw new ApiError(httpStatus.NOT_FOUND, "Nothing to cancel", {
			messageKey: "account.noEmailChangePending",
		})
	}
}

/**
 * Consume the link. Unauthenticated on purpose — the token *is* the proof.
 *
 * The link will be opened wherever the mailbox is, which is frequently not the
 * browser the customer was signed in to. Requiring a session here would mean the
 * confirmation quietly failing for anyone reading their mail on a phone.
 */
const verifyEmailChange = async (token: string): Promise<PublicUser> => {
	const invalid = new ApiError(httpStatus.BAD_REQUEST, "This link is invalid or has expired", {
		messageKey: "account.invalidEmailToken",
	})

	const stored = await prisma.emailChangeToken.findUnique({
		where: { tokenHash: hashToken(token) },
		include: { user: true },
	})

	if (!stored || stored.usedAt || stored.expiresAt < new Date()) throw invalid
	if (stored.user.deletedAt) throw invalid

	// Checked again here, not only when the change was requested. Somebody else
	// may have registered the address in the meantime, and the unique constraint
	// would otherwise surface as a database error rather than an explanation.
	await assertAddressFree(stored.newEmail, stored.userId)

	const previousEmail = stored.user.email

	const [updated] = await prisma.$transaction([
		prisma.user.update({ where: { id: stored.userId }, data: { email: stored.newEmail } }),
		prisma.emailChangeToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
	])

	await notifyOldAddress(previousEmail, updated.locale as LocaleCode, updated.email)

	return toPublicUser(updated)
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
	requestEmailChange,
	pendingEmailChange,
	cancelEmailChange,
	verifyEmailChange,
	listAddresses,
	getAddress,
	createAddress,
	updateAddress,
	removeAddress,
}
