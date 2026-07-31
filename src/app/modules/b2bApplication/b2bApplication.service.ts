import bcrypt from "bcrypt"
import type { Prisma, UserStatus } from "@prisma/client"
import type { LocaleCode } from "../../../config/locales"
import { sendAccountDecision, notifyStaff } from "../../../helpers/mailer"
import { t } from "../../../i18n"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"
import { BCRYPT_ROUNDS } from "../auth/auth.constant"

const include = { user: true } satisfies Prisma.B2bApplicationInclude
type Row = Prisma.B2bApplicationGetPayload<{ include: typeof include }>

const view = (row: Row) => ({
	id: row.id,
	userId: row.userId,
	/// Decision state lives on the user, so there is one source of truth for
	/// whether wholesale pricing applies.
	status: row.user.status,
	email: row.user.email,
	company: {
		name: row.companyName,
		vatNumber: row.vatNumber,
		registerNumber: row.registerNumber,
		foundingDate: row.foundingDate,
		website: row.website,
		businessType: row.businessType,
		expectedVolume: row.expectedVolume,
		psiMember: row.psiMember,
	},
	address: {
		street: row.street,
		street2: row.street2,
		postcode: row.postcode,
		city: row.city,
		countryCode: row.countryCode,
	},
	contact: {
		salutation: row.salutation,
		firstName: row.firstName,
		lastName: row.lastName,
		phone: row.phone,
	},
	message: row.message,
	review: {
		reviewedAt: row.reviewedAt,
		reviewedBy: row.reviewedBy,
		note: row.reviewNote,
	},
	submittedAt: row.createdAt,
})

/* eslint-disable @typescript-eslint/no-explicit-any */
const apply = async (payload: any, locale: LocaleCode) => {
	const existing = await prisma.user.findUnique({ where: { email: payload.email } })
	if (existing) {
		throw new ApiError(httpStatus.CONFLICT, "Email already registered", {
			messageKey: "auth.emailTaken",
		})
	}

	// Hashed before the transaction opens — bcrypt at cost 12 would otherwise
	// pin a database connection for hundreds of milliseconds.
	const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS)

	const created = await prisma.$transaction(async (tx) => {
		const user = await tx.user.create({
			data: {
				email: payload.email,
				passwordHash,
				// RESELLER but PENDING: they can sign in and see their status, and
				// R5b prices them as a guest until someone approves. Registering
				// must never be the thing that unlocks wholesale prices.
				role: "RESELLER",
				status: "PENDING",
				salutation: payload.salutation ?? null,
				firstName: payload.firstName,
				lastName: payload.lastName,
				company: payload.companyName,
				phone: payload.phone ?? null,
				vatNumber: payload.vatNumber ?? null,
				foundingDate: payload.foundingDate ?? null,
				psiMember: payload.psiMember ?? false,
				// Validation already refused anything but an explicit true.
				termsAcceptedAt: new Date(),
				locale: payload.locale ?? locale,
			},
		})

		// The application keeps its own copy of the address as submitted — it is
		// evidence of what was applied for and must not change afterwards. This
		// one is the customer's editable address book, so checkout is not empty
		// on their first order.
		await tx.address.create({
			data: {
				userId: user.id,
				firstName: payload.firstName,
				lastName: payload.lastName,
				company: payload.companyName,
				street1: payload.street,
				street2: payload.street2 ?? null,
				postcode: payload.postcode,
				city: payload.city,
				countryCode: payload.countryCode,
				phone: payload.phone ?? null,
				email: payload.email,
				isDefaultBilling: true,
				isDefaultShipping: true,
			},
		})

		return tx.b2bApplication.create({
			data: {
				userId: user.id,
				companyName: payload.companyName,
				vatNumber: payload.vatNumber ?? null,
				registerNumber: payload.registerNumber ?? null,
				foundingDate: payload.foundingDate ?? null,
				website: payload.website ?? null,
				businessType: payload.businessType ?? null,
				expectedVolume: payload.expectedVolume ?? null,
				psiMember: payload.psiMember ?? false,
				street: payload.street,
				street2: payload.street2 ?? null,
				postcode: payload.postcode,
				city: payload.city,
				countryCode: payload.countryCode,
				salutation: payload.salutation ?? null,
				firstName: payload.firstName,
				lastName: payload.lastName,
				phone: payload.phone ?? null,
				message: payload.message ?? null,
			},
			include,
		})
	})

	await notifyStaff({
		locale,
		subject: t("staff.newDealer.subject", locale, { company: payload.companyName }),
		title: t("staff.newDealer.title", locale),
		intro: t("staff.newDealer.intro", locale, {
			company: payload.companyName,
			name: `${payload.firstName} ${payload.lastName}`,
		}),
	})

	return view(created)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const list = async (params: {
	status?: UserStatus
	search?: string
	page: number
	limit: number
}) => {
	const where: Prisma.B2bApplicationWhereInput = {
		...(params.status ? { user: { status: params.status } } : {}),
		...(params.search
			? {
					OR: [
						{ companyName: { contains: params.search, mode: "insensitive" } },
						{ lastName: { contains: params.search, mode: "insensitive" } },
						{ vatNumber: { contains: params.search, mode: "insensitive" } },
						{ user: { email: { contains: params.search, mode: "insensitive" } } },
					],
				}
			: {}),
	}

	const [rows, total] = await Promise.all([
		prisma.b2bApplication.findMany({
			where,
			include,
			orderBy: { createdAt: "desc" },
			skip: (params.page - 1) * params.limit,
			take: params.limit,
		}),
		prisma.b2bApplication.count({ where }),
	])

	return {
		data: rows.map(view),
		meta: {
			page: params.page,
			limit: params.limit,
			total,
			totalPages: Math.ceil(total / params.limit) || 1,
		},
	}
}

const getById = async (id: string) => {
	const row = await prisma.b2bApplication.findUnique({ where: { id }, include })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Application not found", {
			messageKey: "b2b.notFound",
		})
	}
	return view(row)
}

/**
 * Approve or reject. Moves the user's status, records who decided, and emails
 * the applicant — a dealer waiting on approval should not have to guess.
 */
const decide = async (
	id: string,
	payload: { approve: boolean; note?: string },
	staffUserId: string
) => {
	const row = await prisma.b2bApplication.findUnique({ where: { id }, include })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Application not found", {
			messageKey: "b2b.notFound",
		})
	}

	await prisma.$transaction(async (tx) => {
		await tx.user.update({
			where: { id: row.userId },
			data: { status: payload.approve ? "ACTIVE" : "REJECTED" },
		})

		// A rejected applicant must not keep browsing on a token issued while
		// they were pending.
		if (!payload.approve) {
			await tx.refreshToken.updateMany({
				where: { userId: row.userId, revokedAt: null },
				data: { revokedAt: new Date() },
			})
		}

		await tx.b2bApplication.update({
			where: { id },
			data: {
				reviewedAt: new Date(),
				reviewedBy: staffUserId,
				reviewNote: payload.note ?? null,
			},
		})
	})

	await sendAccountDecision({
		to: row.user.email,
		locale: row.user.locale as LocaleCode,
		name: `${row.firstName} ${row.lastName}`,
		approved: payload.approve,
	})

	return getById(id)
}

export const B2bService = { apply, list, getById, decide }
