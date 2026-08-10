import type { CompanyDetails } from "../../app/modules/setting/setting.service"
import { DEFAULT_BRANDING, readableOn, type EmailBranding } from "../../domain/email/branding"

/**
 * Email HTML.
 *
 * Table-based and inline-styled on purpose — Outlook and several webmail
 * clients still strip <style> blocks and ignore flexbox, so anything cleverer
 * arrives broken. This is one of the few places where dated markup is the
 * correct choice.
 *
 * Colours come from the shop's branding settings, already validated as hex by
 * `readBranding`; nothing here re-checks them, and nothing else should be
 * interpolated into a style attribute without going through that first.
 */
const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")

export const esc = escapeHtml

/** Author-written copy that may contain line breaks but never markup. */
const paragraphs = (value: string, style: string): string =>
	value
		.split(/\n{2,}/)
		.map((block) => `<p style="${style}">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
		.join("")

export interface LayoutInput {
	title: string
	intro: string
	bodyHtml: string
	company: CompanyDetails
	/// Optional call to action.
	action?: { label: string; url: string }
	branding?: EmailBranding
	/**
	 * Admin-written copy appended after the body, above the footer. WooCommerce
	 * calls this "additional content" and it is where a shop puts its returns
	 * policy or a seasonal despatch notice.
	 */
	additionalContent?: string
}

export const renderLayout = ({
	title,
	intro,
	bodyHtml,
	company,
	action,
	branding = DEFAULT_BRANDING,
	additionalContent,
}: LayoutInput): string => {
	const { baseColour, backgroundColour, bodyBackgroundColour, textColour } = branding
	const onBase = readableOn(baseColour)

	// A logo if there is one, the shop's name if not. Height-capped and given
	// alt text, because a good number of clients block images by default and the
	// header should still say who the mail is from.
	const header = branding.headerImage
		? `<img src="${escapeHtml(branding.headerImage)}" alt="${escapeHtml(company.name || "astano")}" height="40" style="display:block;max-height:40px;width:auto;border:0;">`
		: `<div style="font-size:20px;font-weight:bold;color:${onBase};">${escapeHtml(company.name || "astano")}</div>`

	const footer = branding.footerText
		? paragraphs(branding.footerText, "margin:0 0 6px;")
		: `${[company.name, company.street, company.street2, `${company.postcode} ${company.city}`.trim()]
				.filter((part) => part.trim())
				.map(escapeHtml)
				.join(" · ")}<br>
          ${company.vatId ? `VAT ${escapeHtml(company.vatId)} · ` : ""}${company.email ? escapeHtml(company.email) : ""}${company.phone ? ` · ${escapeHtml(company.phone)}` : ""}`

	return `
<!doctype html>
<html>
<body style="margin:0;padding:0;background:${backgroundColour};font-family:Helvetica,Arial,sans-serif;color:${textColour};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${backgroundColour};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:${bodyBackgroundColour};border-radius:6px;overflow:hidden;">
        <!-- The header band carries the brand colour, as WooCommerce's does.
             Putting it only on the button would leave the setting invisible on
             most messages: an order confirmation has no button at all. -->
        <tr><td style="padding:24px 32px;background:${baseColour};">
          ${header}
        </td></tr>
        <tr><td style="padding:32px;color:${textColour};">
          <h1 style="margin:0 0 16px;font-size:20px;color:${textColour};">${escapeHtml(title)}</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">${escapeHtml(intro)}</p>
          ${bodyHtml}
          ${
						action
							? `<p style="margin:28px 0 0;">
                   <a href="${escapeHtml(action.url)}" style="display:inline-block;background:${baseColour};color:${onBase};text-decoration:none;padding:12px 22px;border-radius:4px;font-size:15px;">${escapeHtml(action.label)}</a>
                 </p>`
							: ""
					}
          ${
						additionalContent
							? `<div style="margin:28px 0 0;padding-top:20px;border-top:1px solid rgba(128,128,128,0.25);font-size:14px;line-height:1.6;">${paragraphs(additionalContent, "margin:0 0 10px;")}</div>`
							: ""
					}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(128,128,128,0.25);font-size:12px;color:${textColour};opacity:0.7;line-height:1.6;">
          ${footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Money/label rows for order and quote summaries. */
export const rowsTable = (rows: { label: string; value: string; strong?: boolean }[]): string => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;">
  ${rows
		.map(
			(r) => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid rgba(128,128,128,0.2);${r.strong ? "font-weight:bold;" : ""}">${escapeHtml(r.label)}</td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid rgba(128,128,128,0.2);${r.strong ? "font-weight:bold;" : ""}">${escapeHtml(r.value)}</td>
    </tr>`
		)
		.join("")}
</table>`

/** Plain-text fallback. Every client can read it, and spam filters expect it. */
export const toPlainText = (title: string, intro: string, lines: string[]): string =>
	[title, "", intro, "", ...lines].join("\n")
