import { timingSafeEqual } from "crypto"

/**
 * The small, checkable parts of CleverReach's webhook.
 * https://developers.cleverreach.com/docs/guides/webhooks/
 */

/**
 * The answer to CleverReach's verification GET: our verify token, a space, and
 * the secret it sent. Anything else and the registration is refused.
 */
export const verificationAnswer = (verify: string, secret: string): string => `${verify} ${secret}`

/**
 * Whether a call carries the token CleverReach gave us when the hook was
 * registered (`X-CR-Calltoken`). Constant-time, because it is the only thing
 * standing between a stranger and a POST that unsubscribes people.
 */
export const callTokenMatches = (expected: string, received: unknown): boolean => {
	if (!expected || typeof received !== "string" || !received) return false
	const a = Buffer.from(expected)
	const b = Buffer.from(received)
	return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The receiver an unsubscribe call is about, or null for anything else.
 *
 * The payload names the receiver by pool id and group id; the address itself
 * has to be asked for.
 */
export const readUnsubscribe = (body: unknown): { groupId: string; poolId: string } | null => {
	const b = (body ?? {}) as { event?: unknown; payload?: { pool_id?: unknown; group_id?: unknown } }
	if (b.event !== "receiver.unsubscribed") return null

	const poolId = b.payload?.pool_id
	const groupId = b.payload?.group_id
	if ((typeof poolId !== "string" && typeof poolId !== "number") || poolId === "") return null
	if ((typeof groupId !== "string" && typeof groupId !== "number") || groupId === "") return null

	return { groupId: String(groupId), poolId: String(poolId) }
}
