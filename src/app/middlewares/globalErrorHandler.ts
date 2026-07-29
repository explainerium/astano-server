import type { NextFunction, Request, Response } from "express"
import httpStatus from "../../shared/httpStatus"
import { ZodError } from "zod"
import { env } from "../../config"
import { t } from "../../i18n"
import { logger } from "../../shared/logger"
import ApiError from "../errors/ApiError"

interface ErrorDetail {
	path: string
	message: string
}

export const globalErrorHandler = (
	error: unknown,
	req: Request,
	res: Response,
	_next: NextFunction
): void => {
	let statusCode: number = httpStatus.INTERNAL_SERVER_ERROR
	let message = t("common.serverError", req.locale)
	let details: ErrorDetail[] = []

	if (error instanceof ZodError) {
		statusCode = httpStatus.BAD_REQUEST
		message = t("common.validationFailed", req.locale)
		details = error.issues.map((issue) => ({
			path: issue.path.join("."),
			message: issue.message,
		}))
	} else if (error instanceof ApiError) {
		statusCode = error.statusCode
		message = error.messageKey
			? t(error.messageKey, req.locale, error.messageVars)
			: error.message
	} else if (error instanceof Error) {
		message = error.message
	}

	if (statusCode >= 500) {
		logger.error({ err: error, path: req.originalUrl }, "unhandled error")
	}

	res.status(statusCode).json({
		success: false,
		statusCode,
		message,
		...(details.length ? { details } : {}),
		...(env.NODE_ENV === "development" && error instanceof Error
			? { stack: error.stack }
			: {}),
	})
}

export default globalErrorHandler
