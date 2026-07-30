import type { Prisma, UserRole, UserStatus } from "@prisma/client"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"
import { sendAccountDecision } from "../../../helpers/mailer"
import { type PublicUser, toPublicUser } from "../auth/auth.interface"

interface ListParams {
	status?: UserStatus
	role?: UserRole
	search?: string
	page: number
	limit: number
}

const list = async (
	params: ListParams
): Promise<{ data: PublicUser[]; meta: { page: number; limit: number; total: number; totalPages: number } }> => {
	const where: Prisma.UserWhereInput = {
		...(params.status ? { status: params.status } : {}),
		...(params.role ? { role: params.role } : {}),
		...(params.search
			? {
					OR: [
						{ email: { contains: params.search, mode: "insensitive" } },
						{ company: { contains: params.search, mode: "insensitive" } },
						{ lastName: { contains: params.search, mode: "insensitive" } },
					],
				}
			: {}),
	}

	const [rows, total] = await Promise.all([
		prisma.user.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip: (params.page - 1) * params.limit,
			take: params.limit,
		}),
		prisma.user.count({ where }),
	])

	return {
		data: rows.map(toPublicUser),
		meta: {
			page: params.page,
			limit: params.limit,
			total,
			totalPages: Math.ceil(total / params.limit) || 1,
		},
	}
}

const getById = async (id: string): Promise<PublicUser> => {
	const user = await prisma.user.findUnique({ where: { id } })
	if (!user) {
		throw new ApiError(httpStatus.NOT_FOUND, "User not found", {
			messageKey: "auth.userNotFound",
		})
	}
	return toPublicUser(user)
}

/**
 * Approve a dealer application: status PENDING -> ACTIVE.
 *
 * Only this transition unlocks wholesale pricing (R5b), which is why approval
 * is an explicit admin action and never a side effect of anything else.
 */
const approve = async (id: string): Promise<PublicUser> => {
	const user = await prisma.user.findUnique({ where: { id } })
	if (!user) {
		throw new ApiError(httpStatus.NOT_FOUND, "User not found", {
			messageKey: "auth.userNotFound",
		})
	}

	if (user.status === "ACTIVE") {
		throw new ApiError(httpStatus.CONFLICT, "User is already active", {
			messageKey: "user.alreadyActive",
		})
	}

	const updated = await prisma.user.update({
		where: { id },
		data: { status: "ACTIVE" },
	})

	await sendAccountDecision({
		to: updated.email,
		locale: updated.locale as never,
		name: [updated.firstName, updated.lastName].filter(Boolean).join(" ") || updated.email,
		approved: true,
	})

	return toPublicUser(updated)
}

/**
 * Reject an application. Existing sessions are revoked immediately — a rejected
 * account must not keep browsing on a token issued while it was pending.
 */
const reject = async (id: string): Promise<PublicUser> => {
	const user = await prisma.user.findUnique({ where: { id } })
	if (!user) {
		throw new ApiError(httpStatus.NOT_FOUND, "User not found", {
			messageKey: "auth.userNotFound",
		})
	}

	const [updated] = await prisma.$transaction([
		prisma.user.update({ where: { id }, data: { status: "REJECTED" } }),
		prisma.refreshToken.updateMany({
			where: { userId: id, revokedAt: null },
			data: { revokedAt: new Date() },
		}),
	])

	await sendAccountDecision({
		to: updated.email,
		locale: updated.locale as never,
		name: [updated.firstName, updated.lastName].filter(Boolean).join(" ") || updated.email,
		approved: false,
	})

	return toPublicUser(updated)
}

const setRole = async (id: string, role: UserRole): Promise<PublicUser> => {
	const user = await prisma.user.findUnique({ where: { id } })
	if (!user) {
		throw new ApiError(httpStatus.NOT_FOUND, "User not found", {
			messageKey: "auth.userNotFound",
		})
	}

	const updated = await prisma.user.update({ where: { id }, data: { role } })
	return toPublicUser(updated)
}

export const UserService = { list, getById, approve, reject, setRole }
