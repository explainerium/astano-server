import type { Request, RequestHandler, Response } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { CART_COOKIE, GUEST_CART_TTL_DAYS } from "./cart.constant"
import { CartService, type CartOwner } from "./cart.service"
import { clearCookieOptions, cookieOptions } from "../../../shared/cookies"

const ownerOf = (req: Request): CartOwner => ({
	userId: req.user?.sub,
	token: req.cookies?.[CART_COOKIE] as string | undefined,
	role: req.user?.role,
	status: req.user?.status,
})

/**
 * Anonymous carts are addressed by an httpOnly cookie. Once the visitor signs
 * in the cart is claimed and the cookie cleared, so the token cannot be reused
 * to reach someone's basket later.
 */
const syncCookie = (res: Response, token: string | null): void => {
	if (token) {
		res.cookie(CART_COOKIE, token, cookieOptions(GUEST_CART_TTL_DAYS * 24 * 60 * 60 * 1000))
	} else {
		res.clearCookie(CART_COOKIE, clearCookieOptions())
	}
}

const get: RequestHandler = catchAsync(async (req, res) => {
	const { cart, token } = await CartService.get(ownerOf(req), req.locale)
	syncCookie(res, token)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: cart,
	})
})

const addItem: RequestHandler = catchAsync(async (req, res) => {
	const { cart, token } = await CartService.addItem(ownerOf(req), req.body, req.locale)
	syncCookie(res, token)

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("cart.added", req.locale),
		data: cart,
	})
})

const updateItem: RequestHandler = catchAsync(async (req, res) => {
	const { cart, token, adjusted } = await CartService.updateItem(
		ownerOf(req),
		req.params.id as string,
		req.body.quantity,
		req.locale
	)
	syncCookie(res, token)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		// R4: when the quantity was raised to the minimum, say so rather than
		// letting the number change silently under the customer.
		message: adjusted ? t("cart.quantityRaised", req.locale) : t("cart.updated", req.locale),
		data: cart,
	})
})

const removeItem: RequestHandler = catchAsync(async (req, res) => {
	const { cart, token } = await CartService.removeItem(
		ownerOf(req),
		req.params.id as string,
		req.locale
	)
	syncCookie(res, token)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("cart.removed", req.locale),
		data: cart,
	})
})

const clear: RequestHandler = catchAsync(async (req, res) => {
	const { cart, token } = await CartService.clear(ownerOf(req), req.locale)
	syncCookie(res, token)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("cart.cleared", req.locale),
		data: cart,
	})
})

export const CartController = { get, addItem, updateItem, removeItem, clear }
