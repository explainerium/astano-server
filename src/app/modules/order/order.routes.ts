import { Router } from "express"
import { auth } from "../../middlewares/auth"
import { validateRequest } from "../../middlewares/validateRequest"
import { InvoiceController } from "../invoice/invoice.controller"
import { OrderController } from "./order.controller"
import { OrderValidation } from "./order.validation"

/**
 * Checkout requires an account — guest checkout is disabled (rule R7). A guest
 * fills a cart freely; the account becomes mandatory only here, and their cart
 * merges across on sign-in so nothing is lost at that moment.
 */
export const CheckoutRoutes = Router()

CheckoutRoutes.use(auth())

CheckoutRoutes.post(
	"/preview",
	validateRequest(OrderValidation.previewSchema),
	OrderController.preview
)

CheckoutRoutes.post("/", validateRequest(OrderValidation.placeOrderSchema), OrderController.place)

/** A customer's own order history. */
export const OrderRoutes = Router()

OrderRoutes.use(auth())

OrderRoutes.get("/", OrderController.listMine)
OrderRoutes.get("/:id", validateRequest(OrderValidation.idSchema), OrderController.getMine)

/** A customer downloads their own invoice; staff download any. */
OrderRoutes.get("/:id/invoice.pdf", validateRequest(OrderValidation.idSchema), InvoiceController.stream)

/** Staff order management. */
export const AdminOrderRoutes = Router()

AdminOrderRoutes.use(auth("ADMIN", "SHOP_MANAGER"))

AdminOrderRoutes.get(
	"/",
	validateRequest(OrderValidation.listOrdersSchema),
	OrderController.adminList
)

AdminOrderRoutes.get("/:id", validateRequest(OrderValidation.idSchema), OrderController.adminGet)

AdminOrderRoutes.get("/:id/invoice.pdf", validateRequest(OrderValidation.idSchema), InvoiceController.stream)

AdminOrderRoutes.patch(
	"/:id/status",
	validateRequest(OrderValidation.updateStatusSchema),
	OrderController.updateStatus
)

export default OrderRoutes
