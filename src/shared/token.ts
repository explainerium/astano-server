import crypto from "crypto"

/**
 * Opaque tokens for refresh and password reset.
 *
 * Only the SHA-256 hash is ever stored. A leaked database must not yield
 * working sessions or reset links — the same reason passwords are hashed.
 * These are high-entropy random values, so a fast hash is correct here;
 * bcrypt's work factor exists to slow down guessing of low-entropy secrets.
 */
export const generateToken = (): string => crypto.randomBytes(48).toString("hex")

export const hashToken = (token: string): string =>
	crypto.createHash("sha256").update(token).digest("hex")

/** Milliseconds from a duration like "30d", "15m", "1h". */
export const durationToMs = (duration: string): number => {
	const match = /^(\d+)([smhd])$/.exec(duration.trim())
	if (!match) throw new Error(`Invalid duration: ${duration}`)

	const value = Number(match[1])
	const unit = match[2] as "s" | "m" | "h" | "d"
	const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const

	return value * multipliers[unit]
}
