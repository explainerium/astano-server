import { AsyncLocalStorage } from "node:async_hooks"
import type { Mail } from "./transport"

/**
 * Lets the dashboard render an email by actually sending one.
 *
 * A preview that builds its own HTML proves nothing: it would go on looking
 * right while the real message picked up a different branding value, skipped an
 * override, or failed on a template the preview never touched. So preview runs
 * the genuine sender — the same `prepare`, the same layout, the same plain-text
 * fallback — and this is what stops the result leaving the building.
 *
 * `AsyncLocalStorage` rather than a module-level flag, because two admins
 * previewing at the same moment must not capture each other's mail, and a flag
 * would do exactly that.
 */
export interface MailContext {
	/** Present in preview: composed mail lands here instead of the transport. */
	capture?: Mail[]
	/** Preview renders a switched-off email too — you have to see it to enable it. */
	ignoreDisabled?: boolean
}

const storage = new AsyncLocalStorage<MailContext>()

export const mailContext = (): MailContext | undefined => storage.getStore()

/** Runs `fn` with mail captured rather than sent, and returns what it composed. */
export const captureMail = async <T>(
	fn: () => Promise<T>,
	opts: { ignoreDisabled?: boolean } = {}
): Promise<{ result: T; mails: Mail[] }> => {
	const mails: Mail[] = []
	const result = await storage.run({ capture: mails, ignoreDisabled: opts.ignoreDisabled }, fn)

	return { result, mails }
}
