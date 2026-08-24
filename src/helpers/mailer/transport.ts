import crypto from "crypto"
import { waitUntil } from "@vercel/functions"
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
	/**
	 * A password is stored, and this deployment cannot decrypt it. Distinct from
	 * having none: the fix is the encryption key, not the password.
	 */
	unreadablePassword: boolean
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
		/*
		 * A password that is stored but cannot be decrypted is not a missing
		 * password, and saying so is the difference between a five-minute fix and
		 * an afternoon.
		 *
		 * It happens when the credential was saved under a different
		 * `CREDENTIALS_KEY` — a developer's laptop and the deployment, most
		 * often. Left to fall through as an empty string it reaches nodemailer as
		 * `Missing credentials for "PLAIN"`, which reads as "wrong password" and
		 * sends whoever is looking to re-type one that was always correct.
		 */
		const secret = user
			? await SettingService.readSecretDetailed("smtp.password")
			: { value: "", stored: false, readable: true }

		return {
			host,
			port: Number.isFinite(port) && port > 0 ? port : 587,
			user,
			pass: secret.value,
			unreadablePassword: secret.stored && !secret.readable,
			source: "settings",
		}
	}

	if (!env.SMTP_HOST) return null

	return {
		host: env.SMTP_HOST,
		port: env.SMTP_PORT ?? 587,
		user: env.SMTP_USER ?? "",
		pass: env.SMTP_PASS ?? "",
		unreadablePassword: false,
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
		// Nodemailer waits two minutes by default, which outlives every deadline
		// around it — the serverless budget, the admin screen's own timeout, and
		// the patience of whoever is watching a spinner.
		connectionTimeout: 15_000,
		greetingTimeout: 15_000,
		socketTimeout: 30_000,
	})

	cached = { key, transport }
	return transport
}

/**
 * Failures worth trying again, and failures that are answers.
 *
 * A refused password is a configuration problem: retrying it three times gets
 * the account locked and tells nobody anything. A connection that timed out is
 * not — mail servers throttle bursts, and netcup dropped five consecutive
 * connections during a test that sent twenty-two messages back to back, all of
 * which went through on the next attempt.
 *
 * The distinction matters because these sends are unattended. Nothing retries
 * an order confirmation by hand; if it is lost here it is lost, and the
 * customer is left holding a receipt the shop never acknowledged.
 */
const TRANSIENT = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ESOCKET", "EDNS"])

const isTransient = (error: unknown): boolean => {
	const code = (error as { code?: string })?.code
	return Boolean(code && TRANSIENT.has(code))
}

/*
 * Two attempts, three seconds apart, against a fifteen-second connect timeout:
 * a worst case of about thirty-three seconds.
 *
 * Sized by the platform, not by taste. Vercel gives the function sixty seconds
 * and `waitUntil` does not extend that, so a retry chain that could run to
 * seventy-two — which the first version did — is a chain the instance gets
 * killed in the middle of. Losing the email to our own timeout instead of the
 * mail server's is not an improvement.
 */
const ATTEMPTS = 2
const BACKOFF_MS = 3_000

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One send, retried while the failure looks like the network rather than us.
 *
 * Deliberately linear rather than exponential: the thing being waited out is a
 * few seconds of server-side throttling, and a third attempt sixteen seconds
 * later is past the point where a serverless instance is still being held open
 * for it.
 */
const deliver = async (transport: Transporter, message: Parameters<Transporter["sendMail"]>[0]): Promise<void> => {
	for (let attempt = 1; ; attempt += 1) {
		try {
			await transport.sendMail(message)
			return
		} catch (error) {
			if (attempt >= ATTEMPTS || !isTransient(error)) throw error

			logger.warn(
				{ err: error, attempt, of: ATTEMPTS },
				"the mail server did not accept the connection — trying again"
			)
			await delay(BACKOFF_MS)
		}
	}
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

	/*
	 * Registered with the platform on serverless, simply started elsewhere.
	 *
	 * A long-running server keeps running after it has answered, so an unawaited
	 * send finishes on its own — which is the whole design above, and the reason
	 * an order does not fail because a mail server is slow.
	 *
	 * A serverless instance does not. It is **frozen the moment the response is
	 * sent**, mid-TLS-handshake if that is where the send happened to be, and
	 * thawed later for an unrelated request by which time the socket is long
	 * dead. The email is not delayed, it is lost, and nothing anywhere records
	 * that it was — the log line saying it failed never runs either.
	 *
	 * `waitUntil` is the platform's answer: it holds the instance open until
	 * the promise settles, without holding up the response. Outside Vercel it is
	 * neither needed nor available, hence the guard.
	 *
	 * Note this is exactly why the test-send button uses `sendMailNow`, which
	 * awaits: a test that passed while every real email vanished would be worse
	 * than no test at all.
	 */
	const work = (async () => {
		const transport = await getTransport()

		if (!transport) {
			if (env.NODE_ENV === "production" && !warned) {
				warned = true
				logger.error("SMTP is not configured — no transactional email is being sent")
			}
			logger.info({ to: mail.to, subject: mail.subject, ...context }, "email (not sent — no SMTP)")
			return
		}

		await deliver(transport, {
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

	if (process.env.VERCEL) waitUntil(work)
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

	/*
	 * Named before the send is attempted, because the attempt cannot say it.
	 *
	 * With no password nodemailer answers `Missing credentials for "PLAIN"`,
	 * which reads as "the password is wrong". It is not: the password is there
	 * and correct, and this deployment simply holds a different
	 * `CREDENTIALS_KEY` than the one that sealed it. That distinction is the
	 * difference between re-entering it once and re-entering it repeatedly while
	 * wondering why it never takes.
	 */
	if (config.unreadablePassword) {
		logger.error({ ...where }, "the stored SMTP password cannot be decrypted by this deployment")

		return {
			ok: false,
			message:
				"The saved password cannot be read by this deployment — it was encrypted with a " +
				"different CREDENTIALS_KEY. Enter the password again here and save.",
			...where,
		}
	}

	try {
		// One attempt, deliberately. `deliver` retries because nothing is watching
		// an order confirmation; here somebody is, and a timeout repeated twice is
		// the same answer thirty seconds later.
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
