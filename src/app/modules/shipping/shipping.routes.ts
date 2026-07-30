import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { ShippingController } from "./shipping.controller"
import { ShippingValidation } from "./shipping.validation"

const router = Router()

// Public — the cart page shows delivery cost before anyone signs in.
router.get("/quote", validateRequest(ShippingValidation.quoteSchema), ShippingController.quote)

router.use(auth("ADMIN", "SHOP_MANAGER"))

router.get("/zones", ShippingController.listZones)
router.get("/zones/:id", validateRequest(ShippingValidation.idSchema), ShippingController.getZone)
router.post("/zones", validateRequest(ShippingValidation.createZoneSchema), ShippingController.createZone)
router.patch("/zones/:id", validateRequest(ShippingValidation.updateZoneSchema), ShippingController.updateZone)
router.delete("/zones/:id", validateRequest(ShippingValidation.idSchema), ShippingController.removeZone)

router.post("/methods", validateRequest(ShippingValidation.createMethodSchema), ShippingController.createMethod)
router.patch("/methods/:id", validateRequest(ShippingValidation.updateMethodSchema), ShippingController.updateMethod)
router.delete("/methods/:id", validateRequest(ShippingValidation.idSchema), ShippingController.removeMethod)

export const ShippingRoutes = router
export default router
