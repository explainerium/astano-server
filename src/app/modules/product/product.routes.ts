import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { optionalAuth } from "../../middlewares/optionalAuth"
import { validateRequest } from "../../middlewares/validateRequest"
import { ProductController } from "./product.controller"
import { ProductValidation } from "./product.validation"

/** Public catalogue. optionalAuth so prices resolve per role. */
export const ProductRoutes = Router()

ProductRoutes.get(
	"/",
	optionalAuth,
	validateRequest(ProductValidation.listProductsSchema),
	ProductController.list
)

ProductRoutes.get("/:slug", optionalAuth, ProductController.getBySlug)

/** Staff catalogue management. Mounted separately at /admin/products. */
export const AdminProductRoutes = Router()

AdminProductRoutes.use(auth("ADMIN", "SHOP_MANAGER"))

AdminProductRoutes.get(
	"/",
	validateRequest(ProductValidation.adminListProductsSchema),
	ProductController.adminList
)

AdminProductRoutes.get(
	"/:id",
	validateRequest(ProductValidation.productIdSchema),
	ProductController.adminGetById
)

AdminProductRoutes.post(
	"/",
	validateRequest(ProductValidation.createProductSchema),
	ProductController.create
)

// POST, not PATCH: it creates a new product. The body is empty — everything the
// copy needs is already on the original.
AdminProductRoutes.post(
	"/:id/duplicate",
	validateRequest(ProductValidation.productIdSchema),
	ProductController.duplicate
)

AdminProductRoutes.patch(
	"/:id",
	validateRequest(ProductValidation.updateProductSchema),
	ProductController.update
)

AdminProductRoutes.delete(
	"/:id",
	validateRequest(ProductValidation.productIdSchema),
	ProductController.remove
)

export default ProductRoutes
