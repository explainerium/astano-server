import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { env } from "../../../config"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { optionalAuth } from "../../middlewares/optionalAuth"
import { validateRequest } from "../../middlewares/validateRequest"
import { WishlistService, type Owner } from "./wishlist.service"

const WISHLIST_COOKIE = "astano_wishlist"
const TTL_DAYS = 180

const ownerOf = (req: Request): Owner => ({
	userId: req.user?.sub,
	token: req.cookies?.[WISHLIST_COOKIE] as string | undefined,
	role: req.user?.role,
	status: req.user?.status,
})

const syncCookie = (res: Response, token: string | null): void => {
	if (token) {
		res.cookie(WISHLIST_COOKIE, token, {
			httpOnly: true,
			secure: env.NODE_ENV === "production",
			sameSite: "lax",
			maxAge: TTL_DAYS * 24 * 60 * 60 * 1000,
			path: "/",
		})
	} else {
		res.clearCookie(WISHLIST_COOKIE, { path: "/" })
	}
}

/**
 * Guests may keep a wishlist — the old shop allowed it too
 * (`wishlist_logged = 0`), and losing someone's list at the moment they
 * register is a poor way to welcome them.
 */
const router = Router()

router.use(optionalAuth)

router.get(
	"/",
	catchAsync(async (req, res) => {
		const { list, token } = await WishlistService.get(ownerOf(req), req.locale)
		syncCookie(res, token)
		sendResponse(res, { statusCode: httpStatus.OK, message: t("common.ok", req.locale), data: list })
	})
)

router.post(
	"/items",
	validateRequest(z.object({ body: z.object({ variantId: z.string().uuid() }) })),
	catchAsync(async (req, res) => {
		const { list, token } = await WishlistService.add(ownerOf(req), req.body.variantId, req.locale)
		syncCookie(res, token)
		sendResponse(res, {
			statusCode: httpStatus.CREATED,
			message: t("wishlist.added", req.locale),
			data: list,
		})
	})
)

router.delete(
	"/items/:variantId",
	validateRequest(z.object({ params: z.object({ variantId: z.string().uuid() }) })),
	catchAsync(async (req, res) => {
		const { list, token } = await WishlistService.remove(
			ownerOf(req),
			req.params.variantId as string,
			req.locale
		)
		syncCookie(res, token)
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("wishlist.removed", req.locale),
			data: list,
		})
	})
)

router.delete(
	"/",
	catchAsync(async (req, res) => {
		const { list, token } = await WishlistService.clear(ownerOf(req), req.locale)
		syncCookie(res, token)
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("wishlist.cleared", req.locale),
			data: list,
		})
	})
)

export const WishlistRoutes = router
export default router
