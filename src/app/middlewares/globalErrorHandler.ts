import type { NextFunction, Request, Response } from "express"
import { ZodError } from "zod"
import { env } from "../../config"
import { t } from "../../i18n"
import { httpStatus } from "../../shared/httpStatus"
import { logger } from "../../shared/logger"
import ApiError from "../errors/ApiError"
import { MAX_FILE_BYTES, megabytes } from "../modules/media/media.constant"
import { translatePrismaError } from "../errors/prismaError"

interface ErrorDetail {
	path: string
	message: string
}

/**
 * multer's own size refusal.
 *
 * Matched by shape rather than with `instanceof MulterError`, so this file does
 * not have to import multer to describe what one of its errors looks like.
 */
const isFileTooLarge = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	(error as { code?: unknown }).code === "LIMIT_FILE_SIZE"

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
	} else if (isFileTooLarge(error)) {
		/*
		 * multer aborts an oversized upload while it is still streaming, so the
		 * service that would have said "too large" never runs. Without this the
		 * customer is told the server broke, which is both untrue and unhelpful:
		 * the file is too big and they can do something about that.
		 */
		statusCode = httpStatus.PAYLOAD_TOO_LARGE
		message = t("media.tooLarge", req.locale, { limit: megabytes(MAX_FILE_BYTES) })
	} else {
		const prisma = translatePrismaError(error)

		if (prisma) {
			statusCode = prisma.statusCode
			const translated = t(prisma.messageKey, req.locale, prisma.messageVars)
			// Fall back to the English sentence if the key is not in the catalog,
			// rather than showing the reader a raw key.
			message = translated === prisma.messageKey ? prisma.fallback : translated
		}
		// Anything else keeps the generic message. Raw error text is never sent:
		// it leaks file paths and internals, and tells the reader nothing they
		// can act on. The full error goes to the log instead.
	}

	if (statusCode >= 500) {
		logger.error({ err: error, path: req.originalUrl }, "unhandled error")
	} else if (env.NODE_ENV === "development") {
		logger.warn({ err: error, path: req.originalUrl }, "request failed")
	}

	res.status(statusCode).json({
		success: false,
		statusCode,
		message,
		...(details.length ? { details } : {}),
		// Stack traces are a development aid only, and never for 4xx — those are
		// expected outcomes, not faults.
		...(env.NODE_ENV === "development" && statusCode >= 500 && error instanceof Error
			? { stack: error.stack }
			: {}),
	})
}

export default globalErrorHandler
