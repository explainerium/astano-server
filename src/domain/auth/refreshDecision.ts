/**
 * What to do with a presented refresh token.
 *
 * Refresh tokens rotate: using one revokes it and issues another. That is what
 * makes a stolen token worth little — it works once, and the moment the real
 * owner refreshes, the thief's copy is dead.
 *
 * The cost is that "already revoked" has two very different meanings, and
 * answering both with a refusal is what logged customers out of working
 * sessions. Two tabs of the same shop reach the end of their access token at
 * the same second, both send the *same* refresh token, and one of them loses
 * the race. The client's single-flight guard is per tab and cannot see the
 * other one.
 *
 * So the age of the revocation decides:
 *
 *  - moments ago  → the race above. Honour it.
 *  - long ago     → the case rotation exists to catch. A token that should have
 *                   been spent is being presented again, which means a copy of
 *                   it exists somewhere it should not. Close every session the
 *                   account has, not merely this request.
 *
 * Pure, so both branches can be tested without a database.
 */

/**
 * How long a just-rotated token still works.
 *
 * Long enough for a second tab to wake and complete its round trip, short
 * enough that a stolen token is useless before anyone could carry it anywhere.
 */
export const ROTATION_GRACE_MS = 30_000

export interface StoredRefreshToken {
	expiresAt: Date
	revokedAt: Date | null
}

export type RefreshDecision =
	/** Normal path: revoke the presented token and issue a new pair. */
	| { kind: "ROTATE" }
	/** A second tab racing the first. Issue a new pair; the token is already revoked. */
	| { kind: "RACE" }
	/** Presented long after it was spent. Revoke everything this account holds. */
	| { kind: "REUSE" }
	/** Unknown or past its expiry. */
	| { kind: "INVALID" }

export const decideRefresh = (
	stored: StoredRefreshToken | null | undefined,
	now: Date = new Date(),
	graceMs: number = ROTATION_GRACE_MS
): RefreshDecision => {
	if (!stored) return { kind: "INVALID" }

	// Expiry is checked before revocation: a token past 30 days is simply over,
	// whatever else happened to it, and is not evidence of anything.
	if (stored.expiresAt <= now) return { kind: "INVALID" }

	if (!stored.revokedAt) return { kind: "ROTATE" }

	const sinceRevoked = now.getTime() - stored.revokedAt.getTime()

	return sinceRevoked <= graceMs ? { kind: "RACE" } : { kind: "REUSE" }
}
