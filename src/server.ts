import type { Server } from "http"
import app from "./app"
import { env } from "./config"
import { logger } from "./shared/logger"
import { InvoiceService } from "./app/modules/invoice/invoice.service"
import { PaymentService } from "./app/modules/payment/payment.service"
import { TaxService } from "./app/modules/tax/tax.service"
import { startJobs, stopJobs } from "./jobs"

let server: Server

const bootstrap = (): void => {
	server = app.listen(env.PORT, () => {
		logger.info(`Astano API listening on http://localhost:${env.PORT}`)
		logger.info(`Health check:  http://localhost:${env.PORT}/health`)
		startJobs()

		/*
		 * The three offline payment kinds have to exist before the first customer
		 * reaches checkout, not merely before the first admin opens the payments
		 * screen. Checkout reads the table directly; an empty table is a checkout
		 * with nothing to pay with.
		 *
		 * Deliberately not awaited — the API is already serving, and a database
		 * hiccup here must not stop it. A failure is logged and the admin screen
		 * creates them on its next read.
		 */
		void PaymentService.ensureOfflineMethods()
			.then((created) => {
				if (created) logger.info(`Created ${created} default payment method(s)`)
			})
			.catch((error: unknown) => {
				logger.error({ err: error }, "could not ensure the default payment methods")
			})

		/*
		 * Same reasoning as the payment methods: a shop with no tax rate refuses
		 * every order, and an empty tax table is an unconfigured shop rather than
		 * a decision. Only ever fills an empty table — see ensureDefaultMatrix.
		 */
		void TaxService.ensureDefaultMatrix()
			.then((created) => {
				if (created) logger.info(`Created the default tax matrix (${created} classes)`)
			})
			.catch((error: unknown) => {
				logger.error({ err: error }, "could not ensure the default tax matrix")
			})
	})
}

const shutdown = (signal: string): void => {
	logger.info(`${signal} received — shutting down`)
	// Chromium outlives the node process unless it is told otherwise.
	stopJobs()
	void InvoiceService.closeBrowser()
	if (server) {
		server.close(() => process.exit(0))
	} else {
		process.exit(0)
	}
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

process.on("unhandledRejection", (reason) => {
	logger.error({ reason }, "unhandled rejection — shutting down")
	if (server) server.close(() => process.exit(1))
	else process.exit(1)
})

process.on("uncaughtException", (error) => {
	logger.error({ err: error }, "uncaught exception — shutting down")
	process.exit(1)
})

bootstrap()
