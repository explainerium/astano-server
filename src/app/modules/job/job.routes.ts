import { Router } from "express"
import { z } from "zod"
import { JOBS, type JobName } from "../../../jobs"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { auth } from "../../middlewares/auth"
import { writeLimiter } from "../../middlewares/rateLimiter"
import { validateRequest } from "../../middlewares/validateRequest"

/**
 * Running a scheduled job on demand.
 *
 * `jobs/index.ts` has always exported `JOBS` with a comment saying it exists so
 * an admin can run one "rather than waiting for the clock", and nothing ever
 * called it. That mattered more than dead code usually does: the API sleeps
 * after fifteen idle minutes on the free tier, and `node-cron` in a sleeping
 * process fires nothing at all. Quote expiry, the basket sweeps and the upload
 * sweep run only when the shop happens to be awake at 3am, which on a quiet
 * shop is never.
 *
 * ADMIN only, not SHOP_MANAGER. These delete rows and objects; that is a
 * different kind of decision from approving a dealer.
 */
export const AdminJobRoutes = Router()

AdminJobRoutes.use(auth("ADMIN"))

const runSchema = z.object({
	params: z.object({
		// Constrained to the registry rather than to a string, so a typo is a 400
		// naming the jobs that exist rather than a silent no-op.
		name: z.enum(Object.keys(JOBS) as [JobName, ...JobName[]]),
	}),
})

/** What can be run, so the dashboard does not have to hardcode the list. */
AdminJobRoutes.get(
	"/",
	catchAsync(async (req, res) => {
		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("common.ok", req.locale),
			data: { jobs: Object.keys(JOBS) },
		})
	})
)

/**
 * Rate limited, and deliberately not awaited into a long response.
 *
 * Every job already wraps itself in `safely`, so a failure is logged and never
 * thrown — the answer here is "it ran", and what it did is in the log. Sweeps
 * are bounded and idempotent, so pressing the button twice costs a second run
 * and nothing else.
 */
AdminJobRoutes.post(
	"/:name/run",
	writeLimiter,
	validateRequest(runSchema),
	catchAsync(async (req, res) => {
		const name = req.params.name as JobName

		await JOBS[name]()

		sendResponse(res, {
			statusCode: httpStatus.OK,
			message: t("common.ok", req.locale),
			data: { job: name, ranAt: new Date().toISOString() },
		})
	})
)

export default AdminJobRoutes
