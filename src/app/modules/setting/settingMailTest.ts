import type { LocaleCode } from "../../../config/locales"
import { renderLayout, toPlainText } from "../../../helpers/mailer/layout"
import { sendMailNow, type SendResult } from "../../../helpers/mailer/transport"
import { t } from "../../../i18n"
import { EmailService } from "../email/email.service"
import { SettingService } from "./setting.service"

/**
 * The mail server's own test send.
 *
 * Separate from `EmailService.sendTest`, which renders one of the shop's
 * templates to check that it *reads* right. This one answers a different
 * question — does the server accept our credentials at all — and answers it
 * before any template exists to preview. It is the first thing a new shop needs
 * and the first thing to check when mail stops arriving.
 *
 * In its own file to keep the dependency graph acyclic: the transport reads its
 * configuration from the settings, so the settings service cannot in turn reach
 * into the transport. Everything that needs both lives here.
 */
export const sendTestMail = async (to: string, locale: LocaleCode): Promise<SendResult> => {
	const company = await SettingService.getCompany()
	const branding = await EmailService.branding()

	const L = (key: string, vars?: Record<string, string | number>) => t(key, locale, vars)
	const title = L("setting.mailTest.title")
	const intro = L("setting.mailTest.intro", { shop: company.name || "astano" })

	/*
	 * Sent through the real layout, with the real branding and the real company
	 * footer.
	 *
	 * A bare "test" line would prove the connection and nothing else. This
	 * arrives looking exactly like an order confirmation will, so the same one
	 * send also shows the admin whether the logo resolves, whether the colours
	 * survived their mail client, and whether the footer address is the one they
	 * meant to publish — the three things that are otherwise discovered by a
	 * customer.
	 */
	return sendMailNow({
		to,
		subject: L("setting.mailTest.subject", { shop: company.name || "astano" }),
		html: renderLayout({ title, intro, bodyHtml: "", company, branding }),
		text: toPlainText(title, intro, []),
	})
}
