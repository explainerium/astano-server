import { z } from "zod"
import { LOCALES } from "../../../config/locales"
import { CONTENT_REGISTRY, isEditableKey, isImageKey } from "./contentRegistry"

const LOCALE_CODES = LOCALES.map((l) => l.code)

/**
 * Long enough for the longest thing on the marketing pages, and no longer.
 *
 * The biggest of the 198 today is 767 characters; ten thousand leaves room for
 * a shop that writes three times as much without leaving the field open to
 * somebody pasting a novel into a banner tile. The genuinely long documents —
 * the AGB, the privacy policy — are Pages and are not written through here.
 */
const MAX_VALUE = 10_000

export const publicContentSchema = z.object({
	query: z.object({
		locale: z.enum(LOCALE_CODES as [string, ...string[]]).optional(),
	}),
})

/**
 * What the dashboard may save.
 *
 * The registry decides, not this schema — every key is checked against it, and
 * a key it does not know is refused whatever it looks like. That is what keeps
 * the 1,664 admin and chrome strings unreachable: there is no request that can
 * name one.
 *
 * Text and pictures are refused into each other's lists rather than sorted out
 * afterwards. A picture key arriving with a string value is a caller that has
 * misunderstood the shape, and answering it with a precise error beats storing
 * something the storefront will not know how to read.
 */
export const writeContentSchema = z.object({
	body: z
		.object({
			entries: z
				.array(
					z.object({
						key: z.string().trim().min(1).max(200),
						locale: z.enum(LOCALE_CODES as [string, ...string[]]),
						value: z.string().max(MAX_VALUE),
					})
				)
				.optional(),
			media: z
				.array(
					z.object({
						key: z.string().trim().min(1).max(200),
						/** Null clears the override; the page falls back to what shipped. */
						assetId: z.string().uuid().nullable(),
					})
				)
				.optional(),
		})
		.superRefine((body, ctx) => {
			const entries = body.entries ?? []
			const media = body.media ?? []

			if (!entries.length && !media.length) {
				ctx.addIssue({
					code: "custom",
					path: ["entries"],
					message: "Nothing to save",
				})
			}

			entries.forEach((e, i) => {
				if (!isEditableKey(e.key)) {
					ctx.addIssue({
						code: "custom",
						path: ["entries", i, "key"],
						message: `"${e.key}" is not editable content`,
					})
					return
				}
				if (isImageKey(e.key)) {
					ctx.addIssue({
						code: "custom",
						path: ["entries", i, "key"],
						message: `"${e.key}" is a picture — send it under "media"`,
					})
					return
				}

				/**
				 * A placeholder the shipped copy interpolates has to survive the
				 * edit. Deleting `{year}` from the footer does not shorten the
				 * sentence, it removes the year — and next-intl renders the
				 * remaining text without complaint, so nothing else would catch it.
				 */
				for (const v of CONTENT_REGISTRY[e.key]?.vars ?? []) {
					if (!e.value.includes(`{${v}}`)) {
						ctx.addIssue({
							code: "custom",
							path: ["entries", i, "value"],
							message: `The text must still contain {${v}}`,
						})
					}
				}
			})

			media.forEach((m, i) => {
				if (!isEditableKey(m.key)) {
					ctx.addIssue({
						code: "custom",
						path: ["media", i, "key"],
						message: `"${m.key}" is not editable content`,
					})
					return
				}
				if (!isImageKey(m.key)) {
					ctx.addIssue({
						code: "custom",
						path: ["media", i, "key"],
						message: `"${m.key}" is text — send it under "entries"`,
					})
				}
			})
		}),
})

export const ContentValidation = {
	publicContentSchema,
	writeContentSchema,
}
