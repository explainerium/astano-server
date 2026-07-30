import nodemailer, { type Transporter } from "nodemailer"
import { env } from "../../config"
import { logger } from "../../shared/logger"

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
	const transport = getTransport()

	if (!transport) {
		if (env.NODE_ENV === "production" && !warned) {
			warned = true
			logger.error("SMTP is not configured — no transactional email is being sent")
		}
		logger.info({ to: mail.to, subject: mail.subject, ...context }, "email (not sent — no SMTP)")
		return
	}

	const from = env.MAIL_FROM ?? env.SMTP_USER ?? "no-reply@astano.de"

	void transport
		.sendMail({ from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, replyTo: mail.replyTo })
		.then(() => logger.info({ to: mail.to, subject: mail.subject, ...context }, "email sent"))
		.catch((error: unknown) =>
			logger.error({ err: error, to: mail.to, subject: mail.subject, ...context }, "email FAILED")
		)
}
