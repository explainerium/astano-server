/**
 * Application error carrying an HTTP status and, optionally, a translation key
 * so the message can be rendered in the caller's locale by the global handler.
 */
class ApiError extends Error {
	statusCode: number
	messageKey?: string
	messageVars?: Record<string, string | number>

	constructor(
		statusCode: number,
		message: string,
		options?: {
			messageKey?: string
			messageVars?: Record<string, string | number>
			stack?: string
		}
	) {
		super(message)
		this.statusCode = statusCode
		this.messageKey = options?.messageKey
		this.messageVars = options?.messageVars

		if (options?.stack) {
			this.stack = options.stack
		} else {
			Error.captureStackTrace(this, this.constructor)
		}
	}
}

export default ApiError
