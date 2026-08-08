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

/*
 * List and edit. No POST, no DELETE.
 *
 * The offline kinds are a closed set — bank transfer, invoice, cash on delivery
 * — created by the list endpoint on first read, like the gateways. There is no
 * "new payment method" because there is no such thing to make: a shop is paid
 * one of those ways or through a provider, and inventing a fourth from a form
 * only produced a row nothing in the checkout knew how to treat.
 *
 * DELETE survives only to clear away a leftover from that old builder. It
 * refuses a built-in kind — switching one off is how you retire it, and
 * deleting it would only have it reappear on the next read — and it refuses
 * anything an order was paid with.
 */
router.get("/", PaymentController.list)
router.get("/:id", validateRequest(PaymentValidation.idSchema), PaymentController.getById)
router.patch("/:id", validateRequest(PaymentValidation.updateMethodSchema), PaymentController.update)

// Only ever removes a leftover from the old builder: the service refuses a
// built-in kind and refuses anything an order was paid with.
router.delete("/:id", validateRequest(PaymentValidation.idSchema), PaymentController.remove)

export const PaymentRoutes = router
export default router
