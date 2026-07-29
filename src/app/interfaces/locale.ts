import type { LocaleCode } from "../../config/locales"

/**
 * Every request carries a resolved locale. Declared here so services can read
 * req.locale without casting.
 */
declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		interface Request {
			locale: LocaleCode
		}
	}
}

export {}
