import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { optionalAuth } from "../../middlewares/optionalAuth"
import { validateRequest } from "../../middlewares/validateRequest"
import { CategoryController } from "./category.controller"
import { CategoryValidation } from "./category.validation"

const router = Router()

// Public reads. optionalAuth lets staff see hidden categories through the same
// endpoint without a second route.
router.get(
	"/",
	optionalAuth,
	validateRequest(CategoryValidation.listCategoriesSchema),
	CategoryController.list
)

router.get("/:slug", CategoryController.getBySlug)

// Staff writes.
router.post(
	"/",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(CategoryValidation.createCategorySchema),
	CategoryController.create
)

router.patch(
	"/:id",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(CategoryValidation.updateCategorySchema),
	CategoryController.update
)

router.delete(
	"/:id",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(CategoryValidation.categoryIdSchema),
	CategoryController.remove
)

/**
 * Staff reads, mirroring the /admin/products pattern.
 *
 * Separate from the public routes because the payload is different, not just
 * the permission: these return every translation so the editor can show the
 * German name alongside the English one.
 */
const adminRouter = Router()

adminRouter.use(auth("ADMIN", "SHOP_MANAGER"))

adminRouter.get("/", CategoryController.adminList)

adminRouter.get(
	"/:id",
	validateRequest(CategoryValidation.categoryIdSchema),
	CategoryController.adminGetById
)

export const AdminCategoryRoutes = adminRouter
export const CategoryRoutes = router
export default router
