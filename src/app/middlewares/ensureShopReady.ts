import type { NextFunction, Request, Response } from "express"
import { logger } from "../../shared/logger"
import { PaymentService } from "../modules/payment/payment.service"
import { TaxService } from "../modules/tax/tax.service"

/**
 * The two things a shop cannot serve a checkout without, made certain before
 * the first request is answered.
 *
 * On a long-running deployment these run once at boot, from `server.ts`. A
 * serverless deployment has no boot — `app.listen` is never called, so nothing
 * in that file executes and a cold Vercel instance would answer its first
 * checkout with **no payment methods and no tax rate**. The first is a checkout
 * with nothing to pay with; the second refuses every order outright, because an
 * unconfigured tax matrix is treated as an accident rather than a decision.
 *
 * Both operations only ever fill an empty table, so running them again costs
 * one count query and changes nothing.
 *
 * The promise is cached per instance rather than per request: a cold start that
 * receives ten requests at once must not run the seeding ten times. Failure is
 * logged and cleared, so the next request tries again rather than the instance
 * remembering a database hiccup forever — and it is never thrown, because a
 * seeding problem should not take down a request that had nothing to do with
 * payment or tax.
 */
let ready: Promise<void> | null = null

const seed = async (): Promise<void> => {
	const [methods, taxes] = await Promise.all([
		PaymentService.ensureOfflineMethods(),
		TaxService.ensureDefaultMatrix(),
	])

	if (methods) logger.info(`Created ${methods} default payment method(s)`)
	if (taxes) logger.info(`Created the default tax matrix (${taxes} classes)`)
}

export const ensureShopReady = (_req: Request, _res: Response, next: NextFunction): void => {
	ready ??= seed().catch((error: unknown) => {
		logger.error({ err: error }, "could not ensure the shop's payment and tax defaults")
		ready = null
	})

	/*
	 * Deliberately not awaited.
	 *
	 * Holding every request until the seeding finishes would put a database
	 * round trip in front of the health check and every product page, to fix a
	 * table that is empty exactly once in the life of a shop. The work starts on
	 * the first request and the handful that arrive during it read a table that
	 * was already correct on every deployment after the first.
	 */
	next()
}

export default ensureShopReady
