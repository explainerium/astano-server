/**
 * HTTP status codes used by this API.
 *
 * Replaces the `http-status` package, which went ESM-only at v2 and therefore
 * cannot be required from this CommonJS project. It was only ever a lookup
 * table of integers, so owning it costs nothing and removes a dependency from
 * the hot path of every controller.
 */
export const httpStatus = {
	OK: 200,
	CREATED: 201,
	ACCEPTED: 202,
	NO_CONTENT: 204,

	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	PAYMENT_REQUIRED: 402,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	METHOD_NOT_ALLOWED: 405,
	REQUEST_TIMEOUT: 408,
	CONFLICT: 409,
	GONE: 410,
	PAYLOAD_TOO_LARGE: 413,
	UNSUPPORTED_MEDIA_TYPE: 415,
	UNPROCESSABLE_ENTITY: 422,
	TOO_MANY_REQUESTS: 429,

	INTERNAL_SERVER_ERROR: 500,
	NOT_IMPLEMENTED: 501,
	BAD_GATEWAY: 502,
	SERVICE_UNAVAILABLE: 503,
	GATEWAY_TIMEOUT: 504,
} as const

export type HttpStatus = (typeof httpStatus)[keyof typeof httpStatus]

export default httpStatus
