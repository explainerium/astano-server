import { z } from "zod"

export const addItemSchema = z.object({
	body: z.object({
		variantId: z.string().uuid("A valid variant id is required"),
		quantity: z.number().int().min(1).default(1),
		note: z.string().trim().max(1000).optional(),
		assetIds: z.array(z.string().uuid()).max(20).optional(),
	}),
})

export const updateItemSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		quantity: z.number().int().min(0),
		note: z.string().trim().max(1000).optional(),
	}),
})

export const itemIdSchema = z.object({ params: z.object({ id: z.string().uuid() }) })

/**
 * Guests may submit a quote even though they may not check out (R15 vs R7), so
 * contact details are required from anyone not signed in. For a signed-in
 * customer they default from the account.
 */
export const submitSchema = z.object({
	body: z.object({
		title: z.string().trim().min(1).max(200),
		message: z.string().trim().max(5000).optional(),
		contactName: z.string().trim().min(1).max(160).optional(),
		contactEmail: z.string().trim().toLowerCase().email().optional(),
		contactPhone: z.string().trim().max(50).optional(),
		contactCompany: z.string().trim().max(200).optional(),
	}),
})

export const replySchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		body: z.string().trim().min(1).max(10000),
		isInternal: z.boolean().default(false),
	}),
})

export const listSchema = z.object({
	query: z.object({
		status: z
			.enum(["OPEN", "ANSWERED", "ACCEPTED", "DECLINED", "EXPIRED", "CLOSED"])
			.optional(),
		search: z.string().trim().max(200).optional(),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(100).default(20),
	}),
})

export const idSchema = z.object({ params: z.object({ id: z.string().uuid() }) })

const decimal = z.union([z.string().regex(/^\d+(\.\d{1,4})?$/), z.number().nonnegative()])

/** Staff pricing the request and moving it along. */
export const quoteUpdateSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		status: z
			.enum(["OPEN", "ANSWERED", "ACCEPTED", "DECLINED", "EXPIRED", "CLOSED"])
			.optional(),
		expiresAt: z.coerce.date().nullable().optional(),
		items: z
			.array(
				z.object({
					id: z.string().uuid(),
					quotedUnitPrice: decimal.nullable().optional(),
				})
			)
			.optional(),
	}),
})

export const setFilesSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		assetIds: z.array(z.string().uuid()).max(20).default([]),
	}),
})

export const QuoteValidation = {
	setFilesSchema,
	addItemSchema,
	updateItemSchema,
	itemIdSchema,
	submitSchema,
	replySchema,
	listSchema,
	idSchema,
	quoteUpdateSchema,
}
