import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { ContentController } from "./content.controller"
import { ContentValidation } from "./content.validation"

const router = Router()

/**
 * What the storefront merges over its own message catalogue, per language.
 *
 * Public and unauthenticated, because it is read while rendering a page a
 * signed-out visitor is looking at. It carries nothing that is not already on
 * that page. Declared before the guard below, which is what leaves it open —
 * the same shape the settings module uses for its own public read.
 */
router.get(
	"/public",
	validateRequest(ContentValidation.publicContentSchema),
	ContentController.listPublic
)

/**
 * Editing is ADMIN's, and not SHOP_MANAGER's.
 *
 * Both roles reach /admin, so this is narrower than the dashboard around it —
 * the shop owner asked that only they change what the site says. It is the same
 * distinction user.service.ts already draws when it lets only an ADMIN act on
 * another staff account.
 *
 * This is the guard that matters. The dashboard hides the screen from a
 * SHOP_MANAGER and the storefront hides its edit button, but both of those are
 * courtesies to somebody who cannot use them; a URL typed by hand arrives here.
 */
router.use(auth("ADMIN"))

router.get("/", ContentController.list)
router.put("/", validateRequest(ContentValidation.writeContentSchema), ContentController.save)

export const ContentRoutes = router
export default router
