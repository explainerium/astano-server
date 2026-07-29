import type { NextFunction, Request, RequestHandler, Response } from "express"

/**
 * Express 5 forwards rejected promises to the error handler on its own, so this
 * is no longer strictly required. It is kept because it makes the intent
 * explicit at every controller and matches the house style.
 */
export const catchAsync =
	(fn: RequestHandler): RequestHandler =>
	(req: Request, res: Response, next: NextFunction) => {
		Promise.resolve(fn(req, res, next)).catch(next)
	}

export default catchAsync
