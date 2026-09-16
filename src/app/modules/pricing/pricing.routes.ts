import { Router } from "express"
import multer from "multer"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { PriceListIoController } from "./priceListIo.controller"
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

/**
 * The ERP's price list, which is a ladder for every article in one file.
 *
 * In memory, and 20 MB: the client's real export is 492 kB of 12,899 rows, so
 * the limit is about refusing a mistake rather than rationing a real file.
 */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

AdminPricingRoutes.post("/price-list/analyse", upload.single("file"), PriceListIoController.analyse)

// One route for the preview and the real thing, told apart by `dryRun` — a
// preview that runs different code from the import is a preview that can be
// wrong, and the whole point of it is to be believed.
AdminPricingRoutes.post("/price-list/import", upload.single("file"), PriceListIoController.run)

export default AdminPricingRoutes
