import pino from "pino"
import { env } from "../config"

/**
 * Structured logging. You must be able to answer "what price did we quote this
 * customer at 14:03?" — console.log will not survive a B2B pricing dispute.
 */
export const logger = pino({
	level: env.LOG_LEVEL,
	...(env.NODE_ENV === "development"
		? {
				transport: {
					target: "pino-pretty",
					options: {
						colorize: true,
						translateTime: "HH:MM:ss",
						// responseTime is already inside the message text.
						ignore: "pid,hostname,responseTime",
						singleLine: true,
					},
				},
			}
		: {}),
})

export default logger
