import { Router } from "express"
import { z } from "zod"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { auth } from "../../middlewares/auth"
import { writeLimiter } from "../../middlewares/rateLimiter"
import { validateRequest } from "../../middlewares/validateRequest"
import { NewsletterService } from "./newsletter.service"

export const NewsletterRoutes = Router()

NewsletterRoutes.post(
	"/subscribe",
	writeLimiter,
	validateRequest(
		z.object({
			body: z.object({
				email: z.string().trim().toLowerCase().email(),
				name: z.string().trim().max(160).optional(),
				source: z.string().trim().max(60).optional(),
			}),
		})
	),
	catchAsync(async (req, res) => {
		await NewsletterService.subscribe(req.body, req.locale)

		// Identical response whether the address is new, pending or already
		// confirmed — whether someone is on a mailing list is not for a stranger
		// to discover by typing their address into a form.
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("newsletter.checkYourEmail", req.locale),
		})
	})
)

NewsletterRoutes.get(
	"/confirm",
	catchAsync(async (req, res) => {
		await NewsletterService.confirm(String(req.query.token ?? ""))
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("newsletter.confirmed", req.locale),
		})
	})
)

NewsletterRoutes.get(
	"/unsubscribe",
	catchAsync(async (req, res) => {
		await NewsletterService.unsubscribe(String(req.query.token ?? ""))
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("newsletter.unsubscribed", req.locale),
		})
	})
)

export const AdminNewsletterRoutes = Router()

AdminNewsletterRoutes.use(auth("ADMIN", "SHOP_MANAGER"))

AdminNewsletterRoutes.get(
	"/",
	catchAsync(async (req, res) => {
		const q = req.query as { status?: string; page?: string; limit?: string }

		const result = await NewsletterService.list({
			status: q.status,
			page: Number(q.page ?? 1),
			limit: Number(q.limit ?? 50),
		})

		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("common.ok", req.locale),
			data: result.data,
			meta: result.meta,
		})
	})
)

export default NewsletterRoutes
