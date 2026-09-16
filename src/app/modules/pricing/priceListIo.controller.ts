import type { RequestHandler } from "express"
import { decodeCsvBuffer } from "../../../domain/pricing/priceList"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import ApiError from "../../errors/ApiError"
import { PriceListIoService } from "./priceListIo.service"

/**
 * The uploaded price list, as text.
 *
 * Unlike the product importer, a file that is not UTF-8 is read rather than
 * refused: this one comes straight out of the ERP, which writes Windows-1252,
 * and telling the client to re-save a 12,899-row export before every import is
 * a chore that would eventually be skipped.
 */
const readUpload = (file: Express.Multer.File | undefined): string => {
	if (!file) {
		throw new ApiError(httpStatus.BAD_REQUEST, "No file was uploaded", {
			messageKey: "priceList.noFile",
		})
	}

	return decodeCsvBuffer(file.buffer).text
}

const analyse: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PriceListIoService.analyse(readUpload(req.file), req.body.delimiter || undefined),
	})
})

const run: RequestHandler = catchAsync(async (req, res) => {
	const report = await PriceListIoService.runImport(readUpload(req.file), {
		delimiter: req.body.delimiter || undefined,
		dryRun: req.body.dryRun === "true" || req.body.dryRun === true,
	})

	const count = Object.values(report.laddersWritten).reduce((sum, n) => sum + n, 0)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t(report.dryRun ? "priceList.previewed" : "priceList.imported", req.locale, {
			count,
		}),
		data: report,
	})
})

export const PriceListIoController = { analyse, run }
