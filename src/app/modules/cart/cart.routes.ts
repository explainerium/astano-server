import { Router } from "express"
import { optionalAuth } from "../../middlewares/optionalAuth"
import { validateRequest } from "../../middlewares/validateRequest"
import { CartController } from "./cart.controller"
import { CartValidation } from "./cart.validation"

/**
 * Every route is optionalAuth, never auth(): a guest must be able to fill a
 * basket before deciding to register. Checkout is where an account becomes
 * mandatory (rule R7), not the cart.
 */
const router = Router()

router.use(optionalAuth)

router.get("/", CartController.get)

router.post("/items", validateRequest(CartValidation.addItemSchema), CartController.addItem)

router.patch(
	"/items/:id",
	validateRequest(CartValidation.updateItemSchema),
	CartController.updateItem
)

/**
 * Artwork on a line. Signed in only — the file has to belong to somebody for
 * "is this yours?" to have an answer, so a guest cannot attach one even though
 * a guest may otherwise fill a cart.
 */
router.put(
	"/items/:id/files",
	validateRequest(CartValidation.setFilesSchema),
	CartController.setFiles
)

router.delete(
	"/items/:id",
	validateRequest(CartValidation.itemIdSchema),
	CartController.removeItem
)

router.delete("/", CartController.clear)

export const CartRoutes = router
export default router
