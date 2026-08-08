import { z } from "zod"

export const listUsersSchema = z.object({
	query: z.object({
		status: z.enum(["ACTIVE", "PENDING", "REJECTED", "SUSPENDED", "DRAFT"]).optional(),
		role: z.enum(["GUEST", "B2C", "RESELLER", "SHOP_MANAGER", "ADMIN"]).optional(),
		search: z.string().trim().max(200).optional(),
		/**
		 * The recycle bin. A query string carries text, so "false" would be truthy
		 * — hence the explicit comparison rather than a cast.
		 */
		deleted: z
			.enum(["true", "false"])
			.optional()
			.transform((value) => value === "true"),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(100).default(20),
	}),
})

export const userIdSchema = z.object({
	params: z.object({
		id: z.string().uuid("A valid user id is required"),
	}),
})

/**
 * GUEST is not assignable. It exists so resolvePrice() has a role for anonymous
 * requests and is never stored on a row — offering it here would create an
 * account nobody could sign in as.
 */
export const setRoleSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		role: z.enum(["B2C", "RESELLER", "SHOP_MANAGER", "ADMIN"]),
	}),
})

/**
 * PENDING and REJECTED are absent on purpose: those belong to the dealer
 * decision, which has its own endpoints because it emails the applicant.
 */
export const setStatusSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		status: z.enum(["ACTIVE", "SUSPENDED", "DRAFT"]),
	}),
})

export const UserValidation = {
	listUsersSchema,
	userIdSchema,
	setRoleSchema,
	setStatusSchema,
}
