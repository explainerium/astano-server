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
	/**
	 * Stored, but nothing reads it yet.
	 *
	 * Set only where the feature is genuinely still to be built, so a check can
	 * tell a deliberate placeholder from a setting somebody forgot to wire up.
	 * The help text must say so too — the admin cannot read this file.
	 */
	pending?: boolean
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

/**
 * The settings menu, in sections.
 *
 * Eleven groups in one flat list was a list to be read rather than navigated —
 * "Units" and "Invoices" sat side by side with nothing to say which of them a
 * question about VAT belonged near. The sections answer that: what the shop
 * sells and how, versus who the business is, versus what a message looks like.
 *
 * `section` is a label, not a route. The URL is still /settings/<group>, so
 * moving a group between sections cannot break a link.
 */
export const SETTING_SECTIONS = [
	{ key: "shop", title: "Shop" },
	{ key: "business", title: "Business" },
	{ key: "email", title: "Email" },
] as const

export type SettingSection = (typeof SETTING_SECTIONS)[number]["key"]

export const SETTING_GROUPS: {
	key: string
	title: string
	blurb: string
	section: SettingSection
}[] = [
	// ── Shop ───────────────────────────────────────────────────────────────
	{
		key: "language",
		title: "Language",
		blurb: "Which language a visitor sees first, and whether they may change it.",
		section: "shop",
	},
	{
		key: "selling",
		title: "Selling & shipping locations",
		blurb: "Where the shop takes orders from, and where it delivers.",
		section: "shop",
	},
	{
		key: "currency",
		title: "Currency",
		blurb: "How every price on the site is written.",
		section: "shop",
	},
	{
		key: "cart",
		title: "Cart & shop",
		blurb: "What happens after adding to the basket, and how the grid is laid out.",
		section: "shop",
	},
	{
		key: "stock",
		title: "Stock",
		blurb: "When to warn, and who to warn.",
		section: "shop",
	},
	{
		key: "units",
		title: "Units",
		blurb: "Weights and dimensions, as entered and as shown.",
		section: "shop",
	},
	{ key: "pricing", title: "Pricing", blurb: "Which quantity ladder wins.", section: "shop" },
	{
		key: "features",
		title: "Features",
		blurb: "Parts of the shop that can be switched off entirely.",
		section: "shop",
	},

	// ── Business ───────────────────────────────────────────────────────────
	{
		key: "company",
		title: "Business address",
		blurb: "Printed on invoices and in every email. Tax and shipping are worked out from it.",
		section: "business",
	},
	{
		key: "invoice",
		title: "Invoices",
		blurb: "How invoices are numbered and signed off.",
		section: "business",
	},

	// ── Email ──────────────────────────────────────────────────────────────
	{
		key: "mail",
		title: "Sending",
		blurb: "Who transactional mail comes from and goes to.",
		section: "email",
	},
	{
		key: "email",
		title: "Appearance",
		blurb: "The logo, colours and footer on every message the shop sends.",
		section: "email",
	},
]

export const SETTINGS: Record<string, SettingDefinition> = {
	// ── Company ────────────────────────────────────────────────────────────
	/*
	 * The address block is public.
	 *
	 * It is printed on every invoice, in the imprint and in the footer — there
	 * is nothing private about where a shop trades from. Public so the footer
	 * can render it: it used to be typed into the markup, which meant changing
	 * the phone number here changed it on invoices and nowhere else.
	 */
	/*
	 * WordPress calls this Site Language, and it means the same thing here: the
	 * language a visitor gets when they have expressed no preference of their
	 * own.
	 *
	 * It does not override a visitor who has chosen. A shop that forces German
	 * on somebody who just clicked English has taken the switcher away and left
	 * the button behind, which is worse than having neither.
	 *
	 * Distinct from DEFAULT_LOCALE in config/locales. That constant decides
	 * which language is served *unprefixed* and is therefore a URL decision;
	 * this decides which one an undecided visitor is sent to.
	 */
	"language.default": {
		label: "Site language",
		help: "What a first-time visitor sees. Anyone who picks a language keeps their choice.",
		type: "select",
		options: [
			{ value: "de", label: "Deutsch" },
			{ value: "en", label: "English" },
		],
		fallback: "de",
		isPublic: true,
		group: "language",
	},
	"language.showSwitcher": {
		label: "Show the language switcher",
		help: "Turn this off to run the shop in one language without offering the other.",
		type: "boolean",
		fallback: true,
		isPublic: true,
		group: "language",
	},
	/*
	 * Browser-language detection, off by default.
	 *
	 * On, a visitor whose browser asks for English is sent there before they see
	 * anything. That helps a shop with real English traffic and actively hurts
	 * one whose customers are German with English-configured laptops — which
	 * describes a good part of this trade.
	 */
	"language.detectFromBrowser": {
		label: "Follow the browser language",
		help: "Off means everyone starts in the site language above.",
		type: "boolean",
		fallback: false,
		isPublic: true,
		group: "language",
	},

	"company.name": { label: "Legal entity on invoices", type: "text", fallback: "", isPublic: true, group: "company" },
	"company.street": { label: "Address line 1", type: "text", fallback: "", isPublic: true, group: "company" },
	"company.street2": {
		label: "Address line 2",
		help: "Optional — a floor, a unit, a c/o line.",
		type: "text",
		fallback: "",
		isPublic: true,
		group: "company",
	},
	"company.postcode": { label: "Postcode", type: "text", fallback: "", isPublic: true, group: "company" },
	"company.city": { label: "City", type: "text", fallback: "", isPublic: true, group: "company" },
	/*
	 * Country and state as two fields, where WooCommerce has one combined
	 * picker. The pair is what the rest of the shop already reads — tax rates
	 * match on an ISO country code, and a "DE:BY" string would have to be split
	 * apart at every one of those points.
	 */
	"company.countryCode": {
		label: "Country",
		help: "Tax rates and shipping costs are worked out from this address.",
		type: "country",
		fallback: "DE",
		// Public: the checkout preselects it, and it is printed on every invoice
		// and in the imprint anyway. Nothing about it is private.
		isPublic: true,
		group: "company",
	},
	"company.state": {
		label: "State or region",
		help: "Optional. Only needed where tax differs within a country.",
		type: "text",
		fallback: "",
		group: "company",
	},
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
	/** Printed on invoices and in email footers. Server-side only — not public. */
	"company.website": { label: "Shop URL", type: "text", fallback: "", group: "company" },

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
	/*
	 * Symbol position and the two separators, as WooCommerce has them.
	 *
	 * This replaced a single "Number format" locale picker. The locale was the
	 * tidier idea — one choice that cannot produce a contradiction — but it is
	 * the *same* decision as these three, and keeping both would have meant two
	 * settings that disagree about how a price is written and no way to tell
	 * which one the shop is actually using.
	 *
	 * Given a choice between the tidy version and the one the client already
	 * knows from WooCommerce, the familiar one wins: this is the screen they
	 * have been configuring for years.
	 */
	"currency.position": {
		label: "Currency symbol position",
		type: "select",
		options: [
			{ value: "left", label: "Left — €1.234,56" },
			{ value: "right", label: "Right — 1.234,56€" },
			{ value: "left_space", label: "Left with a space — € 1.234,56" },
			{ value: "right_space", label: "Right with a space — 1.234,56 €" },
		],
		fallback: "right_space",
		isPublic: true,
		group: "currency",
	},
	"currency.thousandSeparator": {
		label: "Thousands separator",
		help: "German writes 1.234,56 — a full stop here and a comma below.",
		type: "text",
		fallback: ".",
		isPublic: true,
		group: "currency",
	},
	"currency.decimalSeparator": {
		label: "Decimal separator",
		type: "text",
		fallback: ",",
		isPublic: true,
		group: "currency",
	},
	"currency.decimals": {
		label: "Number of decimal places",
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
	/*
	 * Where the shop will ship, which is not the same question as where it will
	 * sell — and not the same question as the shipping zones either.
	 *
	 * This is a gate in front of the zones, not a second copy of them. A zone
	 * says what delivery to a country costs; this says whether the country is
	 * offered delivery at all. They only look alike until a shop sells a
	 * download to everywhere and ships a pallet to two countries.
	 */
	"shipping.locations": {
		label: "Ship to",
		type: "select",
		options: [
			{ value: "selling", label: "Everywhere I sell to" },
			{ value: "all", label: "All countries" },
			{ value: "specific", label: "Only the countries listed below" },
			{ value: "disabled", label: "Nowhere — no delivery at all" },
		],
		fallback: "selling",
		isPublic: true,
		group: "selling",
	},
	"shipping.countries": {
		label: "Ship to these countries",
		help: "Only used by “Only the countries listed below”. A country here still needs a shipping zone to have a rate.",
		type: "countries",
		fallback: [],
		isPublic: true,
		group: "selling",
	},
	/*
	 * WooCommerce offers geolocation here as well. It is left out rather than
	 * shown greyed out: it needs a GeoIP service this shop does not have, and a
	 * setting that cannot do what it says is worse than one that is absent.
	 */
	"selling.customerDefault": {
		label: "Preset location for customers",
		type: "select",
		options: [
			{ value: "shop", label: "The shop's own country" },
			{ value: "specific", label: "A country I choose below" },
			{ value: "none", label: "No preset — the customer picks" },
		],
		fallback: "shop",
		isPublic: true,
		group: "selling",
	},
	"selling.defaultCountry": {
		label: "Preselected country at checkout",
		help: "Only used by “A country I choose below”.",
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
		pending: true,
		label: "Accept coupon codes",
		help: "Shows the coupon field at checkout. Nothing uses it until coupons are built.",
		type: "boolean",
		fallback: false,
		isPublic: true,
		group: "features",
	},
	"coupons.sequential": {
		pending: true,
		label: "Apply coupon discounts one after the other",
		help: "With several coupons, the first comes off the full price and the next off what is left. Nothing uses it until coupons are built.",
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
