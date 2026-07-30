import type { CompanyDetails } from "../../app/modules/setting/setting.service"

/**
 * Email HTML.
 *
 * Table-based and inline-styled on purpose — Outlook and several webmail
 * clients still strip <style> blocks and ignore flexbox, so anything cleverer
 * arrives broken. This is one of the few places where dated markup is the
 * correct choice.
 */
const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")

export const esc = escapeHtml

export interface LayoutInput {
	title: string
	intro: string
	bodyHtml: string
	company: CompanyDetails
	/// Optional call to action.
	action?: { label: string; url: string }
}

export const renderLayout = ({ title, intro, bodyHtml, company, action }: LayoutInput): string => `
<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;color:#272727;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;">
        <tr><td style="padding:24px 32px;border-bottom:1px solid #e5e5e5;">
          <div style="font-size:20px;font-weight:bold;">${escapeHtml(company.name || "astano")}</div>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(title)}</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">${escapeHtml(intro)}</p>
          ${bodyHtml}
          ${
						action
							? `<p style="margin:28px 0 0;">
                   <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#272727;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:4px;font-size:15px;">${escapeHtml(action.label)}</a>
                 </p>`
							: ""
					}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e5e5e5;font-size:12px;color:#777777;line-height:1.6;">
          ${escapeHtml(company.name)}${company.street ? ` · ${escapeHtml(company.street)}` : ""}${company.postcode || company.city ? ` · ${escapeHtml(`${company.postcode} ${company.city}`.trim())}` : ""}<br>
          ${company.vatId ? `VAT ${escapeHtml(company.vatId)} · ` : ""}${company.email ? escapeHtml(company.email) : ""}${company.phone ? ` · ${escapeHtml(company.phone)}` : ""}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

/** Money/label rows for order and quote summaries. */
export const rowsTable = (rows: { label: string; value: string; strong?: boolean }[]): string => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;">
  ${rows
		.map(
			(r) => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #eeeeee;${r.strong ? "font-weight:bold;" : ""}">${escapeHtml(r.label)}</td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid #eeeeee;${r.strong ? "font-weight:bold;" : ""}">${escapeHtml(r.value)}</td>
    </tr>`
		)
		.join("")}
</table>`

/** Plain-text fallback. Every client can read it, and spam filters expect it. */
export const toPlainText = (title: string, intro: string, lines: string[]): string =>
	[title, "", intro, "", ...lines].join("\n")
