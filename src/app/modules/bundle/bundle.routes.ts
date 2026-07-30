import { Router } from "express"
import { optionalAuth } from "../../middlewares/optionalAuth"
import { validateRequest } from "../../middlewares/validateRequest"
import { BundleController } from "./bundle.controller"
import { BundleValidation } from "./bundle.validation"

/**
 * The configurator. optionalAuth because prices differ per role and a guest
 * must be able to configure and add before deciding to register.
 */
const router = Router()

router.use(optionalAuth)

router.post("/price", validateRequest(BundleValidation.priceSchema), BundleController.price)

router.post(
	"/add-to-cart",
	validateRequest(BundleValidation.addToCartSchema),
	BundleController.addToCart
)

export const BundleRoutes = router
export default router
