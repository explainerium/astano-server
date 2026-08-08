import { Router } from "express"
import { auth, authAccount } from "../../middlewares/auth"
import { optionalAuth } from "../../middlewares/optionalAuth"
import { writeLimiter } from "../../middlewares/rateLimiter"
import { validateRequest } from "../../middlewares/validateRequest"
import { QuoteController } from "./quote.controller"
import { QuoteValidation } from "./quote.validation"
import { QuoteConvertRoutes } from "./quoteConvert.routes"

/**
 * The inquiry basket and quote threads.
 *
 * Unlike checkout, a GUEST may submit a quote (R15 vs R7) — they are answered
 * by email and reach their thread through a token from that email. That is the
 * whole reason this cannot be folded into the cart.
 */
export const QuoteRoutes = Router()

QuoteRoutes.use(optionalAuth)

// ── basket ───────────────────────────────────────────────────────────────────
QuoteRoutes.get("/basket", QuoteController.getBasket)
QuoteRoutes.post("/basket/items", validateRequest(QuoteValidation.addItemSchema), QuoteController.addItem)
QuoteRoutes.patch("/basket/items/:id", validateRequest(QuoteValidation.updateItemSchema), QuoteController.updateItem)
QuoteRoutes.delete("/basket/items/:id", validateRequest(QuoteValidation.itemIdSchema), QuoteController.removeItem)
QuoteRoutes.delete("/basket", QuoteController.clearBasket)

QuoteRoutes.post("/basket/submit", writeLimiter, validateRequest(QuoteValidation.submitSchema), QuoteController.submit)

// Accepting a quote turns it into an order.
QuoteRoutes.use("/", QuoteConvertRoutes)

// ── guest access by emailed token ────────────────────────────────────────────
QuoteRoutes.get("/by-token", QuoteController.getByToken)

// ── a signed-in customer's own threads ───────────────────────────────────────
// Readable while suspended — an open negotiation is theirs to see. Replying is
// not: a message in a quote thread is part of agreeing a price, which is
// exactly what suspension stops.
QuoteRoutes.get("/", authAccount(), QuoteController.listMine)
QuoteRoutes.get("/:id", authAccount(), validateRequest(QuoteValidation.idSchema), QuoteController.getMine)
QuoteRoutes.post(
	"/:id/messages",
	auth(),
	validateRequest(QuoteValidation.replySchema),
	QuoteController.customerReply
)

/** Staff quote management. */
export const AdminQuoteRoutes = Router()

AdminQuoteRoutes.use(auth("ADMIN", "SHOP_MANAGER"))

AdminQuoteRoutes.get("/", validateRequest(QuoteValidation.listSchema), QuoteController.adminList)
AdminQuoteRoutes.get("/:id", validateRequest(QuoteValidation.idSchema), QuoteController.adminGet)
AdminQuoteRoutes.patch("/:id", validateRequest(QuoteValidation.quoteUpdateSchema), QuoteController.adminUpdate)
AdminQuoteRoutes.post(
	"/:id/messages",
	validateRequest(QuoteValidation.replySchema),
	QuoteController.staffReply
)

export default QuoteRoutes
