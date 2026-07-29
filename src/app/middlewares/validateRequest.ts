import type { NextFunction, Request, Response } from "express"
import type { ZodType } from "zod"

/**
 * Validates body, query and params against a Zod schema and replaces req.body
 * with the parsed result, so controllers receive coerced, trimmed data rather
 * than whatever arrived on the wire.
 *
 * Failures are thrown, not handled here — globalErrorHandler turns a ZodError
 * into a localized 400 with per-field details.
 */
export const validateRequest =
	(schema: ZodType) =>
	async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
		try {
			// Express 5 leaves req.body undefined when no body is sent. Default it
			// so schemas with only optional fields still validate — /refresh takes
			// its token from a cookie and legitimately sends nothing.
			const parsed = (await schema.parseAsync({
				body: req.body ?? {},
				query: req.query,
				params: req.params,
			})) as { body?: unknown }

			if (parsed.body !== undefined) req.body = parsed.body
			next()
		} catch (error) {
			next(error)
		}
	}

export default validateRequest
