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

/*
 * CleverReach's webhook: somebody left the list from one of its mails.
 *
 * Public, because CleverReach is the caller — the call token in
 * `X-CR-Calltoken` is the authorisation, checked in the service. No rate
 * limit: a mailing can bring a burst of unsubscribes, and a limited one would
 * be dropped.
 *
 * GET is CleverReach checking the URL while the hook is registered, and wants
 * a plain-text echo, not the usual JSON envelope.
 */
NewsletterRoutes.get(
	"/cleverreach/hook",
	catchAsync(async (req, res) => {
		const answer = await NewsletterService.answerHookVerification(String(req.query.secret ?? ""))
		if (!answer) {
			res.status(httpStatus.NOT_FOUND).type("text/plain").send("")
			return
		}
		res.status(httpStatus.OK).type("text/plain").send(answer)
	})
)

NewsletterRoutes.post(
	"/cleverreach/hook",
	catchAsync(async (req, res) => {
		const accepted = await NewsletterService.handleCleverReachHook(req.get("x-cr-calltoken"), req.body)
		res.status(accepted ? httpStatus.OK : httpStatus.UNAUTHORIZED).type("text/plain").send("")
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

AdminNewsletterRoutes.get(
	"/counts",
	catchAsync(async (req, res) => {
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("common.ok", req.locale),
			data: await NewsletterService.counts(),
		})
	})
)

AdminNewsletterRoutes.post(
	"/:id/unsubscribe",
	writeLimiter,
	catchAsync(async (req, res) => {
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("newsletter.unsubscribed", req.locale),
			data: await NewsletterService.adminUnsubscribe(String(req.params.id)),
		})
	})
)

/*
 * CleverReach, from the settings screen: whether it is set up, a login test
 * that lists the groups, and "send what is waiting". Staff only, like the list.
 */
AdminNewsletterRoutes.get(
	"/cleverreach",
	catchAsync(async (req, res) => {
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("common.ok", req.locale),
			data: await NewsletterService.cleverReachStatus(),
		})
	})
)

AdminNewsletterRoutes.post(
	"/cleverreach/test",
	writeLimiter,
	catchAsync(async (req, res) => {
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("common.ok", req.locale),
			data: await NewsletterService.testCleverReach(),
		})
	})
)

AdminNewsletterRoutes.post(
	"/cleverreach/webhook",
	writeLimiter,
	catchAsync(async (req, res) => {
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("common.ok", req.locale),
			data: await NewsletterService.connectCleverReachHook(),
		})
	})
)

AdminNewsletterRoutes.post(
	"/cleverreach/sync",
	writeLimiter,
	catchAsync(async (req, res) => {
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("common.ok", req.locale),
			data: await NewsletterService.syncCleverReach(),
		})
	})
)

export default NewsletterRoutes
