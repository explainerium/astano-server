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

/**
 * The home page's strip. Declared before `/:id`, and that ordering is the
 * whole of why it works — Express matches in order, so `/top` reaching a route
 * that reads `req.params.id` would look up a product with the id "top" and
 * answer 404 for a path that is not an id at all.
 */
AdminProductRoutes.get("/top", ProductController.topList)

AdminProductRoutes.put(
	"/top",
	validateRequest(ProductValidation.setTopProductsSchema),
	ProductController.saveTop
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
