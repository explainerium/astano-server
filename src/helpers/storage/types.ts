/**
 * Storage abstraction.
 *
 * Two buckets with genuinely different rules (§12.3):
 *
 *   PUBLIC   product images — served straight from a CDN URL
 *   PRIVATE  customer design files (STL/STP/AI/EPS) — reachable only through a
 *            short-lived signed URL, and only by the owner or an admin
 *
 * The driver is chosen by config, so development runs on local disk and
 * production on R2 without a line of module code changing. Nothing outside
 * this folder knows which is in use.
 */

export type Visibility = "PUBLIC" | "PRIVATE"

export interface PutObject {
	key: string
	body: Buffer
	contentType: string
	visibility: Visibility
}

export interface StorageDriver {
	readonly name: string

	put(object: PutObject): Promise<void>

	delete(key: string, visibility: Visibility): Promise<void>

	/** Permanent URL for a public object. */
	publicUrl(key: string): string

	/**
	 * Time-limited URL for a private object. Design files are production input —
	 * a permanent link to one is a leak that never closes.
	 */
	signedUrl(key: string, expiresInSeconds: number): Promise<string>

	exists(key: string, visibility: Visibility): Promise<boolean>
}
