import { Router } from "express"
import rateLimit from "express-rate-limit"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { B2bService } from "./b2bApplication.service"
import { B2bValidation } from "./b2bApplication.validation"

/** Registration creates an account, so it is throttled like any credential endpoint. */
const applyLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	limit: 5,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	message: {
		success: false,
		statusCode: 429,
		message: "Too many applications from this address. Please try again later.",
	},
})

export const B2bRoutes = Router()

/** Public dealer registration. */
B2bRoutes.post(
	"/apply",
	applyLimiter,
	validateRequest(B2bValidation.applySchema),
	catchAsync(async (req, res) => {
		sendResponse(res, {
			statusCode: httpStatus.CREATED,
			message: t("b2b.submitted", req.locale),
			data: await B2bService.apply(req.body, req.locale),
		})
	})
)

/** Staff review queue. */
export const AdminB2bRoutes = Router()

AdminB2bRoutes.use(auth("ADMIN", "SHOP_MANAGER"))

AdminB2bRoutes.get(
	"/",
	validateRequest(B2bValidation.listSchema),
	catchAsync(async (req, res) => {
		const q = req.query as unknown as {
			status?: never
			search?: string
			page?: number
			limit?: number
		}

		const result = await B2bService.list({
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
)

AdminB2bRoutes.get(
	"/:id",
	validateRequest(B2bValidation.idSchema),
	catchAsync(async (req, res) => {
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("common.ok", req.locale),
			data: await B2bService.getById(req.params.id as string),
		})
	})
)

AdminB2bRoutes.patch(
	"/:id/decision",
	validateRequest(B2bValidation.decisionSchema),
	catchAsync(async (req, res) => {
		const result = await B2bService.decide(req.params.id as string, req.body, req.user!.sub)

		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: req.body.approve
				? t("b2b.approved", req.locale)
				: t("b2b.rejected", req.locale),
			data: result,
		})
	})
)

export default B2bRoutes
