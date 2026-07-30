import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { TaxController } from "./tax.controller"
import { TaxValidation } from "./tax.validation"

/**
 * Staff-only throughout. Tax rates are never public: the checkout returns the
 * computed tax for a specific order, not the rate table.
 */
const router = Router()

router.use(auth("ADMIN", "SHOP_MANAGER"))

router.get("/classes", TaxController.listClasses)
router.get("/classes/:id", validateRequest(TaxValidation.idSchema), TaxController.getClass)
router.post("/classes", validateRequest(TaxValidation.createTaxClassSchema), TaxController.createClass)
router.patch("/classes/:id", validateRequest(TaxValidation.updateTaxClassSchema), TaxController.updateClass)
router.delete("/classes/:id", validateRequest(TaxValidation.idSchema), TaxController.removeClass)

router.post("/rates", validateRequest(TaxValidation.createTaxRateSchema), TaxController.createRate)
router.patch("/rates/:id", validateRequest(TaxValidation.updateTaxRateSchema), TaxController.updateRate)
router.delete("/rates/:id", validateRequest(TaxValidation.idSchema), TaxController.removeRate)

export const TaxRoutes = router
export default router
