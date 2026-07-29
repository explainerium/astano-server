import type { Response } from "express"

interface Meta {
	page: number
	limit: number
	total: number
	totalPages: number
}

interface ResponsePayload<T> {
	statusCode: number
	message: string
	data?: T
	meta?: Meta
}

export const sendResponse = <T>(res: Response, payload: ResponsePayload<T>): void => {
	res.status(payload.statusCode).json({
		success: payload.statusCode < 400,
		statusCode: payload.statusCode,
		message: payload.message,
		...(payload.meta ? { meta: payload.meta } : {}),
		...(payload.data !== undefined ? { data: payload.data } : {}),
	})
}

export default sendResponse
