import nodemailer, { type Transporter } from "nodemailer"
import { SettingService } from "../../app/modules/setting/setting.service"
import { env } from "../../config"
import { logger } from "../../shared/logger"
import { mailContext } from "./context"

/**
 * Outgoing mail.
 *
 * With no SMTP configured the transport logs instead of sending, so development
 * works without credentials and nothing silently fails. In production a missing
 * configuration is loud, because an order confirmation that never arrives is
 * indistinguishable from an order that never happened.
 */
let transporter: Transporter | null = null
let warned = false

export const isConfigured = (): boolean => Boolean(env.SMTP_HOST)

const getTransport = (): Transporter | null => {
	if (!isConfigured()) return null
	if (transporter) return transporter

	transporter = nodemailer.createTransport({
		host: env.SMTP_HOST,
		port: env.SMTP_PORT ?? 587,
		// 465 is implicit TLS; everything else upgrades with STARTTLS.
		secure: (env.SMTP_PORT ?? 587) === 465,
		...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
	})

	return transporter
}

export interface Mail {
	to: string
	subject: string
	html: string
	text: string
	replyTo?: string
}

/**
 * Sends without blocking the caller.
 *
 * A customer's order must not fail because a mail server is slow, and it must
 * certainly not fail because one is down. Failures are logged with enough
 * context to resend by hand.
 */
export const sendMail = (mail: Mail, context: Record<string, unknown> = {}): void => {
	// Preview: hand the composed message back instead of delivering it. Checked
	// before the transport, so a preview cannot escape even on a fully
	// configured production server.
	const capture = mailContext()?.capture
	if (capture) {
		capture.push(mail)
		return
	}

	const transport = getTransport()

	if (!transport) {
		if (env.NODE_ENV === "production" && !warned) {
			warned = true
			logger.error("SMTP is not configured — no transactional email is being sent")
		}
		logger.info({ to: mail.to, subject: mail.subject, ...context }, "email (not sent — no SMTP)")
		return
	}

	void resolveFrom()
		.then((from) =>
			transport.sendMail({
				from,
				to: mail.to,
				subject: mail.subject,
				html: mail.html,
				text: mail.text,
				replyTo: mail.replyTo,
			})
		)
		.then(() => logger.info({ to: mail.to, subject: mail.subject, ...context }, "email sent"))
		.catch((error: unknown) =>
			logger.error({ err: error, to: mail.to, subject: mail.subject, ...context }, "email FAILED")
		)
}

/**
 * Who the mail comes from: the admin's setting, else the environment.
 *
 * Resolved per send rather than cached, so changing it in the dashboard takes
 * effect on the next email instead of the next deploy. The read is one indexed
 * query against a table of about thirty rows, on a path that is already waiting
 * on an SMTP handshake.
 *
 * Falls back to the environment on any failure. A wrong-but-valid sender still
 * delivers the order confirmation; refusing to send would not.
 */
export const resolveFrom = async (): Promise<string> => {
	const fallback = env.MAIL_FROM ?? env.SMTP_USER ?? "no-reply@astano.de"

	try {
		const map = await SettingService.getMap()
		const name = typeof map["mail.fromName"] === "string" ? map["mail.fromName"].trim() : ""
		const address =
			typeof map["mail.fromAddress"] === "string" && map["mail.fromAddress"].trim()
				? map["mail.fromAddress"].trim()
				: fallback

		return name ? `"${name.replace(/"/g, "")}" <${address}>` : address
	} catch (error) {
		logger.warn({ err: error }, "could not read the sender settings — using the configured default")
		return fallback
	}
}
