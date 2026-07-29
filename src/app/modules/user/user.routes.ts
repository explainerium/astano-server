import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { UserController } from "./user.controller"
import { UserValidation } from "./user.validation"

/**
 * Staff-only. Every route here is guarded by role AND status, so a PENDING
 * account can never reach the approval queue — including its own row.
 */
const router = Router()

router.get(
	"/",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(UserValidation.listUsersSchema),
	UserController.list
)

router.get(
	"/:id",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(UserValidation.userIdSchema),
	UserController.getById
)

router.patch(
	"/:id/approve",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(UserValidation.userIdSchema),
	UserController.approve
)

router.patch(
	"/:id/reject",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(UserValidation.userIdSchema),
	UserController.reject
)

// Changing a role can grant wholesale pricing, so it is ADMIN only.
router.patch(
	"/:id/role",
	auth("ADMIN"),
	validateRequest(UserValidation.setRoleSchema),
	UserController.setRole
)

export const UserRoutes = router
export default router
