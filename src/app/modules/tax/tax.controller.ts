import type { RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { TaxService } from "./tax.service"

const listClasses: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await TaxService.listClasses(req.locale),
	})
})

const getClass: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await TaxService.getClass(req.params.id as string, req.locale),
	})
})

const createClass: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("tax.classCreated", req.locale),
		data: await TaxService.createClass(req.body, req.locale),
	})
})

const updateClass: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("tax.classUpdated", req.locale),
		data: await TaxService.updateClass(req.params.id as string, req.body, req.locale),
	})
})

const removeClass: RequestHandler = catchAsync(async (req, res) => {
	await TaxService.removeClass(req.params.id as string)
	sendResponse(res, { statusCode: httpStatus.OK, message: t("tax.classDeleted", req.locale) })
})

const createRate: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("tax.rateCreated", req.locale),
		data: await TaxService.createRate(req.body),
	})
})

const updateRate: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("tax.rateUpdated", req.locale),
		data: await TaxService.updateRate(req.params.id as string, req.body),
	})
})

const removeRate: RequestHandler = catchAsync(async (req, res) => {
	await TaxService.removeRate(req.params.id as string)
	sendResponse(res, { statusCode: httpStatus.OK, message: t("tax.rateDeleted", req.locale) })
})

export const TaxController = {
	listClasses,
	getClass,
	createClass,
	updateClass,
	removeClass,
	createRate,
	updateRate,
	removeRate,
}
