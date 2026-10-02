import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { AttributeController } from "./attribute.controller"
import { AttributeValidation } from "./attribute.validation"

const router = Router()

// Public: the shop needs these to render variant pickers and filters.
//
// No filter for "variant axes only" — whether an attribute builds variants is a
// per-product fact (ProductAttribute.isVariation), not a property of the
// attribute, so the question cannot be answered from this list alone.
router.get("/", AttributeController.list)

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

// An attribute typed into a product by name; the code is made from it.
// Registered before "/:id/…" routes only by habit — the paths cannot collide.
router.post(
	"/quick",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(AttributeValidation.addByNameSchema),
	AttributeController.addByName
)

// POST, not PATCH: it creates a new attribute, values and all. No body —
// everything the copy needs is already on the original.
router.post(
	"/:id/duplicate",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(AttributeValidation.attributeIdSchema),
	AttributeController.duplicate
)

// A value typed into a product's Attributes tab rather than picked from the
// list. Joins the list, so the next product finds it.
router.post(
	"/:id/values",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(AttributeValidation.addValueSchema),
	AttributeController.addValue
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

/**
 * Staff reads, mirroring /admin/categories and /admin/products. Separate from
 * the public routes because the payload differs, not just the permission.
 */
const adminRouter = Router()

adminRouter.use(auth("ADMIN", "SHOP_MANAGER"))

adminRouter.get("/", AttributeController.adminList)

adminRouter.get(
	"/:id",
	validateRequest(AttributeValidation.attributeIdSchema),
	AttributeController.adminGetById
)

export const AdminAttributeRoutes = adminRouter
export const AttributeRoutes = router
export default router
