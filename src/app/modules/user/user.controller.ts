import type { RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { UserService } from "./user.service"

const list: RequestHandler = catchAsync(async (req, res) => {
	const { status, role, search, page, limit } = req.query as unknown as {
		status?: "ACTIVE" | "PENDING" | "REJECTED"
		role?: "GUEST" | "B2C" | "RESELLER" | "SHOP_MANAGER" | "ADMIN"
		search?: string
		page?: number
		limit?: number
	}

	const result = await UserService.list({
		status,
		role,
		search,
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
		data: await UserService.approve(req.params.id as string),
	})
})

const reject: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("user.rejected", req.locale),
		data: await UserService.reject(req.params.id as string),
	})
})

const setRole: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("user.roleUpdated", req.locale),
		data: await UserService.setRole(req.params.id as string, req.body.role),
	})
})

export const UserController = { list, getById, approve, reject, setRole }
