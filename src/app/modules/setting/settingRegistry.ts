/**
 * Every setting the shop understands, with enough about each one for the admin
 * screen to render it and for the rest of the app to read it safely.
 *
 * Was a flat `key → description` map, which meant every setting rendered as a
 * text box. That is fine for a company address and wrong for "how many decimal
 * places" or "redirect to the cart after adding" — a free-text field for a
 * boolean invites `"true"`, `"yes"`, `"1"` and `"Ja"` into the same column.
 *
 * `isPublic` decides what the storefront may read without signing in. Currency
 * formatting has to be public, because every price on every page is formatted
 * with it; a supplier's purchase price never is.
 */

/**
 * `country` and `countries` carry no options — the frontend already has the
 * ISO-3166 list with localized labels, and shipping two hundred entries down
 * the wire with every settings read to duplicate it would be silly.
 */
export type SettingType =
	| "text"
	| "number"
	| "boolean"
	| "select"
	| "country"
	| "countries"
	/** Hex only. Validated again on read — these land inside style attributes. */
	| "color"

export interface SettingDefinition {
	label: string
	/** Shown under the field. Say what it changes, not what it is. */
	help?: string
	type: SettingType
	/** For `select`. Value is what is stored. */
	options?: { value: string; label: string }[]
	/** Used when nothing is stored — so a fresh shop behaves sensibly. */
	fallback: string | number | boolean | string[]
	/** Readable by the storefront without authentication. */
	isPublic?: boolean
	group: string
}

export const SETTING_GROUPS = [
	{ key: "company", title: "Company", blurb: "Printed on invoices and in every email." },
	{ key: "invoice", title: "Invoices", blurb: "How invoices are numbered and signed off." },
	{ key: "mail", title: "Email", blurb: "Who transactional mail comes from and goes to." },
	{
		key: "email",
		title: "Email appearance",
		blurb: "The logo, colours and footer on every message the shop sends.",
	},
	{
		key: "currency",
		title: "Currency & formatting",
		blurb: "How every price on the site is written.",
	},
	{
		key: "units",
		title: "Units",
		blurb: "Weights and dimensions, as entered and as shown.",
	},
	{
		key: "stock",
		title: "Stock",
		blurb: "When to warn, and who to warn.",
	},
	{
		key: "cart",
		title: "Cart & shop",
		blurb: "What happens after adding to the basket, and how the grid is laid out.",
	},
	{
		key: "selling",
		title: "Selling locations",
		blurb: "Where the shop will take an order from.",
	},
	{ key: "pricing", title: "Pricing", blurb: "Which quantity ladder wins." },
	{
		key: "features",
		title: "Features",
		blurb: "Parts of the shop that can be switched off entirely.",
	},
]

export const SETTINGS: Record<string, SettingDefinition> = {
	// ── Company ────────────────────────────────────────────────────────────
	"company.name": { label: "Legal entity on invoices", type: "text", fallback: "", group: "company" },
	"company.street": { label: "Street address", type: "text", fallback: "", group: "company" },
	"company.postcode": { label: "Postcode", type: "text", fallback: "", group: "company" },
	"company.city": { label: "City", type: "text", fallback: "", group: "company" },
	"company.countryCode": { label: "ISO country code", type: "text", fallback: "DE", group: "company" },
	"company.vatId": { label: "VAT identification number", type: "text", fallback: "", group: "company" },
	"company.registerNumber": { label: "Commercial register number", type: "text", fallback: "", group: "company" },
	"company.email": {
		label: "Contact address shown to customers",
		type: "text",
		fallback: "",
		isPublic: true,
		group: "company",
	},
	"company.phone": { label: "Contact phone", type: "text", fallback: "", isPublic: true, group: "company" },
	"company.website": { label: "Shop URL", type: "text", fallback: "", isPublic: true, group: "company" },

	// ── Invoices ───────────────────────────────────────────────────────────
	"invoice.footer": {
		label: "Invoice footer",
		help: "Free text printed at the foot of every invoice.",
		type: "text",
		fallback: "",
		group: "invoice",
	},
	"invoice.numberPrefix": { label: "Invoice number prefix", type: "text", fallback: "AST-", group: "invoice" },

	// ── Email ──────────────────────────────────────────────────────────────
	"mail.fromName": { label: "Display name on outgoing email", type: "text", fallback: "", group: "mail" },
	"mail.fromAddress": { label: "From address on outgoing email", type: "text", fallback: "", group: "mail" },
	// ── Email appearance ───────────────────────────────────────────────────
	"email.headerImage": {
		label: "Header logo URL",
		help: "Shown at the top of every email. Must be a full https:// address — an inbox cannot resolve a path from your own site. Leave empty to print the company name instead.",
		type: "text",
		fallback: "",
		group: "email",
	},
	"email.baseColour": {
		label: "Button colour",
		help: "Buttons and links. Text on top is set to black or white automatically, whichever is readable.",
		type: "color",
		fallback: "#272727",
		group: "email",
	},
	"email.backgroundColour": {
		label: "Page background",
		type: "color",
		fallback: "#f5f5f5",
		group: "email",
	},
	"email.bodyBackgroundColour": {
		label: "Message background",
		help: "The card the message sits on.",
		type: "color",
		fallback: "#ffffff",
		group: "email",
	},
	"email.textColour": {
		label: "Text colour",
		type: "color",
		fallback: "#272727",
		group: "email",
	},
	"email.footerText": {
		label: "Footer text",
		help: "Replaces the company address at the bottom of every email. Leave empty to keep the address.",
		type: "text",
		fallback: "",
		group: "email",
	},

	"mail.adminNotifyAddress": {
		label: "Where new orders and quote requests are announced",
		type: "text",
		fallback: "",
		group: "mail",
	},

	// ── Currency & formatting ──────────────────────────────────────────────
	"currency.code": {
		label: "Currency",
		help: "ISO 4217. Frozen onto every order, so changing it does not rewrite past ones.",
		type: "text",
		fallback: "EUR",
		isPublic: true,
		group: "currency",
	},
	/**
	 * A locale rather than four separate switches.
	 *
	 * WooCommerce splits this into symbol position, thousands separator, decimal
	 * separator and decimal count — four fields that can be combined into
	 * nonsense. A locale is one choice that gets all four right, and Intl already
	 * knows the conventions.
	 *
	 * The live shop is set to the US pattern (€1,234.56) on a German store, which
	 * §3.1 flags as probably a misconfiguration. German is the default here; the
	 * old behaviour is one selection away.
	 */
	"currency.locale": {
		label: "Number format",
		help: "German writes 1.234,56 € — the live WordPress shop is set to the English pattern, which §3.1 flags as likely a mistake.",
		type: "select",
		options: [
			{ value: "de-DE", label: "German — 1.234,56 €" },
			{ value: "en-GB", label: "English — €1,234.56" },
			{ value: "fr-FR", label: "French — 1 234,56 €" },
		],
		fallback: "de-DE",
		isPublic: true,
		group: "currency",
	},
	"currency.decimals": {
		label: "Decimal places",
		type: "number",
		fallback: 2,
		isPublic: true,
		group: "currency",
	},

	// ── Units ──────────────────────────────────────────────────────────────
	"units.weight": {
		label: "Weight unit",
		// Display only, and the help says so. Weights are stored in kilograms and
		// shipping bands are matched in kilograms; if this setting rewrote the
		// number instead of converting it, moving the shop to grams would price
		// a 0.5 kg pan as 0.5 g worth of postage.
		help: "How weights are shown to customers. Weights are stored and shipped in kilograms either way.",
		type: "select",
		options: [
			{ value: "kg", label: "Kilograms (kg)" },
			{ value: "g", label: "Grams (g)" },
			{ value: "lb", label: "Pounds (lb)" },
		],
		fallback: "kg",
		isPublic: true,
		group: "units",
	},
	"units.dimension": {
		label: "Dimension unit",
		help: "How sizes are shown to customers. Stored in centimetres either way.",
		type: "select",
		options: [
			{ value: "cm", label: "Centimetres (cm)" },
			{ value: "mm", label: "Millimetres (mm)" },
			{ value: "in", label: "Inches (in)" },
		],
		fallback: "cm",
		isPublic: true,
		group: "units",
	},

	// ── Stock ──────────────────────────────────────────────────────────────
	"stock.lowThreshold": {
		label: "Low stock warning at",
		help: "Products at or below this appear in the low-stock list. The live shop uses 2.",
		type: "number",
		fallback: 2,
		group: "stock",
	},
	"stock.outOfStockThreshold": {
		label: "Out of stock at",
		help: "Stock at or below this counts as unavailable. Usually 0.",
		type: "number",
		fallback: 0,
		group: "stock",
	},
	"stock.notifyAddress": {
		label: "Send stock warnings to",
		help: "Leave blank to use the admin notification address.",
		type: "text",
		fallback: "",
		group: "stock",
	},

	// ── Cart & shop ────────────────────────────────────────────────────────
	"cart.redirectAfterAdd": {
		label: "Go to the cart after adding a product",
		help: "The live shop does. Off keeps the customer on the page they were browsing.",
		type: "boolean",
		fallback: false,
		isPublic: true,
		group: "cart",
	},
	"shop.productsPerPage": {
		label: "Products per page",
		type: "number",
		fallback: 12,
		isPublic: true,
		group: "cart",
	},
	"shop.productColumns": {
		label: "Products per row",
		help: "On a full-width desktop grid. Narrower screens always show fewer.",
		type: "select",
		options: [
			{ value: "2", label: "2" },
			{ value: "3", label: "3" },
			{ value: "4", label: "4" },
		],
		fallback: "3",
		isPublic: true,
		group: "cart",
	},

	// ── Selling locations ──────────────────────────────────────────────────
	/**
	 * Which countries may appear in the checkout's country field.
	 *
	 * Distinct from the shipping zones, which decide where a parcel can go and
	 * what it costs. This decides whether an order can be placed at all — a shop
	 * may sell to a country it does not itself ship to (collection, a forwarder),
	 * and must be able to refuse one it has no licence to trade with.
	 *
	 * Enforced at placement, not only in the dropdown. A setting the server does
	 * not check is decoration.
	 */
	"selling.locations": {
		label: "Sell to",
		type: "select",
		options: [
			{ value: "all", label: "All countries" },
			{ value: "all_except", label: "All countries except those listed below" },
			{ value: "specific", label: "Only the countries listed below" },
		],
		fallback: "all",
		isPublic: true,
		group: "selling",
	},
	"selling.countries": {
		label: "Countries",
		help: "Only used by the two options above that mention a list. Ignored when selling to all.",
		type: "countries",
		fallback: [],
		isPublic: true,
		group: "selling",
	},
	"selling.defaultCountry": {
		label: "Preselected country at checkout",
		help: "Saves most customers a step. Leave blank to make them choose.",
		type: "country",
		fallback: "DE",
		isPublic: true,
		group: "selling",
	},

	// ── Features ───────────────────────────────────────────────────────────
	"tax.enabled": {
		label: "Charge tax",
		/*
		 * The warning is the point of this field.
		 *
		 * Turning it off does not "simplify" anything — it issues every invoice
		 * with no VAT, which for a German business is an under-declaration that
		 * has to be unpicked with the tax office afterwards. The cases people
		 * usually reach for this switch for are already handled: Switzerland is a
		 * 0 % rate, EU B2B is reverse charge, and a country with no rate is
		 * refused rather than zero-rated.
		 */
		help: "Off means no VAT on any order, anywhere. Switzerland, EU reverse charge and unconfigured countries are already handled by the tax matrix — this is not the switch for those.",
		type: "boolean",
		fallback: true,
		group: "features",
	},
	"coupons.enabled": {
		label: "Accept coupon codes",
		help: "Shows the coupon field at checkout. Nothing uses it until coupons are built.",
		type: "boolean",
		fallback: false,
		isPublic: true,
		group: "features",
	},

	// ── Pricing ────────────────────────────────────────────────────────────
	"pricing.tierPriority": {
		label: "Quantity ladder priority",
		/**
		 * Comma-separated, most specific first. Valid names are `customer`,
		 * `catalogue` and `category`; anything else, or a list that does not name
		 * all three exactly once, falls back to the default rather than silently
		 * dropping a source.
		 */
		help: "Order the tier sources are tried in. Most specific first.",
		type: "select",
		options: [
			{ value: "customer,catalogue,category", label: "Customer → Product → Category" },
			{ value: "customer,category,catalogue", label: "Customer → Category → Product" },
			{ value: "catalogue,customer,category", label: "Product → Customer → Category" },
		],
		fallback: "customer,catalogue,category",
		group: "pricing",
	},
}

/** Keys the storefront may read without signing in. */
export const PUBLIC_KEYS = Object.entries(SETTINGS)
	.filter(([, definition]) => definition.isPublic)
	.map(([key]) => key)
