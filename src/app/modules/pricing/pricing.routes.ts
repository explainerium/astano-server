import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { PricingController } from "./pricing.controller"
import { PricingValidation } from "./pricing.validation"

/**
 * Ladders that are not part of a product, plus the setting that decides which
 * ladder wins.
 *
 * Staff-only in its entirety. A customer's negotiated price is exactly the kind
 * of thing that must not be readable by another customer, so there is no public
 * counterpart to any of these — the shop sees the resolved price and never the
 * rule behind it.
 */
export const AdminPricingRoutes = Router()

AdminPricingRoutes.use(auth("ADMIN", "SHOP_MANAGER"))

AdminPricingRoutes.get(
	"/categories/:id/tiers",
	validateRequest(PricingValidation.categoryIdSchema),
	PricingController.categoryTiers
)

// PUT, not PATCH: the body is the complete ladder for that role and replaces
// what is stored. A ladder is read as a whole, so editing it a rung at a time
// would let a half-saved screen leave a shape nobody intended.
AdminPricingRoutes.put(
	"/categories/:id/tiers",
	validateRequest(PricingValidation.setCategoryTiersSchema),
	PricingController.saveCategoryTiers
)

AdminPricingRoutes.get(
	"/customers/:id/tiers",
	validateRequest(PricingValidation.customerIdSchema),
	PricingController.customerTiers
)

AdminPricingRoutes.put(
	"/customers/:id/tiers",
	validateRequest(PricingValidation.setCustomerTiersSchema),
	PricingController.saveCustomerTiers
)

AdminPricingRoutes.get("/tier-priority", PricingController.tierPriority)
AdminPricingRoutes.put("/tier-priority", PricingController.saveTierPriority)

export default AdminPricingRoutes
