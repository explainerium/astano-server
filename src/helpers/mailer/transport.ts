import crypto from "crypto"
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
 *
 * The server is configured from the admin screen, falling back to the
 * environment. The client owns the mail account, and a provider that starts
 * rejecting mail on a Friday should not need a developer and a redeploy — it
 * should need somebody to paste a new key into Settings → Email → Mail server.
 */
export interface SmtpConfig {
	host: string
	port: number
	user: string
	pass: string
	/** Where the values came from, for the test screen to report honestly. */
	source: "settings" | "environment"
}

/**
 * Settings win, wholesale rather than field by field.
 *
 * A host from the database with a password from the environment is a
 * combination nobody configured and nobody can debug — it authenticates with
 * one provider's key against another provider's server. So the host decides:
 * set here, everything comes from here.
 */
const resolveConfig = async (): Promise<SmtpConfig | null> => {
	let host = ""
	let port = 0
	let user = ""

	try {
		const map = await SettingService.getMap()
		host = String(map["smtp.host"] ?? "").trim()
		port = Number(map["smtp.port"] ?? 0)
		user = String(map["smtp.user"] ?? "").trim()
	} catch (error) {
		// A database that cannot be read is not a reason to stop sending mail if
		// the environment can still say where to send it.
		logger.warn({ err: error }, "could not read the mail server settings — falling back to the environment")
	}

	if (host) {
		return {
			host,
			port: Number.isFinite(port) && port > 0 ? port : 587,
			user,
			pass: user ? await SettingService.readSecret("smtp.password") : "",
			source: "settings",
		}
	}

	if (!env.SMTP_HOST) return null

	return {
		host: env.SMTP_HOST,
		port: env.SMTP_PORT ?? 587,
		user: env.SMTP_USER ?? "",
		pass: env.SMTP_PASS ?? "",
		source: "environment",
	}
}

/**
 * One transport per configuration, rebuilt when the configuration changes.
 *
 * Nodemailer pools connections, so rebuilding per send would open a TCP and TLS
 * handshake for every order confirmation. Keyed on the configuration itself
 * rather than cached outright: the whole point of moving SMTP into settings is
 * that it can change while the process is running, and a transport cached under
 * no key would keep using the credentials that were current at boot.
 *
 * The password is hashed into the key rather than included, so the cache key
 * cannot become the thing that leaks it into a log line.
 */
let cached: { key: string; transport: Transporter } | null = null
let warned = false

const cacheKey = (config: SmtpConfig): string =>
	[
		config.host,
		config.port,
		config.user,
		crypto.createHash("sha256").update(config.pass).digest("base64url").slice(0, 16),
	].join("|")

export const isConfigured = async (): Promise<boolean> => Boolean(await resolveConfig())

const build = (config: SmtpConfig): Transporter => {
	const key = cacheKey(config)
	if (cached?.key === key) return cached.transport

	cached?.transport.close()

	const transport = nodemailer.createTransport({
		host: config.host,
		port: config.port,
		// 465 is implicit TLS; everything else upgrades with STARTTLS.
		secure: config.port === 465,
		...(config.user ? { auth: { user: config.user, pass: config.pass } } : {}),
	})

	cached = { key, transport }
	return transport
}

const getTransport = async (): Promise<Transporter | null> => {
	const config = await resolveConfig()
	return config ? build(config) : null
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

	void (async () => {
		const transport = await getTransport()

		if (!transport) {
			if (env.NODE_ENV === "production" && !warned) {
				warned = true
				logger.error("SMTP is not configured — no transactional email is being sent")
			}
			logger.info({ to: mail.to, subject: mail.subject, ...context }, "email (not sent — no SMTP)")
			return
		}

		await transport.sendMail({
			from: await resolveFrom(),
			to: mail.to,
			subject: mail.subject,
			html: mail.html,
			text: mail.text,
			replyTo: mail.replyTo,
		})

		logger.info({ to: mail.to, subject: mail.subject, ...context }, "email sent")
	})().catch((error: unknown) =>
		logger.error({ err: error, to: mail.to, subject: mail.subject, ...context }, "email FAILED")
	)
}

/**
 * Sends and waits, reporting what happened.
 *
 * `sendMail` is deliberately fire-and-forget — an order must not fail because a
 * mail server is slow. This is the opposite case: an admin pressing "send a
 * test" is asking precisely whether it works, and an answer of "we have
 * dispatched it into the void" is not one.
 *
 * Never throws. The failure *is* the result here, and the SMTP message is the
 * useful part of it — "Invalid login: 535 authentication failed" tells the
 * admin they pasted the account password instead of the SMTP key, which no
 * generic error of ours would.
 */
export interface SendResult {
	ok: boolean
	message: string
	/** Which configuration was used, so a surprising result is explicable. */
	source?: SmtpConfig["source"]
	host?: string
}

export const sendMailNow = async (mail: Mail): Promise<SendResult> => {
	const config = await resolveConfig()

	if (!config) {
		return {
			ok: false,
			message: "No mail server is configured. Fill in the server and username above, then save.",
		}
	}

	const where = { source: config.source, host: `${config.host}:${config.port}` }

	try {
		await build(config).sendMail({
			from: await resolveFrom(),
			to: mail.to,
			subject: mail.subject,
			html: mail.html,
			text: mail.text,
		})

		logger.info({ to: mail.to, ...where }, "test email sent")
		return { ok: true, message: `Sent to ${mail.to}.`, ...where }
	} catch (error) {
		logger.warn({ err: error, to: mail.to, ...where }, "test email failed")

		return {
			ok: false,
			// Nodemailer puts the server's own refusal in `message`. It is the
			// only part of this worth reading.
			message: error instanceof Error ? error.message : "The mail server refused the message.",
			...where,
		}
	}
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
