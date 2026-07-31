import type { RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { CategoryService } from "./category.service"

const list: RequestHandler = catchAsync(async (req, res) => {
	const { includeHidden, tree } = req.query as unknown as {
		includeHidden?: boolean
		tree?: boolean
	}

	// Hidden categories are staff-only, whatever the query says (R13).
	const isStaff = req.user?.role === "ADMIN" || req.user?.role === "SHOP_MANAGER"

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await CategoryService.list(req.locale, {
			includeHidden: Boolean(includeHidden) && isStaff,
			tree: tree !== false,
		}),
	})
})

const getBySlug: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await CategoryService.getBySlug(req.params.slug as string, req.locale),
	})
})

const create: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("category.created", req.locale),
		data: await CategoryService.create(req.body, req.locale),
	})
})

const update: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("category.updated", req.locale),
		data: await CategoryService.update(req.params.id as string, req.body, req.locale),
	})
})

const remove: RequestHandler = catchAsync(async (req, res) => {
	await CategoryService.remove(req.params.id as string)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("category.deleted", req.locale),
	})
})

/** Staff list — flat, hidden included, every translation attached. */
const adminList: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await CategoryService.adminList(),
	})
})

const adminGetById: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await CategoryService.adminGetById(req.params.id as string),
	})
})

export const CategoryController = {
	list,
	getBySlug,
	create,
	update,
	remove,
	adminList,
	adminGetById,
}
