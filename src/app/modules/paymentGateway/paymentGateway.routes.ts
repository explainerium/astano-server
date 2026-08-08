import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { writeLimiter } from "../../middlewares/rateLimiter"
import { validateRequest } from "../../middlewares/validateRequest"
import { PaymentGatewayController } from "./paymentGateway.controller"
import { PaymentGatewayValidation } from "./paymentGateway.validation"

/**
 * Payment provider configuration.
 *
 * ADMIN only, not shop manager. These endpoints accept the keys that move the
 * shop's money — a shop manager can decide who may pay by invoice, but
 * connecting the account the money lands in is the owner's decision.
 *
 * Nothing here ever returns a stored secret. Credentials go in; masks come out.
 */
export const AdminPaymentGatewayRoutes = Router()

AdminPaymentGatewayRoutes.use(auth("ADMIN"))

AdminPaymentGatewayRoutes.get("/", PaymentGatewayController.list)

AdminPaymentGatewayRoutes.get(
	"/:provider",
	validateRequest(PaymentGatewayValidation.providerParamSchema),
	PaymentGatewayController.getOne
)

AdminPaymentGatewayRoutes.put(
	"/:provider/credentials",
	writeLimiter,
	validateRequest(PaymentGatewayValidation.saveCredentialsSchema),
	PaymentGatewayController.saveCredentials
)

// Rate limited: it makes an outbound call to the provider on every press, and
// a stuck button should not turn into a hundred requests against Stripe.
AdminPaymentGatewayRoutes.post(
	"/:provider/test",
	writeLimiter,
	validateRequest(PaymentGatewayValidation.testConnectionSchema),
	PaymentGatewayController.testConnection
)

AdminPaymentGatewayRoutes.patch(
	"/:provider",
	validateRequest(PaymentGatewayValidation.updateSettingsSchema),
	PaymentGatewayController.updateSettings
)

export default AdminPaymentGatewayRoutes
