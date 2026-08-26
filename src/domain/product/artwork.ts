/**
 * Whether a line may carry customer artwork, and how much.
 *
 * astano makes things to order — a cutter in the shape of somebody's logo, an
 * engraving, a printed sleeve — so for a good part of the catalogue the drawing
 * *is* the specification. The live shop attaches up to six files per line and
 * carries them to the order; without them a line reaches production with
 * nothing to make.
 *
 * Pure. Ownership and storage are the service's business; this only answers
 * what the product allows.
 */

export interface ArtworkRules {
	/** 0 means the product does not offer artwork at all. */
	maxFiles: number
	/** Whether the line cannot be ordered without at least one file. */
	required: boolean
}

export const NO_ARTWORK: ArtworkRules = { maxFiles: 0, required: false }

export interface ArtworkProduct {
	artworkMaxFiles?: number | null
	artworkRequired?: boolean | null
}

export const readArtworkRules = (product: ArtworkProduct | null | undefined): ArtworkRules => {
	const maxFiles = Number(product?.artworkMaxFiles ?? 0)

	if (!Number.isFinite(maxFiles) || maxFiles <= 0) return NO_ARTWORK

	return {
		maxFiles: Math.floor(maxFiles),
		// "Required" on a product that accepts nothing would refuse every order
		// of it, so the two are read together rather than independently.
		required: Boolean(product?.artworkRequired),
	}
}

export const acceptsArtwork = (rules: ArtworkRules): boolean => rules.maxFiles > 0

/** What an enquiry line takes when the product itself asks for no artwork. */
export const INQUIRY_ARTWORK_FALLBACK = 6

/**
 * What an *enquiry* line may carry, which is a different question.
 *
 * `artworkMaxFiles` says whether a product is made to a drawing — a fact about
 * manufacturing, set per product. An enquiry is a question, and the answer very
 * often depends on a sketch, a photograph of the thing being copied, or a logo,
 * for products that are never otherwise made to order.
 *
 * The client asked for the upload to be available on the enquiry basket and
 * found it available nowhere. It was not a bug in the form: every product in
 * the shop has `artworkMaxFiles` at 0, so there was no line anywhere that would
 * take a file. Asking them to go and set a number on each of fifty products
 * before they can be sent a drawing is the wrong way round.
 *
 * So an enquiry line takes the product's allowance where the shop has set one,
 * and this otherwise. `required` still comes from the product alone — needing a
 * drawing before a quote can be given is a fact about the product, and nothing
 * here should start demanding one.
 */
export const readInquiryArtworkRules = (product: ArtworkProduct | null | undefined): ArtworkRules => {
	const rules = readArtworkRules(product)
	return acceptsArtwork(rules) ? rules : { maxFiles: INQUIRY_ARTWORK_FALLBACK, required: false }
}

export type ArtworkProblem =
	| { kind: "NOT_ACCEPTED" }
	| { kind: "TOO_MANY"; max: number }
	| { kind: "REQUIRED" }

/**
 * Checks a proposed set of attachments against the rules.
 *
 * `count` is the total the line would end up with, not the number being added —
 * a limit of six means six on the line, however many requests it took.
 */
export const checkArtwork = (rules: ArtworkRules, count: number): ArtworkProblem | null => {
	if (count > 0 && !acceptsArtwork(rules)) return { kind: "NOT_ACCEPTED" }
	if (count > rules.maxFiles) return { kind: "TOO_MANY", max: rules.maxFiles }

	return null
}

/**
 * The check that runs at checkout rather than in the form.
 *
 * Separate from `checkArtwork` because "required" is only meaningful once the
 * customer is finished: a basket line is allowed to sit there half-specified
 * while they find the file, and refusing the attachment would leave them
 * nowhere to put it.
 */
export const checkArtworkComplete = (rules: ArtworkRules, count: number): ArtworkProblem | null => {
	if (rules.required && count === 0) return { kind: "REQUIRED" }

	return checkArtwork(rules, count)
}
