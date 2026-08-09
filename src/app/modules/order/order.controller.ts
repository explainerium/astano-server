import type { RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { OrderService } from "./order.service"

const preview: RequestHandler = catchAsync(async (req, res) => {
	const address = req.body?.shippingAddress ?? req.body?.billingAddress

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await OrderService.preview({
			userId: req.user!.sub,
			role: req.user!.role,
			status: req.user!.status,
			locale: req.locale,
			shippingCountry: address?.countryCode,
			shippingState: address?.state,
			shippingMethodId: req.body?.shippingMethodId,
			vatNumber: req.body?.vatNumber,
		}),
	})
})

const place: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("order.placed", req.locale),
		data: await OrderService.place({
			userId: req.user!.sub,
			role: req.user!.role,
			status: req.user!.status,
			locale: req.locale,
			billingAddress: req.body.billingAddress,
			shippingAddress: req.body.shippingAddress,
			shippingMethodId: req.body.shippingMethodId,
			paymentMethodId: req.body.paymentMethodId,
			customerNote: req.body.customerNote,
			vatNumber: req.body.vatNumber,
		}),
	})
})

const listMine: RequestHandler = catchAsync(async (req, res) => {
	const q = req.query as unknown as { page?: number; limit?: number }
	const result = await OrderService.listMine(
		req.user!.sub,
		Number(q.page ?? 1),
		Number(q.limit ?? 20)
	)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: result.data,
		meta: result.meta,
	})
})

const getMine: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await OrderService.getMine(req.user!.sub, req.params.id as string),
	})
})

const adminList: RequestHandler = catchAsync(async (req, res) => {
	const q = req.query as unknown as {
		status?: never
		search?: string
		page?: number
		limit?: number
	}

	const result = await OrderService.adminList({
		status: q.status,
		search: q.search,
		page: Number(q.page ?? 1),
		limit: Number(q.limit ?? 20),
	})

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: result.data,
		meta: result.meta,
	})
})

const adminGet: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await OrderService.adminGet(req.params.id as string),
	})
})

const updateStatus: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("order.statusUpdated", req.locale),
		data: await OrderService.updateStatus(req.params.id as string, req.body, req.user!.sub),
	})
})

const listNotes: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await OrderService.listNotes(req.params.id as string),
	})
})

const addNote: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t(req.body.isCustomerVisible ? "order.noteSent" : "order.noteAdded", req.locale),
		data: await OrderService.addNote(req.params.id as string, req.body, req.user!.sub),
	})
})

export const OrderController = {
	preview,
	place,
	listNotes,
	addNote,
	listMine,
	getMine,
	adminList,
	adminGet,
	updateStatus,
}
