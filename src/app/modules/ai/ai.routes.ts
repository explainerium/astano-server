import { Router } from "express"
import { z } from "zod"
import { MAX_BRIEF, MAX_EXISTING, MAX_FACTS } from "../../../domain/ai/prompt"
import { auth } from "../../middlewares/auth"
import { writeLimiter } from "../../middlewares/rateLimiter"
import { validateRequest } from "../../middlewares/validateRequest"
import { AiController } from "./ai.controller"

/**
 * Drafting text for the catalogue.
 *
 * Staff only, all of it. Every call spends the shop's own credit, so an
 * endpoint a stranger could reach is an endpoint that runs up somebody else's
 * bill — and the rate limiter is here for the same reason rather than for load.
 */
const generateSchema = z.object({
	body: z.object({
		kind: z.enum([
			"product",
			"productShort",
			"category",
			"content",
			"metaTitle",
			"metaDescription",
		]),
		/** Overrides the kind's usual shape — the same kind may sit in a plain box. */
		format: z.enum(["html", "text"]).optional(),
		locale: z.enum(["de", "en"]),
		brief: z.string().trim().max(MAX_BRIEF).default(""),
		name: z.string().trim().max(200).optional(),
		sku: z.string().trim().max(60).optional(),
		facts: z.array(z.string().trim().max(200)).max(MAX_FACTS).optional(),
		existing: z.string().trim().max(MAX_EXISTING).optional(),
	}),
})

const translateSchema = z.object({
	body: z.object({
		text: z.string().max(MAX_EXISTING),
		from: z.enum(["de", "en"]),
		to: z.enum(["de", "en"]),
		/** Whether the field holds HTML. A name and a description round-trip differently. */
		html: z.boolean().default(false),
	}),
})

const router = Router()

router.use(auth("ADMIN", "SHOP_MANAGER"))

router.get("/", AiController.status)
router.post("/generate", writeLimiter, validateRequest(generateSchema), AiController.generate)
router.post("/translate", writeLimiter, validateRequest(translateSchema), AiController.translate)
router.post("/test", writeLimiter, AiController.test)

export const AdminAiRoutes = router
export default router
