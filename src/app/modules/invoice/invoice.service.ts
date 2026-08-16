// Type-only import, erased at compile time so it does not pull in the ESM
// module. `resolution-mode: "import"` tells TypeScript to read puppeteer's ESM
// types from a CommonJS file. The runtime import is dynamic — see getBrowser().
import type { Browser } from "puppeteer" with { "resolution-mode": "import" }
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
 * Puppeteer is heavy (a whole Chromium), so the browser is launched once and
 * reused rather than started per request. It is also isolated behind this one
 * module — swapping it for pdfkit or a render service later touches nothing
 * else.
 */
let browser: Browser | null = null

const getBrowser = async (): Promise<Browser> => {
	if (browser?.connected) return browser

	// Puppeteer is ESM-only, so a CommonJS project must import it dynamically.
	// The happy side effect is that ~300 MB of Chromium stays unloaded until
	// somebody actually asks for an invoice — server startup is unaffected.
	const { default: puppeteer } = await import("puppeteer")

	browser = await puppeteer.launch({
		headless: true,
		// Required in most container images; harmless locally.
		args: ["--no-sandbox", "--disable-dev-shm-usage"],
	})

	return browser
}

/** Closes Chromium on shutdown so a redeploy does not leave one running. */
export const closeBrowser = async (): Promise<void> => {
	if (browser) {
		await browser.close().catch(() => undefined)
		browser = null
	}
}

const esc = (v: string): string =>
	v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const money = (v: string, currency: string): string => `${v} ${currency}`

interface InvoiceOrder {
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

const renderAddress = (a: InvoiceOrder["addresses"][number] | undefined): string => {
	if (!a) return ""
	return [
		a.company ? esc(a.company) : "",
		esc(`${a.firstName} ${a.lastName}`),
		esc(a.street1),
		a.street2 ? esc(a.street2) : "",
		esc(`${a.postcode} ${a.city}`),
		esc(a.countryCode),
	]
		.filter(Boolean)
		.join("<br>")
}

const renderHtml = (order: InvoiceOrder, company: CompanyDetails, locale: LocaleCode): string => {
	const L = (key: string, vars?: Record<string, string | number>) => t(key, locale, vars)
	const invoiceNumber = `${company.invoiceNumberPrefix}${String(order.number).padStart(6, "0")}`
	const billing = order.addresses.find((a) => a.type === "BILLING")
	const shipping = order.addresses.find((a) => a.type === "SHIPPING")

	const rows = nestOptionLines(order.items)
		.map(({ line: item, options }) => {
			const render = (i: typeof item, isOption: boolean) => `
        <tr>
          <td style="padding:8px 6px;border-bottom:1px solid #eee;${isOption ? "padding-left:22px;color:#555;" : ""}">
            ${isOption ? "↳ " : ""}${esc(i.name)}${i.attributes.length ? ` <span style="color:#777;">(${esc(i.attributes.join(", "))})</span>` : ""}
            <div style="color:#999;font-size:10px;">${esc(i.sku)}</div>
          </td>
          <td align="right" style="padding:8px 6px;border-bottom:1px solid #eee;">${i.quantity}</td>
          <td align="right" style="padding:8px 6px;border-bottom:1px solid #eee;">${money(i.unitPrice, order.currency)}</td>
          <td align="right" style="padding:8px 6px;border-bottom:1px solid #eee;">${money(i.lineTotal, order.currency)}</td>
        </tr>`

			return render(item, false) + options.map((o) => render(o, true)).join("")
		})
		.join("")

	const taxRows = order.taxLines
		.map(
			(tl) => `<tr>
        <td style="padding:4px 0;">${esc(tl.name)} ${tl.ratePercent}%</td>
        <td align="right" style="padding:4px 0;">${money(tl.amount, order.currency)}</td>
      </tr>`
		)
		.join("")

	return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #222; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #777; }
  table { width: 100%; border-collapse: collapse; }
</style></head>
<body>
  <table><tr>
    <td style="vertical-align:top;">
      <div style="font-size:15px;font-weight:bold;">${esc(company.name)}</div>
      <div class="muted" style="margin-top:4px;line-height:1.5;">
        ${[
					company.street,
					company.street2,
					`${company.postcode} ${company.city}`.trim(),
					// State on its own line only where one is set — most German
					// addresses have none, and a blank line reads as a mistake.
					company.state,
					company.countryCode,
				]
					.filter((line) => line.trim())
					.map(esc)
					.join("<br>")}
      </div>
    </td>
    <td align="right" style="vertical-align:top;">
      <h1>${esc(L("invoice.title"))}</h1>
      <div class="muted">${esc(L("invoice.number"))}: <strong>${invoiceNumber}</strong></div>
      <div class="muted">${esc(L("invoice.date"))}: ${order.placedAt.toISOString().slice(0, 10)}</div>
    </td>
  </tr></table>

  <table style="margin-top:26px;">
    <tr>
      <td style="vertical-align:top;width:50%;">
        <div style="font-weight:bold;margin-bottom:6px;">${esc(L("invoice.billTo"))}</div>
        <div style="line-height:1.6;">${renderAddress(billing)}</div>
        ${order.vatNumber ? `<div class="muted" style="margin-top:6px;">VAT: ${esc(order.vatNumber)}</div>` : ""}
      </td>
      <td style="vertical-align:top;width:50%;">
        <div style="font-weight:bold;margin-bottom:6px;">${esc(L("invoice.shipTo"))}</div>
        <div style="line-height:1.6;">${renderAddress(shipping)}</div>
      </td>
    </tr>
  </table>

  <table style="margin-top:26px;">
    <thead><tr style="border-bottom:2px solid #222;">
      <th align="left" style="padding:6px;">${esc(L("invoice.item"))}</th>
      <th align="right" style="padding:6px;">${esc(L("invoice.qty"))}</th>
      <th align="right" style="padding:6px;">${esc(L("invoice.unitPrice"))}</th>
      <th align="right" style="padding:6px;">${esc(L("invoice.lineTotal"))}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table style="margin-top:18px;"><tr>
    <td style="width:55%;"></td>
    <td style="width:45%;">
      <table>
        <tr><td style="padding:4px 0;">${esc(L("invoice.subtotal"))}</td><td align="right">${money(order.subtotal, order.currency)}</td></tr>
        <tr><td style="padding:4px 0;">${esc(L("invoice.shipping"))}${order.shippingMethodTitle ? ` <span class="muted">(${esc(order.shippingMethodTitle)})</span>` : ""}</td><td align="right">${money(order.shippingTotal, order.currency)}</td></tr>
        ${taxRows}
        <tr style="border-top:2px solid #222;"><td style="padding:8px 0;font-weight:bold;">${esc(L("invoice.total"))}</td><td align="right" style="font-weight:bold;">${money(order.grandTotal, order.currency)}</td></tr>
      </table>
      ${order.reverseCharged ? `<p class="muted" style="margin-top:10px;">${esc(L("invoice.reverseCharge"))}</p>` : ""}
    </td>
  </tr></table>

  ${
		order.paymentInstructions
			? `<div style="margin-top:26px;">
           <div style="font-weight:bold;margin-bottom:4px;">${esc(order.paymentMethodTitle ?? L("invoice.payment"))}</div>
           <div class="muted" style="white-space:pre-line;line-height:1.6;">${esc(order.paymentInstructions)}</div>
         </div>`
			: ""
	}

  ${order.customerNote ? `<div style="margin-top:18px;" class="muted">${esc(L("invoice.note"))}: ${esc(order.customerNote)}</div>` : ""}

  <div class="muted" style="margin-top:34px;border-top:1px solid #ddd;padding-top:10px;line-height:1.7;">
    ${company.vatId ? `${esc(L("invoice.vatId"))}: ${esc(company.vatId)}<br>` : ""}
    ${company.registerNumber ? `${esc(L("invoice.register"))}: ${esc(company.registerNumber)}<br>` : ""}
    ${[company.email, company.phone, company.website].filter(Boolean).map(esc).join(" · ")}
    ${company.invoiceFooter ? `<div style="margin-top:8px;">${esc(company.invoiceFooter)}</div>` : ""}
  </div>
</body></html>`
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

	const page = await (await getBrowser()).newPage()

	try {
		await page.setContent(renderHtml(order, company, locale), { waitUntil: "load" })
		const pdf = await page.pdf({ format: "A4", printBackground: true })

		return {
			pdf: Buffer.from(pdf),
			filename: `invoice-${company.invoiceNumberPrefix}${String(order.number).padStart(6, "0")}.pdf`,
		}
	} catch (error) {
		logger.error({ err: error, orderId }, "invoice generation failed")
		throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, "Could not generate the invoice", {
			messageKey: "invoice.failed",
		})
	} finally {
		await page.close().catch(() => undefined)
	}
}

export const InvoiceService = { generate, closeBrowser }
