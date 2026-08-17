import type { OrderStatus } from "@prisma/client"

/**
 * Whether an order is still open to a drawing arriving after it was placed.
 *
 * The client's rule is that print files may follow the order — an order with no
 * artwork is one waiting on artwork, not an invalid one — so the customer needs
 * somewhere to send it afterwards. Their account is that somewhere.
 *
 * This is the one deliberate hole in the freeze rule that governs orders, and
 * it is kept small on purpose. A file attached to an order that has already
 * shipped changes nothing about what was made and quietly rewrites the record
 * of what production was given; a file attached to a cancelled one is a file
 * for something that is not being made at all. Both are refused.
 *
 * Pure — no Prisma, no clock. The service decides who is asking; this decides
 * whether the order is still listening.
 */

/**
 * Statuses that still accept artwork.
 *
 * ON_HOLD is in the list rather than out of it: an order paused *because*
 * nobody has sent the drawing is the single most likely order to receive one.
 */
const OPEN_TO_ARTWORK: readonly OrderStatus[] = ["PENDING", "PROCESSING", "ON_HOLD"]

export const acceptsLateArtwork = (status: OrderStatus): boolean =>
	OPEN_TO_ARTWORK.includes(status)
