import { Router } from "express"
import { z } from "zod"
import { validateVatNumber } from "../../../helpers/vies"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { auth } from "../../middlewares/auth"
import { externalLimiter } from "../../middlewares/rateLimiter"
import { validateRequest } from "../../middlewares/validateRequest"

const schema = z.object({
	body: z.object({ vatNumber: z.string().trim().min(4).max(40) }),
})

const router = Router()

/**
 * Validates a VAT number against VIES and records the outcome on the account.
 *
 * The result is stored rather than checked at checkout time, because VIES is
 * slow and occasionally down — a customer must not be unable to pay because a
 * European web service is having a bad afternoon. Validation fails closed: an
 * unreachable VIES leaves the account unvalidated and full tax is charged.
 */
router.post(
	"/validate",
	auth(),
	externalLimiter,
	validateRequest(schema),
	catchAsync(async (req, res) => {
		const result = await validateVatNumber(req.body.vatNumber)

		await prisma.user.update({
			where: { id: req.user!.sub },
			data: {
				vatNumber: req.body.vatNumber,
				vatValidated: result.valid,
				vatValidatedAt: result.valid ? new Date() : null,
			},
		})

		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: result.valid
				? t("vat.validated", req.locale)
				: t(`vat.${(result.reason ?? "NOT_FOUND").toLowerCase()}`, req.locale),
			data: {
				valid: result.valid,
				countryCode: result.countryCode,
				name: result.name ?? null,
				address: result.address ?? null,
				reason: result.reason ?? null,
				checkedRemotely: result.checkedRemotely,
			},
		})
	})
)

export const VatRoutes = router
export default router
