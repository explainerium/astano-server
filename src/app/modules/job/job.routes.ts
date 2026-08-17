import crypto from "crypto"
import { Router, type RequestHandler } from "express"
import { z } from "zod"
import { env } from "../../../config"
import { JOBS, type JobName } from "../../../jobs"
import ApiError from "../../errors/ApiError"
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

/**
 * The same jobs, run by a scheduler over HTTP instead of by the clock.
 *
 * `node-cron` needs a process that stays alive. A serverless deployment has
 * none — so on Vercel the schedule lives in `vercel.json` and calls this, and
 * `startJobs()` never runs at all. On Render or the VPS the in-process timers
 * do the work and this route simply sits unused.
 *
 * Not behind `auth()`: the caller is a scheduler, not a person, and it holds no
 * session. `CRON_SECRET` is the whole of its identity, compared in constant
 * time — a shared secret checked with `===` leaks its length and prefix to
 * anybody willing to measure.
 *
 * With no secret configured the route refuses everything rather than running
 * open. A deployment that does not schedule over HTTP should not have an
 * unauthenticated way to delete rows.
 */
export const CronJobRoutes = Router()

const authorised = (header: string | undefined): boolean => {
	const secret = env.CRON_SECRET
	if (!secret) return false

	const offered = header?.startsWith("Bearer ") ? header.slice(7) : ""
	const a = Buffer.from(offered)
	const b = Buffer.from(secret)

	// timingSafeEqual throws on a length mismatch, so that is checked first —
	// and the lengths of two secrets are not themselves worth hiding.
	return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Runs every job, in the order the in-process schedule runs them.
 *
 * One endpoint rather than one per job, because Vercel's free plan allows two
 * cron entries and there are five jobs. They are all idempotent and all cheap
 * when there is nothing to do, so running the set together costs little and
 * removes any question of which ones a schedule forgot.
 */
const runAll: RequestHandler = catchAsync(async (req, res) => {
	if (!authorised(req.headers.authorization)) {
		throw new ApiError(httpStatus.UNAUTHORIZED, "Not authorised", {
			messageKey: "auth.required",
		})
	}

	// `safely` wraps each one, so a single failure is logged and the rest still
	// run — the whole point of a maintenance sweep.
	for (const run of Object.values(JOBS)) await run()

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: { ran: Object.keys(JOBS), at: new Date().toISOString() },
	})
})

/*
 * GET, because that is what Vercel Cron sends — it invokes the path and has no
 * way to be told otherwise. POST is kept alongside it so the same endpoint can
 * be driven by hand, or by a scheduler with better manners, without the
 * secret-checking logic existing twice.
 */
CronJobRoutes.get("/run", runAll)
CronJobRoutes.post("/run", runAll)

export default AdminJobRoutes
