import type { RequestHandler } from "express"
import type { GenerateInput, TranslateInput } from "../../../domain/ai/prompt"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { AiService } from "./ai.service"

/** Whether the editors should offer the button at all. Carries no key. */
const status: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await AiService.status(),
	})
})

const generate: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("ai.generated", req.locale),
		data: await AiService.generate(req.body as GenerateInput),
	})
})

/** One field, in the other language. */
const translate: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("ai.translated", req.locale),
		data: await AiService.translate(req.body as TranslateInput),
	})
})

/**
 * Deliberately 200 even when the provider refused.
 *
 * The answer to "is this key any good" is the provider's sentence either way;
 * an error status would send the dashboard down its generic failure path and
 * replace "You exceeded your current quota" with "Something went wrong".
 */
const test: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await AiService.test(),
	})
})

export const AiController = { status, generate, translate, test }
