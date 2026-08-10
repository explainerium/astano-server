import { logger } from "../../../shared/logger"

/**
 * Fetches an image named in an imported CSV.
 *
 * The URLs come from a file an admin uploaded, which means the server is being
 * asked to make requests to addresses someone else chose. That is server-side
 * request forgery whatever the intent behind the file, so the target is checked
 * before anything is opened: loopback, link-local and private ranges are
 * refused, because those are not on the internet — they are this machine, the
 * database, and the cloud metadata endpoint that hands out credentials.
 *
 * Everything here fails soft. An image that cannot be fetched is a note on one
 * row, never a failed import.
 */

const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 15_000

/** Refuses anything that is not a public address. */
const isPrivateHost = (hostname: string): boolean => {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")

	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return true

	// IPv6 loopback and unique-local.
	if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80"))
		return true

	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
	if (!v4) return false

	const [a, b] = [Number(v4[1]), Number(v4[2])]

	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) || // link-local, and the cloud metadata address
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127) ||
		a >= 224
	)
}

export interface FetchedImage {
	buffer: Buffer
	mimetype: string
	originalname: string
	size: number
}

export const fetchImage = async (
	url: string
): Promise<{ ok: true; image: FetchedImage } | { ok: false; reason: string }> => {
	let parsed: URL

	try {
		parsed = new URL(url)
	} catch {
		return { ok: false, reason: "not a valid URL" }
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { ok: false, reason: "only http and https are fetched" }
	}

	if (isPrivateHost(parsed.hostname)) {
		return { ok: false, reason: "refused a private or local address" }
	}

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

	try {
		const response = await fetch(parsed.toString(), {
			signal: controller.signal,
			// Following a redirect can land on a private address the check above
			// never saw, so redirects are read rather than followed.
			redirect: "manual",
		})

		if (response.status >= 300 && response.status < 400) {
			return { ok: false, reason: `redirected (${response.status}) — link to the final image` }
		}

		if (!response.ok) return { ok: false, reason: `server said ${response.status}` }

		const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()
		if (!type.startsWith("image/")) return { ok: false, reason: `not an image (${type || "no type"})` }

		const declared = Number(response.headers.get("content-length") ?? 0)
		if (declared > MAX_BYTES) return { ok: false, reason: "larger than 10 MB" }

		const buffer = Buffer.from(await response.arrayBuffer())

		// Checked again after reading: content-length is a claim, not a promise.
		if (buffer.byteLength > MAX_BYTES) return { ok: false, reason: "larger than 10 MB" }

		const name = decodeURIComponent(parsed.pathname.split("/").pop() || "image")

		return {
			ok: true,
			image: { buffer, mimetype: type, originalname: name, size: buffer.byteLength },
		}
	} catch (error) {
		const reason =
			(error as Error)?.name === "AbortError" ? "timed out" : ((error as Error)?.message ?? "failed")

		logger.warn({ url, err: error }, "import: could not fetch an image")
		return { ok: false, reason }
	} finally {
		clearTimeout(timer)
	}
}
