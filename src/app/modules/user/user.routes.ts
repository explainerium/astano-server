import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { UserController } from "./user.controller"
import { UserValidation } from "./user.validation"

/**
 * Every account, whatever its role — one screen's worth of API.
 *
 * Staff-only in its entirety, and guarded by role AND status, so a PENDING
 * account can never reach the approval queue including its own row.
 *
 * Two permission levels inside that. A shop manager runs the customer base:
 * approve, suspend, draft, delete. Only an admin changes a role or destroys a
 * row, because a role decides what somebody pays and a destroyed row cannot be
 * argued with. The service enforces the rest — nobody moderates their own
 * account, only an admin touches a staff one, and the shop always keeps a
 * working administrator.
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

// ── Dealer decision ─────────────────────────────────────────────────────────
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

// ── Moderation ──────────────────────────────────────────────────────────────
router.patch(
	"/:id/status",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(UserValidation.setStatusSchema),
	UserController.setStatus
)

/** Reversible. DELETE, because that is what it means to everyone using it. */
router.delete(
	"/:id",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(UserValidation.userIdSchema),
	UserController.softDelete
)

router.patch(
	"/:id/restore",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(UserValidation.userIdSchema),
	UserController.restore
)

/**
 * Irreversible, and ADMIN only.
 *
 * A separate path rather than a flag on the DELETE above: a destructive
 * operation should not be one mistyped query parameter away from the recoverable
 * one.
 */
router.delete(
	"/:id/permanent",
	auth("ADMIN"),
	validateRequest(UserValidation.userIdSchema),
	UserController.purge
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
