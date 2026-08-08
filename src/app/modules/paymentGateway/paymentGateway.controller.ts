import type { RequestHandler } from "express"
import type { PaymentGatewayMode, PaymentGatewayProvider } from "@prisma/client"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { PaymentGatewayService } from "./paymentGateway.service"

const providerOf = (req: { params: Record<string, unknown> }) =>
	req.params.provider as PaymentGatewayProvider

const list: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PaymentGatewayService.list(),
	})
})

const getOne: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PaymentGatewayService.getOne(providerOf(req)),
	})
})

const saveCredentials: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("payment.credentialsSaved", req.locale),
		data: await PaymentGatewayService.saveCredentials(
			providerOf(req),
			req.body.mode as PaymentGatewayMode,
			req.body.credentials
		),
	})
})

/**
 * Always 200, even when the connection failed.
 *
 * The request succeeded — we asked the provider and got an answer. The answer
 * being "no" is data for the screen to render, not an HTTP error, and returning
 * 4xx here would send it down the generic error path where the useful message
 * gets replaced by "something went wrong".
 */
const testConnection: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PaymentGatewayService.testConnection(
			providerOf(req),
			req.body.mode as PaymentGatewayMode
		),
	})
})

const updateSettings: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("payment.gatewayUpdated", req.locale),
		data: await PaymentGatewayService.updateSettings(providerOf(req), req.body),
	})
})

export const PaymentGatewayController = {
	list,
	getOne,
	saveCredentials,
	testConnection,
	updateSettings,
}
