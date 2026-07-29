import { Router } from "express"
import { AuthRoutes } from "../modules/auth/auth.routes"
import { CategoryRoutes } from "../modules/category/category.routes"
import { AdminProductRoutes, ProductRoutes } from "../modules/product/product.routes"
import { UserRoutes } from "../modules/user/user.routes"

/**
 * Single route registry. Every module registers here and nowhere else.
 *
 * Locale is already stripped from the path by resolveLocale, so paths are
 * language-neutral: /de/api/v1/products and /api/v1/products reach the same
 * handler and differ only in req.locale.
 */
interface ModuleRoute {
	path: string
	route: Router
}

const moduleRoutes: ModuleRoute[] = [
	{ path: "/auth", route: AuthRoutes },
	{ path: "/users", route: UserRoutes },
	{ path: "/categories", route: CategoryRoutes },
	{ path: "/products", route: ProductRoutes },
	{ path: "/admin/products", route: AdminProductRoutes },
	// Phase 3: { path: "/cart", route: CartRoutes },
	// Phase 4: { path: "/quotes", route: QuoteRoutes },
]

const router = Router()

for (const { path, route } of moduleRoutes) {
	router.use(path, route)
}

export default router
