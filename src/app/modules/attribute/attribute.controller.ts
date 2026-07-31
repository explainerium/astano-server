import type { RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { AttributeService } from "./attribute.service"

const list: RequestHandler = catchAsync(async (req, res) => {

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await AttributeService.list(req.locale),
	})
})

const getById: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await AttributeService.getById(req.params.id as string, req.locale),
	})
})

const create: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("attribute.created", req.locale),
		data: await AttributeService.create(req.body, req.locale),
	})
})

const update: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("attribute.updated", req.locale),
		data: await AttributeService.update(req.params.id as string, req.body, req.locale),
	})
})

const remove: RequestHandler = catchAsync(async (req, res) => {
	await AttributeService.remove(req.params.id as string)
	sendResponse(res, { statusCode: httpStatus.OK, message: t("attribute.deleted", req.locale) })
})

const removeValue: RequestHandler = catchAsync(async (req, res) => {
	await AttributeService.removeValue(req.params.id as string)
	sendResponse(res, { statusCode: httpStatus.OK, message: t("attribute.valueDeleted", req.locale) })
})

/** Staff list — every translation attached, for the editor. */
const adminList: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await AttributeService.adminList(),
	})
})

const adminGetById: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await AttributeService.adminGetById(req.params.id as string),
	})
})

export const AttributeController = {
	list,
	getById,
	create,
	update,
	remove,
	removeValue,
	adminList,
	adminGetById,
}
