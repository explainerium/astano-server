import { z } from "zod"

/**
 * The two ladders that live outside a product.
 *
 * A product's own ladder is edited as part of the product and validated in
 * `product.validation.ts`. These two are separate resources with their own
 * screens, so they get their own schemas — but the rung shape is deliberately
 * identical, because a rung means the same thing wherever it is stored.
 */

const money = z.union([z.string().regex(/^\d+(\.\d{1,4})?$/), z.number().nonnegative()])
const priceRole = z.enum(["GUEST", "B2C", "RESELLER"])
const tierType = z.enum(["FIXED_PRICE", "PERCENTAGE", "FIXED_AMOUNT"])

const rung = z.object({
	minQuantity: z.number().int().min(1),
	type: tierType.default("FIXED_PRICE"),
	value: money,
})

/**
 * A ladder must not contain two rungs at the same threshold.
 *
 * The resolver picks the highest threshold the quantity reaches; two rungs at
 * the same one means whichever the sort happens to leave last wins, which is
 * not a decision anyone made. The database enforces this too — this is here so
 * the caller gets a message rather than a constraint violation.
 */
const ladder = z.array(rung).superRefine((rows, ctx) => {
	const seen = new Map<number, number>()
	rows.forEach((row, index) => {
		const first = seen.get(row.minQuantity)
		if (first === undefined) {
			seen.set(row.minQuantity, index)
			return
		}
		ctx.addIssue({
			code: "custom",
			path: [index, "minQuantity"],
			message: `Row ${first + 1} already covers quantity ${row.minQuantity}.`,
		})
	})
})

export const setCategoryTiersSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		/**
		 * The complete ladder for one role, replacing whatever is stored.
		 *
		 * Per role rather than all roles at once: the category screen edits one
		 * audience at a time, and a payload carrying every role would let a screen
		 * that showed only Guests wipe the Reseller ladder by omission.
		 */
		role: priceRole,
		tiers: ladder,
	}),
})

export const categoryIdSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
})

export const setCustomerTiersSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		/**
		 * Null covers everything this customer buys; a product id scopes the
		 * ladder to one item. Sent explicitly rather than inferred, so "all
		 * products" is a choice on the form and not the result of a missing field.
		 */
		productId: z.string().uuid().nullable().default(null),
		note: z.string().trim().max(500).nullable().optional(),
		tiers: ladder,
	}),
})

export const customerIdSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
})

export const PricingValidation = {
	setCategoryTiersSchema,
	categoryIdSchema,
	setCustomerTiersSchema,
	customerIdSchema,
}
