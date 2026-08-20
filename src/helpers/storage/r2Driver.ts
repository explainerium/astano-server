import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { env } from "../../config"
import { logger } from "../../shared/logger"
import type { PutObject, StorageDriver, Visibility } from "./types"

/**
 * Any S3-compatible object store, driven by the AWS SDK.
 *
 * Cloudflare R2 is the default and the reason for the R2_ prefixes, but
 * nothing here is R2-specific: set S3_ENDPOINT and this speaks to Supabase
 * Storage, Backblaze B2, MinIO or AWS itself. That matters because R2 asks for
 * a card even on its free tier, and a test deployment should not be blocked on
 * billing.
 *
 * Two buckets rather than one with prefixes: a misconfigured prefix rule would
 * expose customer design files, whereas a bucket that is simply never public
 * cannot leak that way.
 */
let client: S3Client | null = null

const s3 = (): S3Client => {
	if (client) return client

	const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, S3_ENDPOINT } = env

	if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
		throw new Error(
			"S3 storage is selected but R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not set"
		)
	}

	// R2 derives its endpoint from the account id; every other provider gives
	// you the endpoint directly.
	const endpoint = S3_ENDPOINT ?? (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null)

	if (!endpoint) {
		throw new Error("Set S3_ENDPOINT, or R2_ACCOUNT_ID to use Cloudflare R2")
	}

	client = new S3Client({
		region: env.S3_REGION,
		endpoint,
		forcePathStyle: env.S3_FORCE_PATH_STYLE,
		credentials: {
			accessKeyId: R2_ACCESS_KEY_ID,
			secretAccessKey: R2_SECRET_ACCESS_KEY,
		},
	})

	return client
}

const bucketFor = (visibility: Visibility): string => {
	const bucket = visibility === "PUBLIC" ? env.R2_BUCKET_MEDIA : env.R2_BUCKET_FILES
	if (!bucket) throw new Error(`No R2 bucket configured for ${visibility} objects`)
	return bucket
}

/**
 * Said once, the first time a URL is built without somewhere to point it.
 *
 * Unset, `publicUrl` returns `/2026/08/x.webp` — a *relative* URL, which the
 * browser resolves against the storefront and which 404s. Every image on the
 * site breaks, and nothing anywhere says why: the API answered 200, the product
 * has an image, and the URL looks almost right.
 *
 * Raised here rather than at boot because a deployment is entitled to run
 * without object storage configured until something actually needs it.
 */
let warnedNoPublicUrl = false

const warnIfNoPublicUrl = (): void => {
	if (warnedNoPublicUrl || env.R2_PUBLIC_URL) return

	warnedNoPublicUrl = true
	logger.error(
		"R2_PUBLIC_URL is not set while the S3 driver is selected — every image URL is " +
			"relative and will 404. Set it to the bucket's public base, including the bucket name."
	)
}

export const r2Driver: StorageDriver = {
	name: "r2",

	async put({ key, body, contentType, visibility }: PutObject): Promise<void> {
		await s3().send(
			new PutObjectCommand({
				Bucket: bucketFor(visibility),
				Key: key,
				Body: body,
				ContentType: contentType,
			})
		)
	},

	async delete(key: string, visibility: Visibility): Promise<void> {
		await s3().send(
			new DeleteObjectCommand({ Bucket: bucketFor(visibility), Key: key })
		)
	},

	publicUrl(key: string): string {
		// R2 public buckets are served through a custom domain or the r2.dev
		// subdomain; either way it is configuration, not something to derive.
		warnIfNoPublicUrl()
		return `${env.R2_PUBLIC_URL ?? ""}/${key}`
	},

	async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
		return getSignedUrl(
			s3(),
			new GetObjectCommand({ Bucket: bucketFor("PRIVATE"), Key: key }),
			{ expiresIn: expiresInSeconds }
		)
	},

	async exists(key: string, visibility: Visibility): Promise<boolean> {
		try {
			await s3().send(
				new HeadObjectCommand({ Bucket: bucketFor(visibility), Key: key })
			)
			return true
		} catch {
			return false
		}
	},
}
