/**
 * Type-only, so nothing is required at load time.
 *
 * `@react-pdf/renderer` is ESM and this project is CommonJS. A normal import
 * compiles to `require()`, and requiring an ESM module only works on Node 22.12
 * and above — it throws `ERR_REQUIRE_ESM` on anything older. That is fine on a
 * machine whose Node version you chose and fatal on one you did not: the whole
 * app is a single module graph, so the failure is not "invoices are broken", it
 * is every request to the API dying at import with `FUNCTION_INVOCATION_FAILED`
 * and nothing to read.
 *
 * `import()` works on every version, so the platform's Node no longer matters.
 * The file this replaced said the same thing about Puppeteer, in the same
 * words, and switching libraries is not a reason the rule stopped applying.
 */
type Renderer = typeof import("@react-pdf/renderer")

/**
 * The primitives the layout below is written in, filled in by `loadRenderer`.
 *
 * Module-level bindings rather than a parameter threaded through every
 * component, because JSX resolves `<View>` by looking up an identifier in
 * lexical scope — there is no way to hand it in. The invariant that makes this
 * safe is small and stated in one place: `generate` is the only entry point,
 * and it awaits the load before any element is constructed.
 */
let Document!: Renderer["Document"]
let Page!: Renderer["Page"]
let View!: Renderer["View"]
let Text!: Renderer["Text"]

let renderer: Promise<Renderer> | null = null

/** Loaded once per process and reused — the import itself is not free. */
const loadRenderer = async (): Promise<Renderer> => {
	renderer ??= import("@react-pdf/renderer")

	const loaded = await renderer
	;({ Document, Page, View, Text } = loaded)

	return loaded
}

import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { nestOptionLines } from "../../../domain/order/nestOptionLines"
import { t } from "../../../i18n"
import { httpStatus } from "../../../shared/httpStatus"
import { logger } from "../../../shared/logger"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"
import { SettingService, type CompanyDetails } from "../setting/setting.service"

/**
 * Invoice PDFs.
 *
 * Drawn directly rather than rendered from HTML by a browser. It used to launch
 * Chromium through Puppeteer, which meant carrying **847 MB** of browser for one
 * feature — too large for a serverless function's bundle at all, and the reason
 * the deployment notes warned that invoices were the thing most likely to break
 * on a 512 MB instance: launching Chromium was capable of taking the whole API
 * down with it.
 *
 * `@react-pdf/renderer` is 2.6 MB, boots nothing, and produces real selectable
 * text rather than a screenshot of a page. The layout below is flexbox — the
 * same shapes the HTML used, expressed as views instead of tables.
 *
 * One incidental gain: nothing here is a string being concatenated into markup,
 * so the hand-rolled HTML escaper this file used to need is gone. A company name
 * containing an ampersand is now simply a company name.
 */

/** Everything is Helvetica, which is built into every PDF reader — no font
 *  file to ship, and it covers the Latin-1 range German invoices need. */
/** react-pdf's own style type, reached through the import type so nothing
 *  is required at load time. */
type Style = NonNullable<Parameters<Renderer["StyleSheet"]["create"]>[0]>[string]

/*
 * A plain object, not `StyleSheet.create`. That helper is identity — it exists
 * for parity with React Native — and calling it here would mean requiring the
 * module at load time, which is the very thing this file no longer does.
 */
const styles = {
	page: {
		fontFamily: "Helvetica",
		fontSize: 9,
		color: "#222222",
		paddingTop: 50,
		paddingHorizontal: 45,
		// Room kept clear for the pinned footer below, which is taken out of the
		// flow and would otherwise be written over the last line of content.
		paddingBottom: 80,
	},

	row: { flexDirection: "row" },
	spread: { flexDirection: "row", justifyContent: "space-between" },
	muted: { color: "#777777" },
	bold: { fontFamily: "Helvetica-Bold" },

	// ── header ──────────────────────────────────────────────────────────────
	header: { flexDirection: "row", justifyContent: "space-between" },
	companyName: { fontFamily: "Helvetica-Bold", fontSize: 13, marginBottom: 4 },
	companyLine: { color: "#777777", lineHeight: 1.5 },
	title: { fontFamily: "Helvetica-Bold", fontSize: 18, marginBottom: 4, textAlign: "right" },
	headerMeta: { color: "#777777", textAlign: "right" },

	// ── addresses ───────────────────────────────────────────────────────────
	addresses: { flexDirection: "row", marginTop: 20 },
	addressBlock: { width: "50%", paddingRight: 12 },
	addressHeading: { fontFamily: "Helvetica-Bold", marginBottom: 6 },
	addressLine: { lineHeight: 1.6 },

	// ── items ───────────────────────────────────────────────────────────────
	table: { marginTop: 20 },
	tableHead: {
		flexDirection: "row",
		borderBottomWidth: 2,
		borderBottomColor: "#222222",
		paddingBottom: 6,
	},
	tableRow: {
		flexDirection: "row",
		borderBottomWidth: 1,
		borderBottomColor: "#eeeeee",
		paddingVertical: 6,
	},
	colItem: { flex: 1, paddingRight: 8 },
	colQty: { width: 45, textAlign: "right" },
	colPrice: { width: 80, textAlign: "right" },
	colTotal: { width: 90, textAlign: "right" },
	/// Options sit under the line they were bought with (§4.6).
	optionIndent: { paddingLeft: 16 },
	optionText: { color: "#555555" },
	sku: { color: "#999999", fontSize: 8, marginTop: 2 },

	// ── totals ──────────────────────────────────────────────────────────────
	totals: { marginTop: 14, marginLeft: "auto", width: "45%" },
	totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
	grandTotalRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		borderTopWidth: 2,
		borderTopColor: "#222222",
		paddingTop: 6,
		marginTop: 3,
	},

	// ── the rest ────────────────────────────────────────────────────────────
	block: { marginTop: 20 },
	note: { marginTop: 14, color: "#777777" },
	/**
	 * Pinned to the foot of every page rather than flowing after the content.
	 *
	 * This is what an invoice footer is: the VAT ID and register number are
	 * statutory details about the *seller*, not the last paragraph of the
	 * document. Flowing them meant a one-page invoice whose content came within
	 * a few points of the margin pushed them onto a second, otherwise empty
	 * page — and a genuinely long invoice would have carried them on the last
	 * page only, where they belong on all of them.
	 *
	 * Absolute, so it takes no part in pagination at all. `page.paddingBottom`
	 * is what keeps the flowing content clear of it.
	 */
	footer: {
		position: "absolute",
		bottom: 30,
		left: 45,
		right: 45,
		borderTopWidth: 1,
		borderTopColor: "#dddddd",
		paddingTop: 8,
		color: "#777777",
		lineHeight: 1.7,
	},
} satisfies Record<string, Style>

const money = (v: string, currency: string): string => `${v} ${currency}`

export interface InvoiceOrder {
	number: number
	locale: string
	currency: string
	placedAt: Date
	subtotal: string
	shippingTotal: string
	taxTotal: string
	grandTotal: string
	reverseCharged: boolean
	vatNumber: string | null
	customerNote: string | null
	paymentMethodTitle: string | null
	paymentInstructions: string | null
	shippingMethodTitle: string | null
	items: {
		/// Needed to match an option line to the line it belongs under. Without
		/// it the only available test is "has a parent at all", which puts every
		/// option under every product.
		id: string
		sku: string
		name: string
		attributes: string[]
		quantity: number
		unitPrice: string
		lineTotal: string
		parentItemId: string | null
	}[]
	taxLines: { name: string; ratePercent: string; taxableBase: string; amount: string }[]
	addresses: {
		type: string
		firstName: string
		lastName: string
		company: string | null
		street1: string
		street2: string | null
		postcode: string
		city: string
		countryCode: string
	}[]
}

type Address = InvoiceOrder["addresses"][number]
type Item = InvoiceOrder["items"][number]

const AddressBlock = ({ address }: { address: Address | undefined }) => {
	if (!address) return null

	const lines = [
		address.company,
		`${address.firstName} ${address.lastName}`,
		address.street1,
		address.street2,
		`${address.postcode} ${address.city}`,
		address.countryCode,
	].filter((line): line is string => Boolean(line && line.trim()))

	return (
		<View>
			{lines.map((line, index) => (
				<Text key={index} style={styles.addressLine}>
					{line}
				</Text>
			))}
		</View>
	)
}

/**
 * One line of the items table.
 *
 * An option is drawn the same way, indented and greyed — it is a product with
 * its own SKU and price, not a footnote on the line above it.
 */
const ItemRow = ({
	item,
	currency,
	isOption,
}: {
	item: Item
	currency: string
	isOption: boolean
}) => (
	<View style={styles.tableRow} wrap={false}>
		<View style={[styles.colItem, ...(isOption ? [styles.optionIndent] : [])]}>
			<Text style={isOption ? styles.optionText : undefined}>
				{isOption ? "> " : ""}
				{item.name}
				{item.attributes.length ? ` (${item.attributes.join(", ")})` : ""}
			</Text>
			{/* An empty SKU renders as nothing, which is what no SKU should look like. */}
			{!!item.sku && <Text style={styles.sku}>{item.sku}</Text>}
		</View>
		<Text style={styles.colQty}>{item.quantity}</Text>
		<Text style={styles.colPrice}>{money(item.unitPrice, currency)}</Text>
		<Text style={styles.colTotal}>{money(item.lineTotal, currency)}</Text>
	</View>
)

const InvoiceDocument = ({
	order,
	company,
	locale,
}: {
	order: InvoiceOrder
	company: CompanyDetails
	locale: LocaleCode
}) => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, locale, vars)
	const invoiceNumber = `${company.invoiceNumberPrefix}${String(order.number).padStart(6, "0")}`
	const billing = order.addresses.find((a) => a.type === "BILLING")
	const shipping = order.addresses.find((a) => a.type === "SHIPPING")

	const companyLines = [
		company.street,
		company.street2,
		`${company.postcode} ${company.city}`.trim(),
		// State on its own line only where one is set — most German addresses
		// have none, and a blank line reads as a mistake.
		company.state,
		company.countryCode,
	].filter((line) => line.trim())

	const footerContact = [company.email, company.phone, company.website]
		.filter(Boolean)
		.join("  ·  ")

	return (
		<Document title={invoiceNumber} author={company.name || "astano"}>
			<Page size="A4" style={styles.page}>
				<View style={styles.header}>
					<View>
						<Text style={styles.companyName}>{company.name}</Text>
						{companyLines.map((line, index) => (
							<Text key={index} style={styles.companyLine}>
								{line}
							</Text>
						))}
					</View>

					<View>
						<Text style={styles.title}>{L("invoice.title")}</Text>
						<Text style={styles.headerMeta}>
							{L("invoice.number")}: <Text style={styles.bold}>{invoiceNumber}</Text>
						</Text>
						<Text style={styles.headerMeta}>
							{L("invoice.date")}: {order.placedAt.toISOString().slice(0, 10)}
						</Text>
					</View>
				</View>

				<View style={styles.addresses}>
					<View style={styles.addressBlock}>
						<Text style={styles.addressHeading}>{L("invoice.billTo")}</Text>
						<AddressBlock address={billing} />
						{!!order.vatNumber && (
							<Text style={[styles.muted, { marginTop: 6 }]}>VAT: {order.vatNumber}</Text>
						)}
					</View>

					<View style={styles.addressBlock}>
						<Text style={styles.addressHeading}>{L("invoice.shipTo")}</Text>
						<AddressBlock address={shipping} />
					</View>
				</View>

				<View style={styles.table}>
					{/* `fixed`, so a multi-page invoice repeats its column headings
					    rather than leaving page two as four unlabelled columns. */}
					<View style={styles.tableHead} fixed>
						<Text style={[styles.colItem, styles.bold]}>{L("invoice.item")}</Text>
						<Text style={[styles.colQty, styles.bold]}>{L("invoice.qty")}</Text>
						<Text style={[styles.colPrice, styles.bold]}>{L("invoice.unitPrice")}</Text>
						<Text style={[styles.colTotal, styles.bold]}>{L("invoice.lineTotal")}</Text>
					</View>

					{/* Each line carries only its OWN options — the rule lives in
					    domain/order/nestOptionLines, because getting it wrong here
					    printed every option under every product. */}
					{nestOptionLines(order.items).map(({ line, options }) => (
						<View key={line.id}>
							<ItemRow item={line} currency={order.currency} isOption={false} />
							{options.map((option) => (
								<ItemRow
									key={option.id}
									item={option}
									currency={order.currency}
									isOption
								/>
							))}
						</View>
					))}
				</View>

				<View style={styles.totals}>
					<View style={styles.totalsRow}>
						<Text>{L("invoice.subtotal")}</Text>
						<Text>{money(order.subtotal, order.currency)}</Text>
					</View>

					<View style={styles.totalsRow}>
						<Text>
							{L("invoice.shipping")}
							{order.shippingMethodTitle ? ` (${order.shippingMethodTitle})` : ""}
						</Text>
						<Text>{money(order.shippingTotal, order.currency)}</Text>
					</View>

					{order.taxLines.map((line, index) => (
						<View key={index} style={styles.totalsRow}>
							<Text>
								{line.name} {line.ratePercent}%
							</Text>
							<Text>{money(line.amount, order.currency)}</Text>
						</View>
					))}

					<View style={styles.grandTotalRow}>
						<Text style={styles.bold}>{L("invoice.total")}</Text>
						<Text style={styles.bold}>{money(order.grandTotal, order.currency)}</Text>
					</View>

					{/* Required wording — a reverse-charged invoice has to say why it
					    carries no tax. */}
					{order.reverseCharged && (
						<Text style={[styles.muted, { marginTop: 10 }]}>{L("invoice.reverseCharge")}</Text>
					)}
				</View>

				{!!order.paymentInstructions && (
					<View style={styles.block}>
						<Text style={styles.bold}>
							{order.paymentMethodTitle ?? L("invoice.payment")}
						</Text>
						<Text style={[styles.muted, { marginTop: 4, lineHeight: 1.6 }]}>
							{order.paymentInstructions}
						</Text>
					</View>
				)}

				{!!order.customerNote && (
					<Text style={styles.note}>
						{L("invoice.note")}: {order.customerNote}
					</Text>
				)}

				<View style={styles.footer} fixed>
					{!!company.vatId && (
						<Text>
							{L("invoice.vatId")}: {company.vatId}
						</Text>
					)}
					{!!company.registerNumber && (
						<Text>
							{L("invoice.register")}: {company.registerNumber}
						</Text>
					)}
					{!!footerContact && <Text>{footerContact}</Text>}
					{!!company.invoiceFooter && (
						<Text style={{ marginTop: 8 }}>{company.invoiceFooter}</Text>
					)}
				</View>
			</Page>
		</Document>
	)
}

const loadOrder = async (id: string): Promise<InvoiceOrder> => {
	const row = await prisma.order.findUnique({
		where: { id },
		include: { items: true, addresses: true, taxLines: true },
	})

	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Order not found", { messageKey: "order.notFound" })
	}

	return {
		number: row.number,
		locale: row.locale,
		currency: row.currency,
		placedAt: row.placedAt,
		subtotal: row.subtotal.toFixed(2),
		shippingTotal: row.shippingTotal.toFixed(2),
		taxTotal: row.taxTotal.toFixed(2),
		grandTotal: row.grandTotal.toFixed(2),
		reverseCharged: row.reverseCharged,
		vatNumber: row.vatNumber,
		customerNote: row.customerNote,
		paymentMethodTitle: row.paymentMethodTitle,
		paymentInstructions: row.paymentInstructions,
		shippingMethodTitle: row.shippingMethodTitle,
		items: row.items.map((i) => ({
			id: i.id,
			sku: i.sku,
			name: i.name,
			attributes: i.attributes,
			quantity: i.quantity,
			unitPrice: i.unitPrice.toFixed(2),
			lineTotal: i.lineTotal.toFixed(2),
			parentItemId: i.parentItemId,
		})),
		taxLines: row.taxLines.map((tl) => ({
			name: tl.name,
			ratePercent: tl.ratePercent.toFixed(2),
			taxableBase: tl.taxableBase.toFixed(2),
			amount: tl.amount.toFixed(2),
		})),
		addresses: row.addresses.map((a) => ({
			type: a.type,
			firstName: a.firstName,
			lastName: a.lastName,
			company: a.company,
			street1: a.street1,
			street2: a.street2,
			postcode: a.postcode,
			city: a.city,
			countryCode: a.countryCode,
		})),
	}
}

/**
 * Renders in the order's OWN locale, not the current request's — an invoice for
 * an order placed in German stays German forever, however the customer later
 * switches the site.
 */
const generate = async (orderId: string): Promise<{ pdf: Buffer; filename: string }> => {
	const order = await loadOrder(orderId)
	const company = await SettingService.getCompany()
	const locale = (order.locale || DEFAULT_LOCALE) as LocaleCode

	// Before anything below constructs an element — see the bindings at the top
	// of this file. This is the invariant the whole lazy-load rests on.
	const { renderToBuffer } = await loadRenderer()

	try {
		const pdf = await renderToBuffer(
			<InvoiceDocument order={order} company={company} locale={locale} />
		)

		return {
			pdf,
			filename: `invoice-${company.invoiceNumberPrefix}${String(order.number).padStart(6, "0")}.pdf`,
		}
	} catch (error) {
		logger.error({ err: error, orderId }, "invoice generation failed")
		throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, "Could not generate the invoice", {
			messageKey: "invoice.failed",
		})
	}
}

/*
 * No `closeBrowser`. Nothing is launched, so nothing outlives the process and
 * there is nothing for the shutdown handler to tidy away.
 */
export const InvoiceService = { generate }
