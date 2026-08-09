/**
 * How every email looks.
 *
 * These values are interpolated straight into `style="..."` attributes, so they
 * are validated rather than trusted. A setting is admin-only, but "only an
 * admin can set it" is not the same as "it cannot be wrong": a pasted value
 * with a quote in it would break out of the attribute and corrupt the markup of
 * every email the shop sends, and the failure would show up in customers'
 * inboxes rather than here.
 *
 * Anything that is not a plain hex colour falls back to the default.
 */

export interface EmailBranding {
	/** Absolute URL of a logo shown in the header. Empty means the shop name as text. */
	headerImage: string
	/** Buttons and accents. */
	baseColour: string
	/** Behind the card. */
	backgroundColour: string
	/** The card itself. */
	bodyBackgroundColour: string
	textColour: string
	/** Replaces the company address block when set. */
	footerText: string
}

export const DEFAULT_BRANDING: EmailBranding = {
	headerImage: "",
	baseColour: "#272727",
	backgroundColour: "#f5f5f5",
	bodyBackgroundColour: "#ffffff",
	textColour: "#272727",
	footerText: "",
}

/** #rgb, #rrggbb or #rrggbbaa. Nothing else reaches a style attribute. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

const colour = (value: unknown, fallback: string): string =>
	typeof value === "string" && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback

/**
 * Only http(s), and only an absolute URL.
 *
 * A `javascript:` or `data:` src in an <img> is inert in most mail clients but
 * not in the browser preview this same markup is rendered into, and a relative
 * path cannot resolve out of an inbox anyway.
 */
const imageUrl = (value: unknown): string => {
	if (typeof value !== "string" || !value.trim()) return ""

	try {
		const url = new URL(value.trim())
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : ""
	} catch {
		return ""
	}
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

export const readBranding = (settings: Record<string, unknown>): EmailBranding => ({
	headerImage: imageUrl(settings["email.headerImage"]),
	baseColour: colour(settings["email.baseColour"], DEFAULT_BRANDING.baseColour),
	backgroundColour: colour(settings["email.backgroundColour"], DEFAULT_BRANDING.backgroundColour),
	bodyBackgroundColour: colour(
		settings["email.bodyBackgroundColour"],
		DEFAULT_BRANDING.bodyBackgroundColour
	),
	textColour: colour(settings["email.textColour"], DEFAULT_BRANDING.textColour),
	footerText: text(settings["email.footerText"]),
})

/**
 * A readable foreground for a given background.
 *
 * The admin picks a base colour for buttons but not the text on them, and white
 * on a pale yellow button is unreadable. Uses the WCAG relative-luminance
 * formula rather than a plain average, because the eye is far more sensitive to
 * green than to blue and averaging gets mid-tones wrong.
 */
export const readableOn = (hex: string): string => {
	const value = hex.replace("#", "")
	const full =
		value.length === 3
			? value
					.split("")
					.map((c) => c + c)
					.join("")
			: value.slice(0, 6)

	const channel = (offset: number): number => {
		const srgb = parseInt(full.slice(offset, offset + 2), 16) / 255
		return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
	}

	const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)

	return luminance > 0.45 ? "#000000" : "#ffffff"
}
