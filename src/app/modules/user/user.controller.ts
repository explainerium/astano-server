import type { Request, RequestHandler } from "express"
import type { UserRole, UserStatus } from "@prisma/client"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { UserService, type AssignableStatus } from "./user.service"

/**
 * The signed-in staff member, for the service's own guards.
 *
 * `sub`, not `id`. AccessTokenPayload extends JwtPayload, which carries an index
 * signature — so `req.user.id` typechecks happily and is always undefined. The
 * claim is `sub`.
 */
const actorOf = (req: Request) => ({
	id: req.user?.sub as string,
	role: req.user?.role as UserRole,
})

const list: RequestHandler = catchAsync(async (req, res) => {
	const { status, role, search, deleted, page, limit } = req.query as unknown as {
		status?: UserStatus
		role?: UserRole
		search?: string
		deleted?: boolean
		page?: number
		limit?: number
	}

	const result = await UserService.list({
		status,
		role,
		search,
		deleted,
		page: Number(page ?? 1),
		limit: Number(limit ?? 20),
	})

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: result.data,
		meta: result.meta,
	})
})

const getById: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await UserService.getById(req.params.id as string),
	})
})

const approve: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("user.approved", req.locale),
		data: await UserService.approve(req.params.id as string, actorOf(req)),
	})
})

const reject: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("user.rejected", req.locale),
		data: await UserService.reject(req.params.id as string, actorOf(req)),
	})
})

const setStatus: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("user.statusUpdated", req.locale),
		data: await UserService.setStatus(
			req.params.id as string,
			req.body.status as AssignableStatus,
			actorOf(req)
		),
	})
})

const softDelete: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("user.deleted", req.locale),
		data: await UserService.softDelete(req.params.id as string, actorOf(req)),
	})
})

const restore: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("user.restored", req.locale),
		data: await UserService.restore(req.params.id as string, actorOf(req)),
	})
})

const purge: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("user.purged", req.locale),
		data: await UserService.purge(req.params.id as string, actorOf(req)),
	})
})

const setRole: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("user.roleUpdated", req.locale),
		data: await UserService.setRole(
			req.params.id as string,
			req.body.role as UserRole,
			actorOf(req)
		),
	})
})

export const UserController = {
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
