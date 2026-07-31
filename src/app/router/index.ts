import { Router } from "express"
import { AccountRoutes } from "../modules/account/account.routes"
import { AdminB2bRoutes, B2bRoutes } from "../modules/b2bApplication/b2bApplication.routes"
import { AdminContactRoutes, ContactRoutes } from "../modules/contact/contact.routes"
import { AdminNewsletterRoutes, NewsletterRoutes } from "../modules/newsletter/newsletter.routes"
import { WishlistRoutes } from "../modules/wishlist/wishlist.routes"
import { AdminAttributeRoutes, AttributeRoutes } from "../modules/attribute/attribute.routes"
import { AuthRoutes } from "../modules/auth/auth.routes"
import { BundleRoutes } from "../modules/bundle/bundle.routes"
import { CartRoutes } from "../modules/cart/cart.routes"
import { AdminCategoryRoutes, CategoryRoutes } from "../modules/category/category.routes"
import { MediaRoutes } from "../modules/media/media.routes"
import { AdminProductRoutes, ProductRoutes } from "../modules/product/product.routes"
import { AdminOrderRoutes, CheckoutRoutes, OrderRoutes } from "../modules/order/order.routes"
import { PaymentRoutes } from "../modules/payment/payment.routes"
import { AdminQuoteRoutes, QuoteRoutes } from "../modules/quote/quote.routes"
import { SettingRoutes } from "../modules/setting/setting.routes"
import { ShippingRoutes } from "../modules/shipping/shipping.routes"
import { TaxRoutes } from "../modules/tax/tax.routes"
import { VatRoutes } from "../modules/user/vat.routes"
import { UserRoutes } from "../modules/user/user.routes"

/**
 * Single route registry. Every module registers here and nowhere else.
 *
 * Locale is already stripped from the path by resolveLocale, so paths are
 * language-neutral: /de/api/v1/products and /api/v1/products reach the same
 * handler and differ only in req.locale.
 */
interface ModuleRoute {
	path: string
	route: Router
}

const moduleRoutes: ModuleRoute[] = [
	{ path: "/auth", route: AuthRoutes },
	{ path: "/users", route: UserRoutes },
	{ path: "/vat", route: VatRoutes },
	{ path: "/account", route: AccountRoutes },
	{ path: "/b2b", route: B2bRoutes },
	{ path: "/admin/b2b", route: AdminB2bRoutes },
	{ path: "/settings", route: SettingRoutes },
	{ path: "/categories", route: CategoryRoutes },
	{ path: "/admin/categories", route: AdminCategoryRoutes },
	{ path: "/attributes", route: AttributeRoutes },
	{ path: "/admin/attributes", route: AdminAttributeRoutes },
	{ path: "/products", route: ProductRoutes },
	{ path: "/admin/products", route: AdminProductRoutes },
	{ path: "/media", route: MediaRoutes },
	{ path: "/cart", route: CartRoutes },
	{ path: "/configure", route: BundleRoutes },
	{ path: "/shipping", route: ShippingRoutes },
	{ path: "/payment-methods", route: PaymentRoutes },
	{ path: "/admin/tax", route: TaxRoutes },
	{ path: "/checkout", route: CheckoutRoutes },
	{ path: "/orders", route: OrderRoutes },
	{ path: "/admin/orders", route: AdminOrderRoutes },
	{ path: "/quotes", route: QuoteRoutes },
	{ path: "/admin/quotes", route: AdminQuoteRoutes },
	{ path: "/wishlist", route: WishlistRoutes },
	{ path: "/contact", route: ContactRoutes },
	{ path: "/admin/contact", route: AdminContactRoutes },
	{ path: "/newsletter", route: NewsletterRoutes },
	{ path: "/admin/newsletter", route: AdminNewsletterRoutes },
]

const router = Router()

for (const { path, route } of moduleRoutes) {
	router.use(path, route)
}

export default router
