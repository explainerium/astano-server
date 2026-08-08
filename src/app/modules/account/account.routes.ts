import { Router } from "express"
import { authAccount } from "../../middlewares/auth"
import { writeLimiter } from "../../middlewares/rateLimiter"
import { validateRequest } from "../../middlewares/validateRequest"
import { AccountController } from "./account.controller"
import { AccountValidation } from "./account.validation"

/**
 * A customer's own account. Everything here is scoped to the signed-in user.
 *
 * `authAccount`, not `auth`: a suspended customer keeps their own account.
 * Nothing on this router buys anything or creates an obligation — it is their
 * details and their address book — so shutting them out of it would only stop
 * them fixing whatever the suspension is about.
 */
const router = Router()

/*
 * Before the guard, and it has to be.
 *
 * The confirmation link is opened wherever the mailbox is — often a phone, often
 * not the browser that made the request. The token in the URL is the
 * authorisation; requiring a session as well would mean the link silently
 * failing for most of the people who use it.
 */
router.post(
	"/email/verify",
	writeLimiter,
	validateRequest(AccountValidation.verifyEmailChangeSchema),
	AccountController.verifyEmailChange
)

router.use(authAccount())

router.patch(
	"/profile",
	validateRequest(AccountValidation.updateProfileSchema),
	AccountController.updateProfile
)

// ── Email change ────────────────────────────────────────────────────────────
// Rate limited: it takes a password, so unlimited attempts would make this a
// quiet way to guess one.
router.post(
	"/email",
	writeLimiter,
	validateRequest(AccountValidation.requestEmailChangeSchema),
	AccountController.requestEmailChange
)

router.get("/email/pending", AccountController.pendingEmailChange)
router.delete("/email/pending", AccountController.cancelEmailChange)

router.get("/addresses", AccountController.listAddresses)
router.get("/addresses/:id", validateRequest(AccountValidation.idSchema), AccountController.getAddress)
router.post(
	"/addresses",
	validateRequest(AccountValidation.createAddressSchema),
	AccountController.createAddress
)
router.patch(
	"/addresses/:id",
	validateRequest(AccountValidation.updateAddressSchema),
	AccountController.updateAddress
)
router.delete(
	"/addresses/:id",
	validateRequest(AccountValidation.idSchema),
	AccountController.removeAddress
)

export const AccountRoutes = router
export default router
