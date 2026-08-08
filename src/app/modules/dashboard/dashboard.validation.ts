import { z } from "zod"

/**
 * `days` is the comparison window. Capped at a quarter because the daily series
 * is bucketed in memory — past that the chart is unreadable anyway and the
 * query stops being cheap.
 */
const summarySchema = z.object({
	query: z.object({
		days: z.coerce.number().int().min(1).max(90).default(7),
	}),
})

export const DashboardValidation = { summarySchema }
