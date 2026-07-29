import { z } from "zod"

export const listUsersSchema = z.object({
	query: z.object({
		status: z.enum(["ACTIVE", "PENDING", "REJECTED"]).optional(),
		role: z.enum(["GUEST", "B2C", "RESELLER", "SHOP_MANAGER", "ADMIN"]).optional(),
		search: z.string().trim().max(200).optional(),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(100).default(20),
	}),
})

export const userIdSchema = z.object({
	params: z.object({
		id: z.string().uuid("A valid user id is required"),
	}),
})

export const setRoleSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		role: z.enum(["B2C", "RESELLER", "SHOP_MANAGER", "ADMIN"]),
	}),
})

export const UserValidation = {
	listUsersSchema,
	userIdSchema,
	setRoleSchema,
}
