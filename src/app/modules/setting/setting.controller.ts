import type { RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { SettingService } from "./setting.service"

/** Everything, staff only. */
const list: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: {
			settings: await SettingService.getAll(),
			known: SettingService.KNOWN_SETTINGS,
		},
	})
})

/** Only the ones flagged public — shop name, support address. */
const listPublic: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await SettingService.getAll({ publicOnly: true }),
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

export const SettingController = { list, listPublic, upsert, remove }
