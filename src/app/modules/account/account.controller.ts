import type { RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { AccountService } from "./account.service"

const updateProfile: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("account.profileUpdated", req.locale),
		data: await AccountService.updateProfile(req.user!.sub, req.body),
	})
})

const requestEmailChange: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("account.emailChangeRequested", req.locale),
		data: await AccountService.requestEmailChange(
			req.user!.sub,
			req.body.email,
			req.body.currentPassword
		),
	})
})

const pendingEmailChange: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await AccountService.pendingEmailChange(req.user!.sub),
	})
})

const cancelEmailChange: RequestHandler = catchAsync(async (req, res) => {
	await AccountService.cancelEmailChange(req.user!.sub)
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("account.emailChangeCancelled", req.locale),
		data: null,
	})
})

/** Public — the token is the authorisation. See AccountService.verifyEmailChange. */
const verifyEmailChange: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("account.emailChanged", req.locale),
		data: await AccountService.verifyEmailChange(req.body.token),
	})
})

const listAddresses: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await AccountService.listAddresses(req.user!.sub),
	})
})

const getAddress: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await AccountService.getAddress(req.user!.sub, req.params.id as string),
	})
})

const createAddress: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("account.addressSaved", req.locale),
		data: await AccountService.createAddress(req.user!.sub, req.body),
	})
})

const updateAddress: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("account.addressUpdated", req.locale),
		data: await AccountService.updateAddress(req.user!.sub, req.params.id as string, req.body),
	})
})

const removeAddress: RequestHandler = catchAsync(async (req, res) => {
	await AccountService.removeAddress(req.user!.sub, req.params.id as string)
	sendResponse(res, { statusCode: httpStatus.OK, message: t("account.addressDeleted", req.locale) })
})

export const AccountController = {
	updateProfile,
	requestEmailChange,
	pendingEmailChange,
	cancelEmailChange,
	verifyEmailChange,
	listAddresses,
	getAddress,
	createAddress,
	updateAddress,
	removeAddress,
}
