import type { RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { PaymentService } from "./payment.service"

const list: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PaymentService.list(req.locale),
	})
})

const getById: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PaymentService.getById(req.params.id as string, req.locale),
	})
})

const update: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("payment.updated", req.locale),
		data: await PaymentService.update(req.params.id as string, req.body, req.locale),
	})
})

const available: RequestHandler = catchAsync(async (req, res) => {
	const q = req.query as unknown as { countryCode?: string; orderTotal?: number }

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PaymentService.available(
			{
				userId: req.user?.sub,
				role: req.user?.role,
				countryCode: q.countryCode,
				orderTotal: Number(q.orderTotal ?? 0),
			},
			req.locale
		),
	})
})

const remove: RequestHandler = catchAsync(async (req, res) => {
	await PaymentService.remove(req.params.id as string)
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("payment.deleted", req.locale),
	})
})

export const PaymentController = { list, getById, update, remove, available }
