import { describe, expect, it } from "vitest"
import {
	callTokenMatches,
	readUnsubscribe,
	verificationAnswer,
} from "../../src/domain/newsletter/cleverreachHook"

describe("verificationAnswer", () => {
	it("echoes the secret behind our verify token", () => {
		expect(verificationAnswer("damnSecretBatTokenForVerify", "1029384756")).toBe(
			"damnSecretBatTokenForVerify 1029384756"
		)
	})
})

describe("callTokenMatches", () => {
	it("accepts the token CleverReach was given", () => {
		expect(callTokenMatches("abc123", "abc123")).toBe(true)
	})

	it("refuses anything else, including nothing", () => {
		expect(callTokenMatches("abc123", "abc124")).toBe(false)
		expect(callTokenMatches("abc123", "abc")).toBe(false)
		expect(callTokenMatches("abc123", undefined)).toBe(false)
		expect(callTokenMatches("", "")).toBe(false)
	})
})

describe("readUnsubscribe", () => {
	it("reads the receiver from CleverReach's payload", () => {
		expect(
			readUnsubscribe({
				event: "receiver.unsubscribed",
				condition: "1939",
				payload: { pool_id: "42", group_id: "1939" },
			})
		).toEqual({ groupId: "1939", poolId: "42" })
	})

	it("takes numeric ids too", () => {
		expect(
			readUnsubscribe({ event: "receiver.unsubscribed", payload: { pool_id: 42, group_id: 1939 } })
		).toEqual({ groupId: "1939", poolId: "42" })
	})

	it("ignores every other event and anything malformed", () => {
		expect(readUnsubscribe({ event: "receiver.subscribed", payload: { pool_id: "42", group_id: "1" } })).toBeNull()
		expect(readUnsubscribe({ event: "receiver.unsubscribed", payload: {} })).toBeNull()
		expect(readUnsubscribe(null)).toBeNull()
	})
})
