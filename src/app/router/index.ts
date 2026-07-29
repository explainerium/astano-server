import { Router } from "express"
import { AuthRoutes } from "../modules/auth/auth.routes"
import { UserRoutes } from "../modules/user/user.routes"

/**
 * Single route registry. Every module registers here and nowhere else.
 *
 * Modules are added as they are built — see §12.6 of ASTANO_REBUILD_SPEC.md for
 * the phase order. Locale is already stripped from the path by resolveLocale,
 * so paths here are language-neutral.
 */
interface ModuleRoute {
	path: string
	route: Router
}

const moduleRoutes: ModuleRoute[] = [
	{ path: "/auth", route: AuthRoutes },
	{ path: "/users", route: UserRoutes },
	// Phase 2: { path: "/products", route: ProductRoutes },
	// Phase 2: { path: "/categories", route: CategoryRoutes },
	// Phase 3: { path: "/cart", route: CartRoutes },
	// Phase 4: { path: "/quotes", route: QuoteRoutes },
]

const router = Router()

for (const { path, route } of moduleRoutes) {
	router.use(path, route)
}

export default router
