import { Router } from "express"
import { z } from "zod"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { EmailController } from "./email.controller"

const overrideSchema = z.object({
	body: z.object({
		enabled: z.boolean(),
		// Bounded because these end up in a mail header and in the body of every
		// message of that kind; an unbounded subject is a way to make mail bounce.
		subject: z.string().trim().max(200).default(""),
		heading: z.string().trim().max(200).default(""),
		additionalContent: z.string().trim().max(4000).default(""),
		recipient: z.string().trim().max(320).default(""),
	}),
})

const testSchema = z.object({
	body: z.object({
		to: z.email({ message: "Enter an email address" }),
		locale: z.enum(["en", "de"]).optional(),
	}),
})

const router = Router()

/*
 * Staff only, all of it. A preview renders admin-written content and reveals
 * the shop's own templates, and the test send would otherwise be an open relay
 * for anyone who could guess the route.
 */
router.use(auth("ADMIN", "SHOP_MANAGER"))

router.get("/", EmailController.list)
router.get("/:kind", EmailController.get)
router.get("/:kind/preview", EmailController.preview)
router.put("/:kind", validateRequest(overrideSchema), EmailController.save)
router.delete("/:kind", EmailController.reset)
router.post("/:kind/test", validateRequest(testSchema), EmailController.sendTest)

export const EmailRoutes = router
export default router
