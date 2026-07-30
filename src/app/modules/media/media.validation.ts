import { z } from "zod"
import { SUPPORTED_LOCALES } from "../../../config/locales"

export const listSchema = z.object({
	query: z.object({
		folderId: z.string().uuid().optional(),
		visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
		search: z.string().trim().max(200).optional(),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(100).default(40),
	}),
})

export const idSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
})

export const updateSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		folderId: z.string().uuid().nullable().optional(),
		locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional(),
		alt: z.string().trim().max(300).optional(),
		caption: z.string().trim().max(1000).optional(),
	}),
})

export const createFolderSchema = z.object({
	body: z.object({
		name: z.string().trim().min(1).max(120),
		parentId: z.string().uuid().nullable().optional(),
	}),
})

export const MediaValidation = { listSchema, idSchema, updateSchema, createFolderSchema }
