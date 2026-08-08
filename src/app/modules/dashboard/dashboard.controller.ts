import type { RequestHandler } from "express"
import { httpStatus } from "../../../shared/httpStatus"
import catchAsync from "../../../shared/catchAsync"
import sendResponse from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { DashboardService } from "./dashboard.service"

const summary: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await DashboardService.summary({
			days: Number(req.query.days ?? 7),
			locale: req.locale,
		}),
	})
})

export const DashboardController = { summary }
