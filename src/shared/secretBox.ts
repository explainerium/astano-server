import crypto from "crypto"
import { env } from "../config"

/**
 * Encryption for secrets that have to live in the database.
 *
 * API keys are not passwords. A password is verified, so hashing it is enough
 * and nobody ever needs the original back. A Stripe secret key has to be *sent*
 * to Stripe on every call, so it must be recoverable — which means encryption,
 * not hashing.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt rather
 * than quietly producing rubbish that then gets sent to a payment provider.
 *
 * The one key that is not in the database is the one protecting everything that
 * is. `CREDENTIALS_KEY` stays in the environment, which is the whole point: a
 * leaked database dump without it yields nothing usable.
 */

/** version.iv.tag.ciphertext — all base64url, dot-separated. */
const VERSION = "v1"

let cachedKey: Buffer | null = null

/**
 * The master key, derived once.
 *
 * Accepts either 64 hex characters (32 raw bytes, what `openssl rand -hex 32`
 * gives) or any other string, which is stretched with scrypt. The hex path is
 * preferred and is what the deployment docs ask for; the fallback exists so a
 * developer typing a passphrase into .env gets working encryption rather than a
 * crash, and so a short key can never silently become a weak one.
 */
/** The placeholder in env.ts. Fine locally, never acceptable in production. */
const DEV_KEY = "dev-credentials-key-change-me-please"

/**
 * Refuses to encrypt a real credential with the development placeholder.
 *
 * Checked here rather than at boot on purpose. Failing at startup would break a
 * deployment that has nothing to do with payments — the shop would go down over
 * a variable it was not yet using. This fails at the exact moment it matters:
 * somebody is about to store a live API key under a key that is published in
 * the repository.
 */
const assertUsableKey = () => {
	if (env.NODE_ENV === "production" && env.CREDENTIALS_KEY === DEV_KEY) {
		throw new Error(
			"CREDENTIALS_KEY is still the development placeholder. Set a real one " +
				"(openssl rand -hex 32) in the hosting dashboard before saving payment credentials."
		)
	}
}

const masterKey = (): Buffer => {
	if (cachedKey) return cachedKey

	const configured = env.CREDENTIALS_KEY

	cachedKey = /^[0-9a-f]{64}$/i.test(configured)
		? Buffer.from(configured, "hex")
		: // A fixed salt, deliberately. The key is a single long-lived secret, not
			// a user password — per-value salts would mean storing a salt beside
			// every ciphertext to derive the same key each time, which buys nothing
			// here and only adds a way to get it wrong.
			crypto.scryptSync(configured, "astano.credentials.v1", 32)

	return cachedKey
}

/** Encrypts a secret for storage. Returns an opaque string; never log it. */
export const seal = (plaintext: string): string => {
	assertUsableKey()

	const iv = crypto.randomBytes(12)
	const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv)

	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
	const tag = cipher.getAuthTag()

	return [VERSION, iv, tag, ciphertext]
		.map((part) => (typeof part === "string" ? part : part.toString("base64url")))
		.join(".")
}

/**
 * Recovers a sealed secret.
 *
 * Throws on anything that is not intact: wrong key, tampered value, a format
 * from a future version. Callers should let that surface rather than falling
 * back to an empty string — a payment call made with a blank key fails in a far
 * more confusing way than one that never happened.
 */
export const open = (sealed: string): string => {
	const [version, iv, tag, ciphertext] = sealed.split(".")

	if (version !== VERSION || !iv || !tag || !ciphertext) {
		throw new Error("Stored secret is not in a recognised format")
	}

	const decipher = crypto.createDecipheriv(
		"aes-256-gcm",
		masterKey(),
		Buffer.from(iv, "base64url")
	)
	decipher.setAuthTag(Buffer.from(tag, "base64url"))

	return Buffer.concat([
		decipher.update(Buffer.from(ciphertext, "base64url")),
		decipher.final(),
	]).toString("utf8")
}

/**
 * What the admin screen is allowed to see: enough to recognise a key, not
 * enough to use it.
 *
 * Stripe's own dashboard does the same thing, so `sk_live_••••4242` reads as
 * familiar rather than broken. Short values are masked entirely — revealing the
 * last four characters of an eight-character secret gives away half of it.
 */
export const maskSecret = (plaintext: string): string => {
	const trimmed = plaintext.trim()
	if (trimmed.length < 12) return "••••"

	/*
	 * Provider prefixes are not secret, and they are the part that tells an admin
	 * they pasted the right *kind* of key — a live secret key where a webhook
	 * secret belongs is otherwise two indistinguishable rows of dots.
	 *
	 * Two shapes: sk_live_ / pk_test_ carry the mode, whsec_ and friends do not.
	 */
	const prefix = /^([a-z]{2,6}_(?:live_|test_)?)/i.exec(trimmed)?.[1] ?? ""
	return `${prefix}••••${trimmed.slice(-4)}`
}
