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

/**
 * A ceiling on a list, so the FAQ cannot become a document.
 *
 * Fifty is far past what anybody scrolls through and far short of what would
 * make the page slow. It exists because a list is one value and the value cap
 * above counts characters, not items.
 */
const MAX_LIST_ITEMS = 50

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
				 * A list is one JSON value, and has to still be one on the way in.
				 *
				 * The storefront leaves a malformed list alone rather than breaking
				 * the page, which means a bad save would look like it worked and do
				 * nothing. Refusing it here is what makes that impossible: the
				 * shape is checked against the fields the registry declares, so an
				 * item missing its answer, or carrying a key nothing renders, never
				 * reaches the database.
				 */
				const definition = CONTENT_REGISTRY[e.key]
				if (definition?.type === "list") {
					const names = (definition.fields ?? []).map((f) => f.name)
					let parsed: unknown
					try {
						parsed = JSON.parse(e.value)
					} catch {
						parsed = undefined
					}

					const bad =
						!Array.isArray(parsed) ||
						parsed.length > MAX_LIST_ITEMS ||
						parsed.some(
							(item) =>
								item === null ||
								typeof item !== "object" ||
								Array.isArray(item) ||
								names.some((n) => typeof (item as Record<string, unknown>)[n] !== "string") ||
								Object.keys(item as Record<string, unknown>).some((k) => !names.includes(k))
						)

					if (bad) {
						ctx.addIssue({
							code: "custom",
							path: ["entries", i, "value"],
							message: `"${e.key}" must be a list of at most ${MAX_LIST_ITEMS} items, each carrying ${names.join(" and ")}`,
						})
					}
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

/**
 * A legal document is measured in tens of thousands of words, not hundreds.
 *
 * The German privacy policy is about 85 KB of sanitised HTML today, so this is
 * generous rather than tight — the ceiling exists to stop a paste going wrong,
 * not to constrain what the shop may write.
 */
const MAX_PAGE = 400_000

export const readPageSchema = z.object({
	params: z.object({ slug: z.string().trim().min(1).max(60) }),
	query: z.object({
		locale: z.enum(LOCALE_CODES as [string, ...string[]]).optional(),
	}),
})

/**
 * The documents the shop may rewrite.
 *
 * The slug is checked against the registry in the service, which is the layer
 * that writes; this refuses the obviously wrong shapes first so the error names
 * the field rather than the transaction.
 */
export const writePagesSchema = z.object({
	body: z.object({
		pages: z
			.array(
				z.object({
					slug: z.string().trim().min(1).max(60),
					locale: z.enum(LOCALE_CODES as [string, ...string[]]),
					title: z.string().trim().min(1).max(200),
					bodyHtml: z.string().max(MAX_PAGE),
				})
			)
			.min(1),
	}),
})

export const ContentValidation = {
	publicContentSchema,
	writeContentSchema,
	readPageSchema,
	writePagesSchema,
}
