import { z } from "zod"

export const addItemSchema = z.object({
	body: z.object({
		variantId: z.string().uuid("A valid variant id is required"),
		quantity: z.number().int().min(1).default(1),
		/// Set when adding an option alongside a main line (§4.6).
		parentItemId: z.string().uuid().nullable().optional(),
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

export const CartValidation = { addItemSchema, updateItemSchema, itemIdSchema }
