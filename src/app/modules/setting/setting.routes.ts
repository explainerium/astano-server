import { Router } from "express"
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

const router = Router()

// Shop name and support address, for the storefront footer.
router.get("/public", SettingController.listPublic)

router.use(auth("ADMIN", "SHOP_MANAGER"))

router.get("/", SettingController.list)
router.put("/", validateRequest(upsertSchema), SettingController.upsert)
router.delete("/:key", SettingController.remove)

export const SettingRoutes = router
export default router
