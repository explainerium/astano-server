import { Router } from "express"
import rateLimit from "express-rate-limit"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { AuthController } from "./auth.controller"
import { AuthValidation } from "./auth.validation"

/**
 * Credential endpoints are rate limited per IP. Login and password reset are
 * the two places an attacker gets unlimited free guesses otherwise.
 * express-rate-limit v8 API — do not copy a v7 config into this.
 */
const credentialLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 10,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	message: {
		success: false,
		statusCode: 429,
		message: "Too many attempts. Please try again shortly.",
	},
})

const router = Router()

router.post(
	"/register",
	credentialLimiter,
	validateRequest(AuthValidation.registerSchema),
	AuthController.register
)

router.post(
	"/login",
	credentialLimiter,
	validateRequest(AuthValidation.loginSchema),
	AuthController.login
)

router.post("/refresh", validateRequest(AuthValidation.refreshSchema), AuthController.refresh)

router.post("/logout", AuthController.logout)

router.get("/me", auth(), AuthController.me)

router.post(
	"/forgot-password",
	credentialLimiter,
	validateRequest(AuthValidation.forgotPasswordSchema),
	AuthController.forgotPassword
)

router.post(
	"/reset-password",
	credentialLimiter,
	validateRequest(AuthValidation.resetPasswordSchema),
	AuthController.resetPassword
)

router.patch(
	"/change-password",
	auth(),
	validateRequest(AuthValidation.changePasswordSchema),
	AuthController.changePassword
)

export const AuthRoutes = router
export default router
