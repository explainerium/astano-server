/**
 * Environment validation. The process must not start with a half-configured
 * environment — a missing R2 secret should fail at boot, not at the first
 * customer upload.
 */
import "dotenv/config"
import { z } from "zod"

/**
 * The signing placeholders, named so the production guard below can recognise
 * them rather than repeating the strings.
 *
 * They exist so a developer can clone the repository and have a working login
 * without generating anything. That convenience is also the danger: they are
 * published here, so a deployment that reaches production still holding one is
 * a deployment where anybody who has read this file can mint an admin token.
 */
export const DEV_JWT_SECRETS = {
	access: "dev-access-secret-change-me",
	refresh: "dev-refresh-secret-change-me",
} as const

const envSchema = z.object({
	NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
	PORT: z.coerce.number().int().positive().default(5000),

	DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

	// Auth — placeholders are fine in development, never in production. Enforced
	// at the bottom of this file, not merely asked for in this comment.
	JWT_ACCESS_SECRET: z.string().min(1).default(DEV_JWT_SECRETS.access),
	JWT_REFRESH_SECRET: z.string().min(1).default(DEV_JWT_SECRETS.refresh),
	JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
	JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

	/**
	 * Encrypts the payment credentials the client enters in the dashboard.
	 *
	 * The one secret that stays in the environment, because it is what protects
	 * every secret that does not. A database dump without this yields no usable
	 * API keys.
	 *
	 * Generate with:
	 *   openssl rand -hex 32
	 *
	 * **Changing it makes every stored credential unreadable** — the client would
	 * have to paste their Stripe and PayPal keys in again. Treat it as permanent
	 * once a gateway is live, and set it in the hosting dashboard, never here.
	 */
	CREDENTIALS_KEY: z.string().min(16).default("dev-credentials-key-change-me-please"),

	/// Where the API is reachable — used to build media URLs.
	/**
	 * This API's own origin, trailing slash stripped.
	 *
	 * Every link built from it is `PUBLIC_BASE_URL + "/something"`, so a value
	 * pasted with a trailing slash — which is what a hosting dashboard's copy
	 * button usually hands you — produces `https://host//media/…` in emails and
	 * media URLs. Browsers forgive it, which is exactly why it survives to
	 * production. Normalised here so no consumer has to remember.
	 */
	PUBLIC_BASE_URL: z
		.string()
		.default("http://localhost:5000")
		.transform((value) => value.replace(/\/+$/, "")),

	/**
	 * Where the **shop** is, which is not where this API is.
	 *
	 * Every link in every email was built from `PUBLIC_BASE_URL`, and that is the
	 * API's own origin — so a password reset arrived pointing at
	 * `https://astano-api.…/reset-password?token=…`, which is not a page, does
	 * not exist, and answers with a 404 in JSON. The same went for the welcome
	 * mail, the quote links and the account links.
	 *
	 * Optional, and left empty it falls back to the first entry in
	 * `CORS_ORIGINS` — which is by definition the site allowed to call this API,
	 * and is right on every deployment that exists today. Set it explicitly when
	 * several origins are allowed and the first is not the customer-facing one.
	 */
	SHOP_BASE_URL: z
		.string()
		.optional()
		.transform((value) => value?.replace(/\/+$/, "")),

	/// "local" writes to ./storage and is the development default. "r2" requires
	/// the R2_* values below.
	STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),

	/**
	 * Object storage credentials.
	 *
	 * The R2_ prefix is historical — the driver speaks plain S3, so these work
	 * for Cloudflare R2, Supabase Storage, Backblaze B2, MinIO or anything else
	 * S3-compatible. Only the endpoint differs, and that is set below.
	 */
	R2_ACCOUNT_ID: z.string().optional(),
	R2_ACCESS_KEY_ID: z.string().optional(),
	R2_SECRET_ACCESS_KEY: z.string().optional(),
	R2_BUCKET_MEDIA: z.string().optional(),
	R2_BUCKET_FILES: z.string().optional(),
	/** Same normalisation — the driver joins it to a storage key with a slash. */
	R2_PUBLIC_URL: z
		.string()
		.optional()
		.transform((value) => value?.replace(/\/+$/, "")),

	/**
	 * Override the S3 endpoint to use a provider other than R2.
	 *
	 * Unset  → Cloudflare R2, derived from R2_ACCOUNT_ID.
	 * Set    → that endpoint verbatim, e.g. Supabase Storage:
	 *          https://<project-ref>.supabase.co/storage/v1/s3
	 *
	 * Most non-AWS providers need path-style addressing; R2 accepts either.
	 */
	S3_ENDPOINT: z.string().optional(),
	S3_REGION: z.string().default("auto"),
	S3_FORCE_PATH_STYLE: z
		.enum(["true", "false"])
		.default("false")
		.transform((value) => value === "true"),

	// Mail — optional until the order module lands (Phase 3).
	SMTP_HOST: z.string().optional(),
	SMTP_PORT: z.coerce.number().optional(),
	SMTP_USER: z.string().optional(),
	SMTP_PASS: z.string().optional(),
	MAIL_FROM: z.string().optional(),

	/**
	 * Lets a scheduler run the maintenance jobs over HTTP.
	 *
	 * `node-cron` needs a process that stays alive, and a serverless deployment
	 * has none — so on Vercel the schedule lives in `vercel.json` and calls back
	 * into the API instead. This is what proves the caller is that scheduler:
	 * Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>`.
	 *
	 * Unset means the HTTP route is refused outright rather than left open. A
	 * long-running deployment (Render, the VPS) does not need it at all, because
	 * there the jobs run in-process.
	 *
	 * Generate with: openssl rand -hex 32
	 */
	CRON_SECRET: z.string().optional(),

	CORS_ORIGINS: z.string().default("http://localhost:3000"),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

	/**
	 * Cookie policy for the guest-session cookies (cart, quote basket,
	 * wishlist, configurator) and the refresh token.
	 *
	 * This is a deployment fact, not a code decision. When the site and the API
	 * share a registrable domain — astano.de and api.astano.de — "lax" is right
	 * and is the safer default. When they do not — a Vercel frontend calling a
	 * Render backend — the browser treats every API call as cross-site and
	 * silently drops a "lax" cookie, so a guest's basket empties itself between
	 * requests with nothing in any log to explain it.
	 */
	COOKIE_SAMESITE: z.enum(["lax", "none", "strict"]).default("lax"),
	COOKIE_SECURE: z
		.enum(["true", "false"])
		.optional()
		.transform((value) => value === "true"),
	/// Set to share cookies across subdomains, e.g. ".astano.de". Leave unset otherwise.
	COOKIE_DOMAIN: z.string().optional(),
})

const parsed = envSchema
	.transform((values) => ({
		...values,
		// Unset means "secure in production" — the previous hardcoded behaviour.
		COOKIE_SECURE: values.COOKIE_SECURE ?? values.NODE_ENV === "production",
		/*
		 * Resolved once, here, so nothing downstream has to remember the fallback
		 * — and so a deployment that never sets it still sends working links.
		 */
		SHOP_BASE_URL:
			values.SHOP_BASE_URL ||
			values.CORS_ORIGINS.split(",")[0]?.trim().replace(/\/+$/, "") ||
			"http://localhost:3000",
	}))
	/**
	 * A browser rejects `SameSite=None` outright unless the cookie is also
	 * `Secure`. Getting this pair wrong produces no error anywhere — the cookie
	 * is simply never stored — so it is refused at boot instead.
	 */
	.refine((values) => values.COOKIE_SAMESITE !== "none" || values.COOKIE_SECURE, {
		message: "COOKIE_SAMESITE=none requires COOKIE_SECURE=true (browsers drop the cookie otherwise)",
		path: ["COOKIE_SAMESITE"],
	})
	/**
	 * A published signing secret is a forged admin session, so production refuses
	 * to start on one.
	 *
	 * At boot rather than at first use, unlike CREDENTIALS_KEY. That one guards a
	 * feature — a shop with no payment gateway is entitled to run without it — but
	 * every request in the application is authenticated with these, so there is no
	 * deployment that could legitimately continue. Render's blueprint generates
	 * both; this is what covers the VPS move, where nothing generates anything.
	 */
	.refine(
		(values) =>
			values.NODE_ENV !== "production" ||
			(values.JWT_ACCESS_SECRET !== DEV_JWT_SECRETS.access &&
				values.JWT_REFRESH_SECRET !== DEV_JWT_SECRETS.refresh),
		{
			message:
				"JWT_ACCESS_SECRET / JWT_REFRESH_SECRET are still the development placeholders, " +
				"which are published in this repository. Generate real ones (openssl rand -hex 32) " +
				"and set them in the hosting dashboard.",
			path: ["JWT_ACCESS_SECRET"],
		}
	)
	.safeParse(process.env)

if (!parsed.success) {
	const problems = parsed.error.issues.map(
		(issue) => `${issue.path.join(".")}: ${issue.message}`
	)

	/*
	 * Printed readably first — this is the first thing a new developer sees.
	 */
	console.error("\n  Invalid environment configuration:\n")
	for (const problem of problems) console.error(`   - ${problem}`)
	console.error(
		"\n  Locally: copy .env.example to .env and fill it in." +
			"\n  On a host (Vercel/Render): set these in the project's environment" +
			"\n  variables, then redeploy — changing them does not restart a" +
			"\n  deployment on its own.\n"
	)

	/*
	 * Thrown, not `process.exit(1)`.
	 *
	 * Both stop a half-configured process, and on a long-running server the
	 * outcome is identical: an uncaught error at import ends it with a non-zero
	 * code, after the lines above have already been printed.
	 *
	 * The difference is on a serverless host, where the entry point wraps this
	 * import in a `try` so it can answer requests with the reason instead of a
	 * bare `FUNCTION_INVOCATION_FAILED`. `process.exit` cannot be caught — it
	 * takes the invocation down and leaves the platform with nothing to say,
	 * which is exactly the diagnosis-by-guesswork this avoids. See api/index.js.
	 */
	throw new Error(`Invalid environment configuration — ${problems.join("; ")}`)
}

export const env = parsed.data
export type Env = typeof env
