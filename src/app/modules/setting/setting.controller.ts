import type { RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { SettingService } from "./setting.service"
import { sendTestMail } from "./settingMailTest"

/** Everything, staff only. */
const list: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: {
			settings: await SettingService.getAll(),
			// The registry, so the screen renders each setting as the control it
			// deserves instead of a text box holding "true".
			definitions: SettingService.SETTINGS,
			groups: SettingService.SETTING_GROUPS,
			// The menu's sections, in order. Sent rather than hardcoded on the
			// screen, so moving a group between them is one edit here.
			sections: SettingService.SETTING_SECTIONS,
		},
	})
})

/**
 * What the storefront needs before it can render a price.
 *
 * Resolved with fallbacks rather than returning only what happens to be stored
 * — a shop nobody has configured must still format money, not print NaN.
 */
const listPublic: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await SettingService.getPublic(),
	})
})

const upsert: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("setting.saved", req.locale),
		data: await SettingService.setMany(req.body.settings),
	})
})

const remove: RequestHandler = catchAsync(async (req, res) => {
	await SettingService.remove(req.params.key as string)
	sendResponse(res, { statusCode: httpStatus.OK, message: t("setting.deleted", req.locale) })
})

/**
 * Sends one real message through the configured server and reports what
 * happened.
 *
 * Answers with 200 either way, the outcome in the body. A failed delivery is
 * not a failed request — the admin asked whether the mail server works and got
 * a truthful answer, which is the endpoint doing its job. Returning 500 would
 * also hand the screen a generic error page in place of "535 authentication
 * failed", which is the one thing worth reading.
 */
const testMail: RequestHandler = catchAsync(async (req, res) => {
	const result = await sendTestMail(req.body.to as string, req.locale)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t(result.ok ? "setting.mailTestSent" : "setting.mailTestFailed", req.locale),
		data: result,
	})
})

export const SettingController = { list, listPublic, upsert, remove, testMail }
