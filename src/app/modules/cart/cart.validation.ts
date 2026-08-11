import { z } from "zod"

export const addItemSchema = z.object({
	body: z.object({
		variantId: z.string().uuid("A valid variant id is required"),
		quantity: z.number().int().min(1).default(1),
		/// Set when adding an option alongside a main line (§4.6).
		parentItemId: z.string().uuid().nullable().optional(),
		/// Design files chosen on the product page, uploaded before the add.
		assetIds: z.array(z.string().uuid()).max(20).optional(),
	}),
})

export const updateItemSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		quantity: z.number().int().min(0, "Quantity cannot be negative"),
	}),
})

export const itemIdSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
})

/**
 * The whole set, not an addition. The customer edits a list of drawings, and
 * an add-only endpoint leaves "remove the one I attached by mistake" to a
 * second endpoint nobody builds.
 *
 * The product's own limit is enforced in the service; 20 here is only a bound
 * on what the parser will accept.
 */
export const setFilesSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		assetIds: z.array(z.string().uuid()).max(20).default([]),
	}),
})

export const CartValidation = { addItemSchema, updateItemSchema, itemIdSchema, setFilesSchema }
