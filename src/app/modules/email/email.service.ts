import type { LocaleCode } from "../../../config/locales"
import { prisma } from "../../../shared/prisma"
import { httpStatus } from "../../../shared/httpStatus"
import { interpolate, t } from "../../../i18n"
import { readBranding, type EmailBranding } from "../../../domain/email/branding"
import { captureMail, mailContext } from "../../../helpers/mailer/context"
import { esc } from "../../../helpers/mailer/layout"
import { isConfigured, sendMailNow } from "../../../helpers/mailer/transport"
import ApiError from "../../errors/ApiError"
import { SettingService } from "../setting/setting.service"
import { sendSample } from "./emailSamples"
import {
	EMAILS,
	EMAIL_KINDS,
	type EmailDefinition,
	type EmailKind,
	type EmailOverride,
	overrideKey,
	readOverride,
} from "./emailRegistry"

/**
 * What the admin has changed about each email, and what a sender should
 * actually use.
 *
 * Everything a sender needs arrives in one call — `prepare` returns null when
 * the mail is switched off, so the caller's only job is to stop. Reading the
 * flag separately from the branding would let a disabled mail still cost two
 * queries and, worse, let a caller forget the check.
 */

export interface PreparedEmail {
	branding: EmailBranding
	/** Admin override, already interpolated. Null means use the translated default. */
	subject: string | null
	heading: string | null
	additionalContent: string
	/** Staff mail only: the override, else the configured setting, else null. */
	recipient: string | null
}

const load = async (): Promise<{ settings: Record<string, unknown> }> => ({
	settings: await SettingService.getMap(),
})

const overrideFrom = (settings: Record<string, unknown>, kind: EmailKind): EmailOverride =>
	readOverride(kind, settings[overrideKey(kind)])

/**
 * Everything a sender needs, or null if the admin turned this mail off.
 *
 * `vars` are substituted into an admin-written subject or heading the same way
 * they are into the built-in one.
 */
const prepare = async (
	kind: EmailKind,
	vars?: Record<string, string | number>
): Promise<PreparedEmail | null> => {
	const { settings } = await load()
	const override = overrideFrom(settings, kind)

	// A switched-off email still renders in the preview — the admin has to be
	// able to see what they are about to turn on.
	if (!override.enabled && !mailContext()?.ignoreDisabled) return null

	const definition: EmailDefinition = EMAILS[kind]

	const configured =
		"recipientSetting" in definition && definition.recipientSetting
			? settings[definition.recipientSetting]
			: null

	const fallbackRecipient =
		typeof configured === "string" && configured.trim()
			? configured.trim()
			: typeof settings["mail.adminNotifyAddress"] === "string" &&
				  settings["mail.adminNotifyAddress"].trim()
				? settings["mail.adminNotifyAddress"].trim()
				: null

	return {
		branding: readBranding(settings),
		subject: override.subject ? interpolate(override.subject, vars) : null,
		heading: override.heading ? interpolate(override.heading, vars) : null,
		additionalContent: override.additionalContent,
		recipient:
			definition.audience === "staff"
				? override.recipient.trim() || fallbackRecipient
				: null,
	}
}

/** Branding alone, for the two account mails that compose their own layout. */
const branding = async (): Promise<EmailBranding> => readBranding(await SettingService.getMap())

const list = async () => {
	const { settings } = await load()

	return EMAIL_KINDS.map((kind) => ({
		key: kind,
		...EMAILS[kind],
		override: overrideFrom(settings, kind),
	}))
}

const get = async (kind: EmailKind) => {
	const { settings } = await load()

	return { key: kind, ...EMAILS[kind], override: overrideFrom(settings, kind) }
}

const save = async (kind: EmailKind, override: EmailOverride) => {
	await SettingService.setMany([
		{
			key: overrideKey(kind),
			// Normalised through the reader so a payload that slipped past
			// validation cannot store a shape the senders will not understand.
			value: readOverride(kind, override),
			isPublic: false,
		},
	])

	return get(kind)
}

const reset = async (kind: EmailKind) => {
	await prisma.setting.deleteMany({ where: { key: overrideKey(kind) } })
	return get(kind)
}

/**
 * Renders an email exactly as it would be sent, without sending it.
 *
 * Runs the real sender inside a capture context, so what comes back has been
 * through `prepare`, the branding, the overrides and the layout. If this ever
 * disagrees with a delivered message, the bug is real rather than an artefact
 * of the preview.
 */
const preview = async (kind: EmailKind, locale: LocaleCode) => {
	const { mails } = await captureMail(
		() => sendSample(kind, "preview@example.invalid", locale),
		{ ignoreDisabled: true }
	)

	const mail = mails[0]
	if (!mail) {
		throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, "That email produced nothing to preview", {
			messageKey: "email.previewFailed",
		})
	}

	return { subject: mail.subject, html: mail.html, text: mail.text }
}

/**
 * Sends the sample for real, to an address the admin names.
 *
 * Deliberately not captured and deliberately not gated on the enabled flag: the
 * question being asked is "does mail from this shop arrive and look right",
 * which a switched-off template cannot answer by refusing to send.
 */
const sendTest = async (kind: EmailKind, locale: LocaleCode, to: string) => {
	if (!(await isConfigured())) {
		throw new ApiError(httpStatus.CONFLICT, "No SMTP server is configured", {
			messageKey: "email.smtpMissing",
		})
	}

	/*
	 * Composed, marked, then sent — rather than sent straight out.
	 *
	 * A sample is otherwise indistinguishable from the real thing in an inbox,
	 * and the samples carry deliberately dead data: the password-reset one links
	 * to `?token=sample-token-not-valid`. Somebody received one, took it for a
	 * real reset, and reported the broken link as a bug in password recovery —
	 * which cost an afternoon to trace back to a preview.
	 *
	 * The banner sits above the message rather than replacing anything, so what
	 * the admin is checking — branding, wording, whether it arrives at all — is
	 * still exactly what a customer would get.
	 */
	const { mails } = await captureMail(() => sendSample(kind, to, locale), { ignoreDisabled: true })
	const mail = mails[0]

	if (!mail) {
		throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, "That email produced nothing to send", {
			messageKey: "email.previewFailed",
		})
	}

	const notice = t("email.sampleNotice", locale)

	const result = await sendMailNow({
		to,
		subject: `[${t("email.sampleTag", locale)}] ${mail.subject}`,
		html: `<div style="background:#fff4e5;border:1px solid #ffcc80;border-radius:6px;padding:12px 16px;margin:0 0 16px;font:14px/1.5 Arial,sans-serif;color:#7a4f00;">${esc(notice)}</div>${mail.html}`,
		text: `${notice}

${mail.text}`,
	})

	// Reported, not assumed. The admin asked whether it arrives; "we handed it
	// to a socket" is not an answer, and sendSample's own path is
	// fire-and-forget by design.
	if (!result.ok) {
		throw new ApiError(httpStatus.BAD_GATEWAY, result.message, { messageKey: "email.sendFailed" })
	}

	return { sent: true as const, to }
}

export const EmailService = {
	prepare,
	branding,
	list,
	get,
	save,
	reset,
	preview,
	sendTest,
	EMAILS,
	EMAIL_KINDS,
}
