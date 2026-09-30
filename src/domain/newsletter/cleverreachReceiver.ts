/**
 * One of the shop's subscribers, as CleverReach's upsert takes it.
 *
 * `POST /v3/groups/:group_id/receivers/upsert` creates the address or updates
 * it, so the same call serves a new subscriber, a returning one and one who
 * has left. Only confirmed and unsubscribed rows are ever sent: a pending
 * address has given no consent, and CleverReach is where mailings go out.
 *
 * Timestamps are Unix seconds, which is what CleverReach counts in. `activated`
 * is the moment of our double opt-in, so CleverReach neither mails a second
 * confirmation nor treats the address as imported without consent; `source`
 * says where the consent was given, which is the other half of the evidence.
 */
export interface SubscriberRow {
	email: string
	status: "PENDING" | "CONFIRMED" | "UNSUBSCRIBED"
	locale: string
	source: string | null
	createdAt: Date
	confirmedAt: Date | null
	unsubscribedAt: Date | null
}

export interface CleverReachReceiver {
	email: string
	registered: number
	activated: number
	/** Non-zero leaves the list; 0 brings a returning subscriber back. */
	deactivated: number
	source: string
	tags: string[]
}

const seconds = (date: Date): number => Math.floor(date.getTime() / 1000)

export const toReceiver = (row: SubscriberRow, now: Date = new Date()): CleverReachReceiver | null => {
	if (row.status === "PENDING" || !row.confirmedAt) return null

	return {
		email: row.email,
		registered: seconds(row.createdAt),
		activated: seconds(row.confirmedAt),
		deactivated: row.status === "UNSUBSCRIBED" ? seconds(row.unsubscribedAt ?? now) : 0,
		source: row.source ? `astano Shop (${row.source})` : "astano Shop",
		// The language they signed up in, so a German and an English mailing can
		// each go to the right half of the list.
		tags: ["astano-shop", `lang-${row.locale}`],
	}
}
