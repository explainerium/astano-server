import { z } from "zod"

const selection = z.object({
	variantId: z.string().uuid(),
	quantity: z.number().int().min(1),
})

/**
 * A configuration: the main variant plus whichever options the customer ticked.
 *
 * Options are absent from `options` when unticked — they start unselected, so
 * an empty array is the normal opening state, not an error.
 */
const configuration = z.object({
	variantId: z.string().uuid("Choose which variant you are configuring"),
	quantity: z.number().int().min(1).default(1),
	options: z.array(selection).default([]),
})

export const priceSchema = z.object({ body: configuration })

export const addToCartSchema = z.object({ body: configuration })

export const BundleValidation = { priceSchema, addToCartSchema }
