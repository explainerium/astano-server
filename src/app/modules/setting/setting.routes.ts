import { Router } from "express"
import rateLimit from "express-rate-limit"
import { z } from "zod"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { SettingController } from "./setting.controller"

const upsertSchema = z.object({
	body: z.object({
		settings: z
			.array(
				z.object({
					key: z.string().trim().min(1).max(120),
					value: z.unknown(),
					isPublic: z.boolean().optional(),
				})
			)
			.min(1),
	}),
})

const testMailSchema = z.object({
	body: z.object({
		to: z.email().max(200),
	}),
})

/**
 * The one staff route that sends mail to an address of the caller's choosing.
 *
 * Behind an admin login already, so this is not about strangers — it is that a
 * compromised or careless admin session should not be able to point the shop's
 * own mail server at a list of addresses. Six an hour is more than anybody
 * configuring a mail server needs and far less than anything worth sending.
 */
const testMailLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	limit: 6,
	standardHeaders: true,
	legacyHeaders: false,
})

const router = Router()

// Shop name and support address, for the storefront footer.
router.get("/public", SettingController.listPublic)

router.use(auth("ADMIN", "SHOP_MANAGER"))

router.get("/", SettingController.list)
router.put("/", validateRequest(upsertSchema), SettingController.upsert)
router.post("/mail/test", testMailLimiter, validateRequest(testMailSchema), SettingController.testMail)
// Before `/:key` would also match "mail", which is why the specific route is
// declared first — Express takes the first match, not the best one.
router.delete("/:key", SettingController.remove)

export const SettingRoutes = router
export default router
