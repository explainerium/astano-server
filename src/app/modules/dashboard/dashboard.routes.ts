import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { DashboardController } from "./dashboard.controller"
import { DashboardValidation } from "./dashboard.validation"

/**
 * The admin landing screen's figures.
 *
 * Staff-only, and read-only — revenue, the review queue and who bought what are
 * exactly the things a customer must never be able to ask for.
 */
export const AdminDashboardRoutes = Router()

AdminDashboardRoutes.use(auth("ADMIN", "SHOP_MANAGER"))

AdminDashboardRoutes.get(
	"/summary",
	validateRequest(DashboardValidation.summarySchema),
	DashboardController.summary
)

export default AdminDashboardRoutes
