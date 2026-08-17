/**
 * What a settings form is allowed to do to what is already stored.
 *
 * The awkward case is a credential. The screen cannot show one — the whole
 * point of encrypting it is that it never comes back — so its box is empty
 * every time the page loads, and an empty box is therefore submitted on every
 * save of that group, including the ones where the admin only changed the port
 * beside it. Written literally, that erases a working password whenever
 * somebody edits its neighbour, and the shop stops sending mail for a reason
 * nobody can see on the screen they were just on.
 *
 * So a blank credential means "I did not touch this" and is dropped. Clearing
 * one is a deliberate act with its own route (`DELETE /settings/:key`), not
 * something that can happen by pressing Save.
 *
 * A rule rather than four lines inside the service because it is the rule that
 * is worth being sure about: everything else here is a database write.
 */

export interface SettingInput {
	key: string
	value: unknown
	isPublic?: boolean
}

export type PlannedWrite =
	| { key: string; kind: "plain"; value: unknown; isPublic: boolean }
	/** `value` is the plaintext. The caller seals it — this stays pure. */
	| { key: string; kind: "secret"; value: string }

const asString = (value: unknown): string =>
	value === null || value === undefined ? "" : String(value)

export const planSettingWrite = (
	entries: readonly SettingInput[],
	isSecret: (key: string) => boolean
): PlannedWrite[] =>
	entries.flatMap((entry): PlannedWrite[] => {
		if (!isSecret(entry.key)) {
			return [{ key: entry.key, kind: "plain", value: entry.value, isPublic: entry.isPublic ?? false }]
		}

		const value = asString(entry.value).trim()

		// Left alone, not cleared.
		if (!value) return []

		/*
		 * Never public, whatever the form said.
		 *
		 * `isPublic` is what lets the storefront read a setting without signing
		 * in. The screen sends the flag back from the registry it was given, so
		 * this should already be false — but "should already be" is not the
		 * standard for the field that decides whether an SMTP password is served
		 * to anonymous visitors.
		 */
		return [{ key: entry.key, kind: "secret", value }]
	})
