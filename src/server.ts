import type { Server } from "http"
import app from "./app"
import { env } from "./config"
import { logger } from "./shared/logger"
import { InvoiceService } from "./app/modules/invoice/invoice.service"

let server: Server

const bootstrap = (): void => {
	server = app.listen(env.PORT, () => {
		logger.info(`Astano API listening on http://localhost:${env.PORT}`)
		logger.info(`Health check:  http://localhost:${env.PORT}/health`)
	})
}

const shutdown = (signal: string): void => {
	logger.info(`${signal} received — shutting down`)
	// Chromium outlives the node process unless it is told otherwise.
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
