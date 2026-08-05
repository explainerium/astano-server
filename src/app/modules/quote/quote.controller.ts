import type { Request, RequestHandler, Response } from "express"
import { env } from "../../../config"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { GUEST_BASKET_TTL_DAYS, QUOTE_BASKET_COOKIE } from "./quote.constant"
import { QuoteService, type BasketOwner } from "./quote.service"
import { clearCookieOptions, cookieOptions } from "../../../shared/cookies"

const ownerOf = (req: Request): BasketOwner => ({
	userId: req.user?.sub,
	token: req.cookies?.[QUOTE_BASKET_COOKIE] as string | undefined,
})

const syncCookie = (res: Response, token: string | null): void => {
	if (token) {
		res.cookie(QUOTE_BASKET_COOKIE, token, cookieOptions(GUEST_BASKET_TTL_DAYS * 24 * 60 * 60 * 1000))
	} else {
		res.clearCookie(QUOTE_BASKET_COOKIE, clearCookieOptions())
	}
}

const getBasket: RequestHandler = catchAsync(async (req, res) => {
	const { basket, token } = await QuoteService.getBasket(ownerOf(req), req.locale)
	syncCookie(res, token)
	sendResponse(res, { statusCode: httpStatus.OK, message: t("common.ok", req.locale), data: basket })
})

const addItem: RequestHandler = catchAsync(async (req, res) => {
	const { basket, token } = await QuoteService.addItem(ownerOf(req), req.body, req.locale)
	syncCookie(res, token)
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("quote.added", req.locale),
		data: basket,
	})
})

const updateItem: RequestHandler = catchAsync(async (req, res) => {
	const { basket, token, adjusted } = await QuoteService.updateItem(
		ownerOf(req),
		req.params.id as string,
		req.body,
		req.locale
	)
	syncCookie(res, token)
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: adjusted ? t("quote.quantityRaised", req.locale) : t("quote.updated", req.locale),
		data: basket,
	})
})

const removeItem: RequestHandler = catchAsync(async (req, res) => {
	const { basket, token } = await QuoteService.removeItem(
		ownerOf(req),
		req.params.id as string,
		req.locale
	)
	syncCookie(res, token)
	sendResponse(res, { statusCode: httpStatus.OK, message: t("quote.removed", req.locale), data: basket })
})

const clearBasket: RequestHandler = catchAsync(async (req, res) => {
	const { basket, token } = await QuoteService.clearBasket(ownerOf(req), req.locale)
	syncCookie(res, token)
	sendResponse(res, { statusCode: httpStatus.OK, message: t("quote.cleared", req.locale), data: basket })
})

const submit: RequestHandler = catchAsync(async (req, res) => {
	const user = req.user?.sub
		? await prisma.user.findUnique({ where: { id: req.user.sub } })
		: null

	const { quote, accessToken } = await QuoteService.submit(
		{
			...ownerOf(req),
			user: user
				? {
						email: user.email,
						firstName: user.firstName,
						lastName: user.lastName,
						company: user.company,
						phone: user.phone,
					}
				: undefined,
		},
		req.body,
		req.locale
	)

	// The basket is consumed, so retire the guest cookie with it.
	syncCookie(res, null)

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("quote.submitted", req.locale),
		data: {
			...quote,
			// Guests need this to reach their thread. Until the mailer exists it
			// is returned in development so the flow is testable.
			...(accessToken && env.NODE_ENV === "development" ? { accessToken } : {}),
		},
	})
})

const listMine: RequestHandler = catchAsync(async (req, res) => {
	const q = req.query as unknown as { page?: number; limit?: number }
	const result = await QuoteService.listMine(req.user!.sub, Number(q.page ?? 1), Number(q.limit ?? 20))

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: result.data,
		meta: result.meta,
	})
})

const getMine: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await QuoteService.getMine(req.user!.sub, req.params.id as string),
	})
})

/** Guest access using the token from their confirmation email. */
const getByToken: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await QuoteService.getByToken(String(req.query.token ?? "")),
	})
})

const customerReply: RequestHandler = catchAsync(async (req, res) => {
	// Confirms ownership before writing into the thread.
	await QuoteService.getMine(req.user!.sub, req.params.id as string)

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("quote.replySent", req.locale),
		data: await QuoteService.reply(req.params.id as string, req.body.body, "CUSTOMER", req.user!.sub),
	})
})

const staffReply: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("quote.replySent", req.locale),
		data: await QuoteService.reply(
			req.params.id as string,
			req.body.body,
			"STAFF",
			req.user!.sub,
			Boolean(req.body.isInternal)
		),
	})
})

const adminList: RequestHandler = catchAsync(async (req, res) => {
	const q = req.query as unknown as { status?: never; search?: string; page?: number; limit?: number }
	const result = await QuoteService.adminList({
		status: q.status,
		search: q.search,
		page: Number(q.page ?? 1),
		limit: Number(q.limit ?? 20),
	})

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: result.data,
		meta: result.meta,
	})
})

const adminGet: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await QuoteService.adminGet(req.params.id as string),
	})
})

const adminUpdate: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("quote.updatedByStaff", req.locale),
		data: await QuoteService.adminUpdate(req.params.id as string, req.body),
	})
})

export const QuoteController = {
	getBasket,
	addItem,
	updateItem,
	removeItem,
	clearBasket,
	submit,
	listMine,
	getMine,
	getByToken,
	customerReply,
	staffReply,
	adminList,
	adminGet,
	adminUpdate,
}
