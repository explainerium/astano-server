import cron, { type ScheduledTask } from "node-cron"
import { env } from "../config"
import { logger } from "../shared/logger"
import { prisma } from "../shared/prisma"
import { QuoteService } from "../app/modules/quote/quote.service"

/**
 * Scheduled maintenance.
 *
 * Two of these carry business rules the old shop also had as cron jobs: quote
 * expiry, and sweeping abandoned baskets. The rest is housekeeping that keeps
 * the database from growing forever.
 *
 * Every job logs what it did — a job that silently does nothing is
 * indistinguishable from a job that is not running.
 */

/** Wraps a job so one failure cannot take the process down. */
const safely = (name: string, job: () => Promise<string>) => async (): Promise<void> => {
	const started = Date.now()
	try {
		const summary = await job()
		logger.info({ job: name, ms: Date.now() - started }, summary)
	} catch (error) {
		logger.error({ err: error, job: name }, `job ${name} failed`)
	}
}

/**
 * A quoted price is an offer with a shelf life. Once past `expiresAt` it must
 * stop being presented as current, or a customer accepts a price the shop no
 * longer honours.
 */
const expireQuotes = safely("expire-quotes", async () => {
	const count = await QuoteService.expireOverdue()
	return `expired ${count} quote request(s)`
})

/** Anonymous carts accumulate forever otherwise — one per visitor who never returns. */
const sweepGuestCarts = safely("sweep-guest-carts", async () => {
	const { count } = await prisma.cart.deleteMany({
		where: { userId: null, expiresAt: { not: null, lt: new Date() } },
	})
	return `removed ${count} abandoned guest cart(s)`
})

const sweepGuestQuoteBaskets = safely("sweep-guest-quote-baskets", async () => {
	const { count } = await prisma.quoteBasket.deleteMany({
		where: { userId: null, expiresAt: { not: null, lt: new Date() } },
	})
	return `removed ${count} abandoned inquiry basket(s)`
})

/**
 * Expired and revoked tokens are dead weight. Refresh tokens especially: one
 * row per device per login, and nothing ever removed them.
 */
const sweepTokens = safely("sweep-tokens", async () => {
	const now = new Date()

	const [refresh, reset] = await Promise.all([
		prisma.refreshToken.deleteMany({
			OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null, lt: new Date(now.getTime() - 30 * 864e5) } }],
		} as never),
		prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
	])

	return `removed ${refresh.count} refresh token(s) and ${reset.count} reset token(s)`
})

/** Every schedule in one place, so what runs when is readable at a glance. */
const SCHEDULE = [
	{ name: "expire-quotes", cron: "0 * * * *", run: expireQuotes },
	{ name: "sweep-guest-carts", cron: "30 3 * * *", run: sweepGuestCarts },
	{ name: "sweep-guest-quote-baskets", cron: "35 3 * * *", run: sweepGuestQuoteBaskets },
	{ name: "sweep-tokens", cron: "40 3 * * *", run: sweepTokens },
] as const

const tasks: ScheduledTask[] = []

export const startJobs = (): void => {
	// Tests and one-off scripts should not spawn timers.
	if (env.NODE_ENV === "test") return

	for (const entry of SCHEDULE) {
		tasks.push(cron.schedule(entry.cron, entry.run))
		logger.info({ job: entry.name, cron: entry.cron }, "scheduled")
	}
}

export const stopJobs = (): void => {
	for (const task of tasks) void task.stop()
	tasks.length = 0
}

/** Exposed so an admin can run one on demand rather than waiting for the clock. */
export const JOBS = {
	"expire-quotes": expireQuotes,
	"sweep-guest-carts": sweepGuestCarts,
	"sweep-guest-quote-baskets": sweepGuestQuoteBaskets,
	"sweep-tokens": sweepTokens,
} as const

export type JobName = keyof typeof JOBS
