import { Router } from "express"
import { z } from "zod"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { OrderService } from "../order/order.service"
import { convertQuoteToOrder } from "./quoteToOrder"

const address = z.object({
	firstName: z.string().trim().min(1).max(100),
	lastName: z.string().trim().min(1).max(100),
	company: z.string().trim().max(200).nullable().optional(),
	street1: z.string().trim().min(1).max(200),
	street2: z.string().trim().max(200).nullable().optional(),
	city: z.string().trim().min(1).max(120),
	state: z.string().trim().max(120).nullable().optional(),
	postcode: z.string().trim().min(1).max(30),
	countryCode: z.string().trim().toUpperCase().length(2),
	phone: z.string().trim().max(50).nullable().optional(),
	email: z.string().trim().toLowerCase().email().nullable().optional(),
})

const schema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		billingAddress: address,
		shippingAddress: address.optional(),
		paymentMethodId: z.string().uuid(),
		customerNote: z.string().trim().max(2000).optional(),
	}),
})

const router = Router()

/**
 * Accept a quote and turn it into an order.
 *
 * Charges the QUOTED prices, not today's catalogue prices — a quote is an offer
 * the shop made in writing, and honouring it is the point.
 */
router.post(
	"/:id/accept",
	auth(),
	validateRequest(schema),
	catchAsync(async (req, res) => {
		const orderId = await convertQuoteToOrder({
			quoteId: req.params.id as string,
			userId: req.user!.sub,
			locale: req.locale,
			billingAddress: req.body.billingAddress,
			shippingAddress: req.body.shippingAddress,
			paymentMethodId: req.body.paymentMethodId,
			customerNote: req.body.customerNote,
		})

		sendResponse(res, {
			statusCode: httpStatus.CREATED,
			message: t("quote.converted", req.locale),
			data: await OrderService.getMine(req.user!.sub, orderId),
		})
	})
)

export const QuoteConvertRoutes = router
export default router
