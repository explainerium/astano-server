import type { RequestHandler } from "express"
import { DEFAULT_LOCALE, LOCALES, type LocaleCode } from "../../../config/locales"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { ContentService } from "./content.service"

const isLocale = (value: unknown): value is LocaleCode =>
	typeof value === "string" && LOCALES.some((l) => l.code === value)

/**
 * The overrides for one language. Public, and read on every storefront request.
 *
 * `?locale=` rather than the request's own language, because the caller here is
 * the storefront's own message loader and it knows which catalogue it is about
 * to build. An unknown or missing value falls back to the default locale rather
 * than erroring: this endpoint feeding a page must never be the reason a page
 * fails to render.
 */
const listPublic: RequestHandler = catchAsync(async (req, res) => {
	const asked = (req.query as { locale?: string }).locale

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await ContentService.publicContent(isLocale(asked) ? asked : DEFAULT_LOCALE),
	})
})

/** Both languages, plus the registry the screen renders itself from. */
const list: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await ContentService.adminContent(),
	})
})

const save: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("content.saved", req.locale),
		// `sub` is the user id — the guard has already refused anyone but an ADMIN,
		// so this is the person the audit column is for.
		data: await ContentService.setMany(req.body, req.user?.sub),
	})
})

/**
 * One long document, or null where the shop has never edited it.
 *
 * Null is a 200, not a 404: "we have no override for this" is the ordinary
 * answer, and the storefront responds by rendering the copy it shipped with.
 * A 404 would make an expected state look like a missing page.
 */
const readPage: RequestHandler = catchAsync(async (req, res) => {
	const asked = (req.query as { locale?: string }).locale

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await ContentService.publicPage(
			req.params.slug as string,
			isLocale(asked) ? asked : DEFAULT_LOCALE
		),
	})
})

const listPages: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await ContentService.adminPages(),
	})
})

const savePages: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("content.saved", req.locale),
		data: await ContentService.setPages(req.body, req.user?.sub),
	})
})

export const ContentController = {
	listPublic,
	list,
	save,
	readPage,
	listPages,
	savePages,
}
