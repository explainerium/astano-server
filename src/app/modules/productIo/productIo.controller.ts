import type { RequestHandler } from "express"
import { decodeCsvBuffer } from "../../../domain/pricing/priceList"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import ApiError from "../../errors/ApiError"
import { ProductIoService } from "./productIo.service"

/**
 * The uploaded file, as text.
 *
 * A Windows-1252 export of a German catalogue decodes as UTF-8 without
 * throwing and turns every ü into a replacement character, which would then be
 * written into the catalogue as a product name. That used to be refused; it is
 * now read, because the file that matters most here comes straight out of the
 * client's ERP in exactly that encoding, and "re-save it as UTF-8 first" is a
 * step that gets skipped.
 */
const readUpload = (file: Express.Multer.File | undefined): string => {
	if (!file) {
		throw new ApiError(httpStatus.BAD_REQUEST, "No file was uploaded", {
			messageKey: "productIo.noFile",
		})
	}

	return decodeCsvBuffer(file.buffer).text
}

/** Header names and a suggested mapping, so the admin can correct it. */
const analyse: RequestHandler = catchAsync(async (req, res) => {
	const csv = readUpload(req.file)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: ProductIoService.analyse(csv, req.body.delimiter || undefined),
	})
})

/**
 * Runs the import.
 *
 * The mapping and options arrive as JSON strings beside the file — multipart
 * carries text, not objects, so a form cannot post them any other way.
 */
const run: RequestHandler = catchAsync(async (req, res) => {
	const csv = readUpload(req.file)

	const parseJson = <T>(value: unknown, fallback: T): T => {
		if (typeof value !== "string" || !value.trim()) return fallback
		try {
			return JSON.parse(value) as T
		} catch {
			throw new ApiError(httpStatus.BAD_REQUEST, "The import settings could not be read", {
				messageKey: "productIo.badSettings",
			})
		}
	}

	const report = await ProductIoService.runImport(csv, {
		mapping: parseJson<Record<string, string>>(req.body.mapping, {}),
		delimiter: req.body.delimiter || undefined,
		dryRun: req.body.dryRun === "true" || req.body.dryRun === true,
		options: parseJson(req.body.options, {}),
		locale: req.locale,
		createdById: req.user?.sub,
	})

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t(report.dryRun ? "productIo.previewed" : "productIo.imported", req.locale, {
			count: report.created + report.updated,
		}),
		data: report,
	})
})

/**
 * The catalogue as a file.
 *
 * Streamed as a download rather than through the JSON envelope: a browser
 * saving a file needs the headers, and wrapping a CSV in JSON would mean the
 * client rebuilding it before it could be saved.
 */
const exportCsv: RequestHandler = catchAsync(async (req, res) => {
	const csv = await ProductIoService.exportCsv(req.locale)

	const stamp = new Date().toISOString().slice(0, 10)

	res.setHeader("Content-Type", "text/csv; charset=utf-8")
	res.setHeader("Content-Disposition", `attachment; filename="astano-products-${stamp}.csv"`)
	res.send(csv)
})

export const ProductIoController = { analyse, run, exportCsv }
