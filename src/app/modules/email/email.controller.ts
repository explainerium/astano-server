import type { RequestHandler } from "express"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import ApiError from "../../errors/ApiError"
import { isEmailKind, type EmailKind } from "./emailRegistry"
import { EmailService } from "./email.service"

/** 404 rather than a validation error — an unknown kind is a wrong URL. */
const kindOf = (raw: string | string[] | undefined): EmailKind => {
	// Express 5 types a param as possibly repeated; only the single form is a
	// real email key, and a repeated one is as wrong as a misspelt one.
	const value = Array.isArray(raw) ? "" : (raw ?? "")

	if (!isEmailKind(value)) {
		throw new ApiError(httpStatus.NOT_FOUND, "No such email", { messageKey: "email.notFound" })
	}

	return value
}

const localeOf = (value: unknown): LocaleCode =>
	value === "de" || value === "en" ? value : DEFAULT_LOCALE

const list: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await EmailService.list(),
	})
})

const get: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await EmailService.get(kindOf(req.params.kind)),
	})
})

const save: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("setting.saved", req.locale),
		data: await EmailService.save(kindOf(req.params.kind), req.body),
	})
})

const reset: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("setting.saved", req.locale),
		data: await EmailService.reset(kindOf(req.params.kind)),
	})
})

/**
 * The rendered message.
 *
 * Returned as data rather than served as HTML: the dashboard shows it in a
 * sandboxed iframe, and an endpoint that returned `text/html` from admin-
 * supplied content would be one someone could link to directly.
 */
const preview: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await EmailService.preview(kindOf(req.params.kind), localeOf(req.query.locale)),
	})
})

const sendTest: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("email.testSent", req.locale),
		data: await EmailService.sendTest(
			kindOf(req.params.kind),
			localeOf(req.body.locale),
			req.body.to
		),
	})
})

export const EmailController = { list, get, save, reset, preview, sendTest }
