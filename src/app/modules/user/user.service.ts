import type { Prisma, User, UserRole, UserStatus } from "@prisma/client"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"
import { sendAccountDecision } from "../../../helpers/mailer"
import { type PublicUser, toPublicUser } from "../auth/auth.interface"

/**
 * Every account, whatever its role — this is the one staff-facing user module.
 *
 * Retail customers, dealers and staff are the same kind of row and always were;
 * splitting them across two screens only meant two places to look for one
 * person. Role is a filter here, not a separate system.
 */

interface ListParams {
	status?: UserStatus
	role?: UserRole
	search?: string
	/** Deleted accounts are hidden unless explicitly asked for. */
	deleted?: boolean
	page: number
	limit: number
}

/** Who is asking. Every moderation action is checked against the actor. */
interface Actor {
	id: string
	role: UserRole
}

/**
 * The statuses staff set by hand.
 *
 * PENDING and REJECTED are not here: those belong to the dealer decision, which
 * has its own path because it sends the applicant an email.
 */
export type AssignableStatus = Extract<UserStatus, "ACTIVE" | "SUSPENDED" | "DRAFT">

/** Roles that carry staff powers, and so need an admin to touch. */
const STAFF_ROLES: UserRole[] = ["ADMIN", "SHOP_MANAGER"]

/**
 * The staff view of an account.
 *
 * Wider than PublicUser, which is what the *account owner* sees. Deletion,
 * last sign-in and the dealer application are staff context; none of them
 * belongs in the response a customer gets about themselves.
 */
export interface AdminUser extends PublicUser {
	deletedAt: Date | null
	lastLoginAt: Date | null
	termsAcceptedAt: Date | null
	vatValidated: boolean
	updatedAt: Date
}

const toAdminUser = (user: User): AdminUser => ({
	...toPublicUser(user),
	deletedAt: user.deletedAt,
	lastLoginAt: user.lastLoginAt,
	termsAcceptedAt: user.termsAcceptedAt,
	vatValidated: user.vatValidated,
	updatedAt: user.updatedAt,
})

const notFound = () =>
	new ApiError(httpStatus.NOT_FOUND, "User not found", { messageKey: "user.notFound" })

const load = async (id: string): Promise<User> => {
	const user = await prisma.user.findUnique({ where: { id } })
	if (!user) throw notFound()
	return user
}

// ─── Guards ─────────────────────────────────────────────────────────────────

/**
 * Nobody moderates themselves.
 *
 * Not merely a footgun guard. An admin who can suspend, draft or delete their
 * own account can lock the shop's own staff out of it, and an admin who can
 * change their own role can only ever demote themselves — there is nothing above
 * ADMIN to promote to. Both are accidents waiting to happen with no legitimate
 * use behind them.
 */
const refuseSelf = (target: User, actor: Actor, messageKey: string) => {
	if (target.id === actor.id) {
		throw new ApiError(httpStatus.FORBIDDEN, "You cannot do this to your own account", {
			messageKey,
		})
	}
}

/**
 * A shop manager may look after customers, not colleagues.
 *
 * Otherwise the weaker staff role is a route to the stronger one: suspend the
 * admins, and a shop manager is the only person left who can act.
 */
const refuseUnlessAdminForStaff = (target: User, actor: Actor) => {
	if (STAFF_ROLES.includes(target.role) && actor.role !== "ADMIN") {
		throw new ApiError(httpStatus.FORBIDDEN, "Only an administrator can act on this account", {
			messageKey: "user.protectedAccount",
		})
	}
}

/**
 * The shop keeps at least one usable administrator.
 *
 * Counted live rather than trusted from a flag, and it counts only admins who
 * could actually sign in — a deleted or drafted admin is not a way back in.
 */
const refuseIfLastAdmin = async (target: User) => {
	if (target.role !== "ADMIN") return

	const usable = await prisma.user.count({
		where: { role: "ADMIN", status: "ACTIVE", deletedAt: null, id: { not: target.id } },
	})

	if (usable === 0) {
		throw new ApiError(httpStatus.CONFLICT, "This is the last administrator", {
			messageKey: "user.lastAdmin",
		})
	}
}

/** Sessions end when an account stops being able to trade. */
const revokeSessions = (userId: string): Prisma.PrismaPromise<Prisma.BatchPayload> =>
	prisma.refreshToken.updateMany({
		where: { userId, revokedAt: null },
		data: { revokedAt: new Date() },
	})

// ─── Reading ────────────────────────────────────────────────────────────────

const list = async (
	params: ListParams
): Promise<{
	data: AdminUser[]
	meta: {
		page: number
		limit: number
		total: number
		totalPages: number
		/** Per-status totals for the filter tabs, over the same deleted/not-deleted set. */
		counts: Record<string, number>
	}
}> => {
	const where: Prisma.UserWhereInput = {
		// A deleted account is gone as far as every screen is concerned until
		// somebody goes looking for it.
		deletedAt: params.deleted ? { not: null } : null,
		...(params.status ? { status: params.status } : {}),
		...(params.role ? { role: params.role } : {}),
		...(params.search
			? {
					OR: [
						{ email: { contains: params.search, mode: "insensitive" } },
						{ company: { contains: params.search, mode: "insensitive" } },
						{ firstName: { contains: params.search, mode: "insensitive" } },
						{ lastName: { contains: params.search, mode: "insensitive" } },
					],
				}
			: {}),
	}

	/*
	 * The tab counts ignore the status filter but honour everything else —
	 * otherwise selecting "Suspended" would zero every other tab and the
	 * navigation would collapse the moment it was used.
	 */
	const countWhere: Prisma.UserWhereInput = { ...where }
	delete countWhere.status

	const [rows, total, byStatus] = await Promise.all([
		prisma.user.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip: (params.page - 1) * params.limit,
			take: params.limit,
		}),
		prisma.user.count({ where }),
		prisma.user.groupBy({ by: ["status"], where: countWhere, _count: { _all: true } }),
	])

	return {
		data: rows.map(toAdminUser),
		meta: {
			page: params.page,
			limit: params.limit,
			total,
			totalPages: Math.ceil(total / params.limit) || 1,
			counts: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
		},
	}
}

/**
 * One account with everything a staff member needs to decide about it.
 *
 * The dealer application comes along for the ride, which is what makes the
 * separate B2B screen unnecessary: one person, one page.
 */
const getById = async (id: string) => {
	const user = await prisma.user.findUnique({
		where: { id },
		include: {
			b2bApplication: true,
			_count: { select: { orders: true, quoteRequests: true, addresses: true } },
		},
	})
	if (!user) throw notFound()

	return {
		...toAdminUser(user),
		application: user.b2bApplication,
		counts: {
			orders: user._count.orders,
			quotes: user._count.quoteRequests,
			addresses: user._count.addresses,
		},
	}
}

// ─── Dealer decision ────────────────────────────────────────────────────────

/**
 * Approve a dealer application: PENDING -> ACTIVE.
 *
 * Only this transition unlocks wholesale pricing (R5b), which is why approval is
 * an explicit staff action and never a side effect of anything else.
 */
const approve = async (id: string, actor: Actor): Promise<AdminUser> => {
	const user = await load(id)
	refuseUnlessAdminForStaff(user, actor)

	if (user.deletedAt) throw notFound()

	if (user.status === "ACTIVE") {
		throw new ApiError(httpStatus.CONFLICT, "User is already active", {
			messageKey: "user.alreadyActive",
		})
	}

	const updated = await prisma.user.update({ where: { id }, data: { status: "ACTIVE" } })

	await sendAccountDecision({
		to: updated.email,
		locale: updated.locale as never,
		name: [updated.firstName, updated.lastName].filter(Boolean).join(" ") || updated.email,
		approved: true,
	})

	return toAdminUser(updated)
}

/**
 * Reject an application. Existing sessions are revoked immediately — a rejected
 * account must not keep browsing on a token issued while it was pending.
 */
const reject = async (id: string, actor: Actor): Promise<AdminUser> => {
	const user = await load(id)
	refuseSelf(user, actor, "user.selfModeration")
	refuseUnlessAdminForStaff(user, actor)
	await refuseIfLastAdmin(user)

	const [updated] = await prisma.$transaction([
		prisma.user.update({ where: { id }, data: { status: "REJECTED" } }),
		revokeSessions(id),
	])

	await sendAccountDecision({
		to: updated.email,
		locale: updated.locale as never,
		name: [updated.firstName, updated.lastName].filter(Boolean).join(" ") || updated.email,
		approved: false,
	})

	return toAdminUser(updated)
}

// ─── Moderation ─────────────────────────────────────────────────────────────

/**
 * Activate, suspend or draft an account.
 *
 * Activating something that is still PENDING goes through `approve` instead, so
 * the applicant gets told. One entry point for the screen, the right side
 * effects underneath — the alternative is an admin quietly activating a dealer
 * who never hears about it.
 *
 * Anything that is not ACTIVE ends the account's sessions. An access token
 * carries the status it was minted with, so without this a suspension would not
 * bite until the token expired on its own.
 */
const setStatus = async (
	id: string,
	status: AssignableStatus,
	actor: Actor
): Promise<AdminUser> => {
	const user = await load(id)

	if (status !== "ACTIVE") refuseSelf(user, actor, "user.selfModeration")
	refuseUnlessAdminForStaff(user, actor)
	if (status !== "ACTIVE") await refuseIfLastAdmin(user)

	if (user.deletedAt) throw notFound()
	if (status === "ACTIVE" && user.status === "PENDING") return approve(id, actor)
	if (user.status === status) return toAdminUser(user)

	const [updated] = await prisma.$transaction([
		prisma.user.update({ where: { id }, data: { status } }),
		...(status === "ACTIVE" ? [] : [revokeSessions(id)]),
	])

	return toAdminUser(updated)
}

/**
 * Delete reversibly — a timestamp, not a DELETE.
 *
 * This is the option the screen offers first, and it is the one that should be
 * used: orders reference their customer with SetNull, so destroying the row
 * really does erase who bought what. The address stays taken so nobody can
 * re-register it while the account is recoverable, and the sessions end at once.
 */
const softDelete = async (id: string, actor: Actor): Promise<AdminUser> => {
	const user = await load(id)
	refuseSelf(user, actor, "user.selfModeration")
	refuseUnlessAdminForStaff(user, actor)
	await refuseIfLastAdmin(user)

	if (user.deletedAt) return toAdminUser(user)

	const [updated] = await prisma.$transaction([
		prisma.user.update({
			where: { id },
			data: { deletedAt: new Date(), deletedBy: actor.id },
		}),
		revokeSessions(id),
	])

	return toAdminUser(updated)
}

/** Put a deleted account back exactly as it was. Its status is untouched. */
const restore = async (id: string, actor: Actor): Promise<AdminUser> => {
	const user = await load(id)
	refuseUnlessAdminForStaff(user, actor)

	if (!user.deletedAt) {
		throw new ApiError(httpStatus.CONFLICT, "This account has not been deleted", {
			messageKey: "user.notDeleted",
		})
	}

	const updated = await prisma.user.update({
		where: { id },
		data: { deletedAt: null, deletedBy: null },
	})

	return toAdminUser(updated)
}

/**
 * Destroy the row. ADMIN only, and there is no undo.
 *
 * Addresses, carts, baskets, wishlists and tokens cascade away with it. Orders
 * and quote requests do **not** — they keep their frozen name and address and
 * simply lose the link, because a deleted customer must not take the sales
 * record with them. Anyone reaching for this wants `softDelete` far more often
 * than they think.
 */
const purge = async (id: string, actor: Actor): Promise<{ id: string }> => {
	const user = await load(id)
	refuseSelf(user, actor, "user.selfModeration")
	await refuseIfLastAdmin(user)

	await prisma.user.delete({ where: { id } })
	return { id }
}

// ─── Role ───────────────────────────────────────────────────────────────────

/**
 * Change what someone is. ADMIN only, and never their own.
 *
 * A role decides what a customer pays, so this is the single most consequential
 * field on the row — hence the narrowest permission in the module.
 */
const setRole = async (id: string, role: UserRole, actor: Actor): Promise<AdminUser> => {
	const user = await load(id)

	refuseSelf(user, actor, "user.ownRole")
	if (user.deletedAt) throw notFound()

	// Demoting the last admin leaves nobody who can promote anyone back.
	if (role !== "ADMIN") await refuseIfLastAdmin(user)

	if (user.role === role) return toAdminUser(user)

	/*
	 * Losing staff powers ends the session too. A SHOP_MANAGER demoted to B2C
	 * would otherwise keep a token that still says SHOP_MANAGER, and the guard
	 * reads the token, not the row.
	 */
	const [updated] = await prisma.$transaction([
		prisma.user.update({ where: { id }, data: { role } }),
		...(STAFF_ROLES.includes(user.role) && !STAFF_ROLES.includes(role)
			? [revokeSessions(id)]
			: []),
	])

	return toAdminUser(updated)
}

export const UserService = {
	list,
	getById,
	approve,
	reject,
	setStatus,
	softDelete,
	restore,
	purge,
	setRole,
}
