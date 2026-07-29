import type { Request, Response } from "express"
import httpStatus from "../../shared/httpStatus"
import { t } from "../../i18n"

export const notFound = (req: Request, res: Response): void => {
	res.status(httpStatus.NOT_FOUND).json({
		success: false,
		statusCode: httpStatus.NOT_FOUND,
		message: t("route.notFound", req.locale, { path: req.originalUrl }),
	})
}

export default notFound
