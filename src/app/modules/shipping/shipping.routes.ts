import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { ShippingController } from "./shipping.controller"
import { ShippingValidation } from "./shipping.validation"

const router = Router()

// Public — the cart page shows delivery cost before anyone signs in.
router.get("/quote", validateRequest(ShippingValidation.quoteSchema), ShippingController.quote)

/**
 * Public — every country dropdown in the storefront reads this.
 *
 * It has to be public and it has to come from the zones: without it the
 * frontend had nowhere to look and kept its own hardcoded list, which drifted
 * away from the admin's configuration in both directions. One source, no drift.
 */
router.get("/countries", ShippingController.countries)

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
