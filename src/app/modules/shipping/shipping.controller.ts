import type { RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { ShippingService } from "./shipping.service"

const listZones: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await ShippingService.listZones(req.locale),
	})
})

const getZone: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await ShippingService.getZone(req.params.id as string, req.locale),
	})
})

const createZone: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("shipping.zoneCreated", req.locale),
		data: await ShippingService.createZone(req.body, req.locale),
	})
})

const updateZone: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("shipping.zoneUpdated", req.locale),
		data: await ShippingService.updateZone(req.params.id as string, req.body, req.locale),
	})
})

const removeZone: RequestHandler = catchAsync(async (req, res) => {
	await ShippingService.removeZone(req.params.id as string)
	sendResponse(res, { statusCode: httpStatus.OK, message: t("shipping.zoneDeleted", req.locale) })
})

const createMethod: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("shipping.methodCreated", req.locale),
		data: await ShippingService.createMethod(req.body, req.locale),
	})
})

const updateMethod: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("shipping.methodUpdated", req.locale),
		data: await ShippingService.updateMethod(req.params.id as string, req.body, req.locale),
	})
})

const removeMethod: RequestHandler = catchAsync(async (req, res) => {
	await ShippingService.removeMethod(req.params.id as string)
	sendResponse(res, { statusCode: httpStatus.OK, message: t("shipping.methodDeleted", req.locale) })
})

/** Public: the checkout needs to show what delivery would cost. */
const quote: RequestHandler = catchAsync(async (req, res) => {
	const q = req.query as unknown as { countryCode: string; weightKg: number; subtotal: number }

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await ShippingService.quote(
			{
				countryCode: q.countryCode,
				weightKg: Number(q.weightKg ?? 0),
				subtotal: Number(q.subtotal ?? 0),
			},
			req.locale
		),
	})
})

/** The countries a customer may actually choose. Codes only — see the service. */
const countries: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: { countries: await ShippingService.deliverableCountries() },
	})
})

export const ShippingController = {
	countries,
	listZones,
	getZone,
	createZone,
	updateZone,
	removeZone,
	createMethod,
	updateMethod,
	removeMethod,
	quote,
}
