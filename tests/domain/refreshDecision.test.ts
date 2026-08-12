import { describe, expect, it } from "vitest"
import {
	decideRefresh,
	ROTATION_GRACE_MS,
	type StoredRefreshToken,
} from "../../src/domain/auth/refreshDecision"

const NOW = new Date("2026-08-13T12:00:00Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const ahead = (ms: number) => new Date(NOW.getTime() + ms)

const token = (over: Partial<StoredRefreshToken> = {}): StoredRefreshToken => ({
	expiresAt: ahead(30 * 24 * 60 * 60 * 1000),
	revokedAt: null,
	...over,
})

/**
 * The two branches that matter are the ones that used to be the same answer: a
 * second tab racing the first was refused exactly like a replayed token, and
 * being refused is what logged the customer out.
 */
describe("decideRefresh", () => {
	it("rotates a live token", () => {
		expect(decideRefresh(token(), NOW)).toEqual({ kind: "ROTATE" })
	})

	it("treats a just-revoked token as a race between tabs", () => {
		// Two tabs woke together; the first rotated a second ago.
		expect(decideRefresh(token({ revokedAt: ago(1_000) }), NOW)).toEqual({ kind: "RACE" })
	})

	it("still calls it a race at the edge of the window", () => {
		expect(decideRefresh(token({ revokedAt: ago(ROTATION_GRACE_MS) }), NOW)).toEqual({
			kind: "RACE",
		})
	})

	it("calls it reuse once past the window", () => {
		expect(decideRefresh(token({ revokedAt: ago(ROTATION_GRACE_MS + 1) }), NOW)).toEqual({
			kind: "REUSE",
		})
	})

	it("calls a token revoked hours ago reuse", () => {
		// The case rotation exists to catch: this copy should have been dead.
		expect(decideRefresh(token({ revokedAt: ago(6 * 60 * 60 * 1000) }), NOW)).toEqual({
			kind: "REUSE",
		})
	})

	it("refuses an unknown token", () => {
		expect(decideRefresh(null, NOW)).toEqual({ kind: "INVALID" })
		expect(decideRefresh(undefined, NOW)).toEqual({ kind: "INVALID" })
	})

	it("refuses an expired token", () => {
		expect(decideRefresh(token({ expiresAt: ago(1) }), NOW)).toEqual({ kind: "INVALID" })
	})

	it("refuses an expired token before considering revocation", () => {
		// Expiry is simply over. It is not evidence of a replay, so it must not
		// close every other session the account has.
		const expiredAndRevokedLongAgo = token({
			expiresAt: ago(1),
			revokedAt: ago(6 * 60 * 60 * 1000),
		})
		expect(decideRefresh(expiredAndRevokedLongAgo, NOW)).toEqual({ kind: "INVALID" })
	})

	it("treats expiring exactly now as expired", () => {
		expect(decideRefresh(token({ expiresAt: NOW }), NOW)).toEqual({ kind: "INVALID" })
	})
})
