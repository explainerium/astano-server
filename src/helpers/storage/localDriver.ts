import crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import { env } from "../../config"
import type { PutObject, StorageDriver, Visibility } from "./types"

/**
 * Development driver: writes to ./storage/{public,private}.
 *
 * Private files are still never served statically — they go through the same
 * signed-URL check as R2, so the authorisation path is exercised in
 * development rather than discovered in production.
 */
const ROOT = path.join(process.cwd(), "storage")

const dirFor = (visibility: Visibility): string =>
	path.join(ROOT, visibility === "PUBLIC" ? "public" : "private")

/** Rejects any key that would escape its bucket directory. */
const resolveSafe = (key: string, visibility: Visibility): string => {
	const base = dirFor(visibility)
	const full = path.resolve(base, key)

	if (!full.startsWith(base + path.sep)) {
		throw new Error(`Refusing path traversal in storage key: ${key}`)
	}

	return full
}

export const localDriver: StorageDriver = {
	name: "local",

	async put({ key, body, visibility }: PutObject): Promise<void> {
		const full = resolveSafe(key, visibility)
		await fs.mkdir(path.dirname(full), { recursive: true })
		await fs.writeFile(full, body)
	},

	async get(key: string, visibility: Visibility): Promise<Buffer> {
		return fs.readFile(resolveSafe(key, visibility))
	},

	async delete(key: string, visibility: Visibility): Promise<void> {
		try {
			await fs.unlink(resolveSafe(key, visibility))
		} catch (error) {
			// Deleting something already gone is success, not failure.
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		}
	},

	publicUrl(key: string): string {
		return `${env.PUBLIC_BASE_URL}/media/${key}`
	},

	async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
		// Mirrors R2's presigned URLs closely enough to be a real test of the
		// download route: expiry plus a signature, verified server-side.
		const expires = Math.floor(Date.now() / 1000) + expiresInSeconds
		const signature = crypto
			.createHmac("sha256", env.JWT_ACCESS_SECRET)
			.update(`${key}:${expires}`)
			.digest("hex")

		return `${env.PUBLIC_BASE_URL}/api/v1/media/download/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}`
	},

	async exists(key: string, visibility: Visibility): Promise<boolean> {
		try {
			await fs.access(resolveSafe(key, visibility))
			return true
		} catch {
			return false
		}
	},
}

/** Verifies a local signed URL. Unused by the R2 driver, which signs its own. */
export const verifyLocalSignature = (
	key: string,
	expires: number,
	signature: string
): boolean => {
	if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false

	const expected = crypto
		.createHmac("sha256", env.JWT_ACCESS_SECRET)
		.update(`${key}:${expires}`)
		.digest("hex")

	// Constant-time compare — a fast string compare leaks the signature byte by byte.
	const a = Buffer.from(expected)
	const b = Buffer.from(signature)
	return a.length === b.length && crypto.timingSafeEqual(a, b)
}
