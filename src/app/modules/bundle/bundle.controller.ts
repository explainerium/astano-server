import type { Request, RequestHandler, Response } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { CART_COOKIE } from "../cart/cart.constant"
import { CartService } from "../cart/cart.service"
import { BundleService } from "./bundle.service"
import { cookieOptions } from "../../../shared/cookies"

const ownerOf = (req: Request) => ({
	userId: req.user?.sub,
	token: req.cookies?.[CART_COOKIE] as string | undefined,
	role: req.user?.role,
	status: req.user?.status,
})

const syncCookie = (res: Response, token: string | null): void => {
	if (token) {
		res.cookie(CART_COOKIE, token, cookieOptions(30 * 24 * 60 * 60 * 1000))
	}
}

/** Live repricing while the customer ticks options. */
const price: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		// userId as well as role: a customer ladder is negotiated with a person,
		// so without it the configurator quotes the catalogue price to a dealer
		// the cart then charges the agreed one.
		data: await BundleService.price(
			{ userId: req.user?.sub, role: req.user?.role, status: req.user?.status },
			req.body,
			req.locale
		),
	})
})

/** Adds the whole configuration to the cart, all lines or none. */
const addToCart: RequestHandler = catchAsync(async (req, res) => {
	const owner = ownerOf(req)

	// Reuse the cart module's ownership logic so guest tokens, merging and
	// expiry all behave identically to a normal add-to-cart.
	const { cart, token } = await CartService.get(owner, req.locale)
	syncCookie(res, token)

	await BundleService.addToCart(
		{ userId: owner.userId, cartId: cart.id },
		{ userId: owner.userId, role: owner.role, status: owner.status },
		req.body,
		req.locale
	)

	const refreshed = await CartService.get(owner, req.locale)

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("bundle.added", req.locale),
		data: refreshed.cart,
	})
})

export const BundleController = { price, addToCart }
