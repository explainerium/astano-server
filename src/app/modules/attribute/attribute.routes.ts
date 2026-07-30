import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { AttributeController } from "./attribute.controller"
import { AttributeValidation } from "./attribute.validation"

const router = Router()

// Public: the shop needs these to render variant pickers and filters.
router.get("/", validateRequest(AttributeValidation.listAttributesSchema), AttributeController.list)

router.get(
	"/:id",
	validateRequest(AttributeValidation.attributeIdSchema),
	AttributeController.getById
)

router.post(
	"/",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(AttributeValidation.createAttributeSchema),
	AttributeController.create
)

router.patch(
	"/:id",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(AttributeValidation.updateAttributeSchema),
	AttributeController.update
)

router.delete(
	"/:id",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(AttributeValidation.attributeIdSchema),
	AttributeController.remove
)

router.delete(
	"/values/:id",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(AttributeValidation.attributeIdSchema),
	AttributeController.removeValue
)

export const AttributeRoutes = router
export default router
