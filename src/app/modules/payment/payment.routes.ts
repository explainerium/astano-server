import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { optionalAuth } from "../../middlewares/optionalAuth"
import { validateRequest } from "../../middlewares/validateRequest"
import { PaymentController } from "./payment.controller"
import { PaymentValidation } from "./payment.validation"

const router = Router()

// What the current customer may use. optionalAuth because eligibility depends
// on being signed in — that is one of the rules an admin can switch on.
router.get(
	"/available",
	optionalAuth,
	validateRequest(PaymentValidation.availableSchema),
	PaymentController.available
)

router.use(auth("ADMIN", "SHOP_MANAGER"))

router.get("/", PaymentController.list)
router.get("/:id", validateRequest(PaymentValidation.idSchema), PaymentController.getById)
router.post("/", validateRequest(PaymentValidation.createMethodSchema), PaymentController.create)
router.patch("/:id", validateRequest(PaymentValidation.updateMethodSchema), PaymentController.update)
router.delete("/:id", validateRequest(PaymentValidation.idSchema), PaymentController.remove)

export const PaymentRoutes = router
export default router
