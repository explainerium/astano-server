import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { AccountController } from "./account.controller"
import { AccountValidation } from "./account.validation"

/** A customer's own account. Everything here is scoped to the signed-in user. */
const router = Router()

router.use(auth())

router.patch(
	"/profile",
	validateRequest(AccountValidation.updateProfileSchema),
	AccountController.updateProfile
)

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
