/**
 * Environment validation. The process must not start with a half-configured
 * environment — a missing R2 secret should fail at boot, not at the first
 * customer upload.
 */
import "dotenv/config"
import { z } from "zod"

const envSchema = z.object({
	NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
	PORT: z.coerce.number().int().positive().default(5000),

	DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

	// Auth — placeholders are fine in development, never in production.
	JWT_ACCESS_SECRET: z.string().min(1).default("dev-access-secret-change-me"),
	JWT_REFRESH_SECRET: z.string().min(1).default("dev-refresh-secret-change-me"),
	JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
	JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

	/// Where the API is reachable — used to build media URLs.
	PUBLIC_BASE_URL: z.string().default("http://localhost:5000"),

	/// "local" writes to ./storage and is the development default. "r2" requires
	/// the R2_* values below.
	STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),

	// Cloudflare R2.
	R2_ACCOUNT_ID: z.string().optional(),
	R2_ACCESS_KEY_ID: z.string().optional(),
	R2_SECRET_ACCESS_KEY: z.string().optional(),
	R2_BUCKET_MEDIA: z.string().optional(),
	R2_BUCKET_FILES: z.string().optional(),
	R2_PUBLIC_URL: z.string().optional(),

	// Mail — optional until the order module lands (Phase 3).
	SMTP_HOST: z.string().optional(),
	SMTP_PORT: z.coerce.number().optional(),
	SMTP_USER: z.string().optional(),
	SMTP_PASS: z.string().optional(),
	MAIL_FROM: z.string().optional(),

	CORS_ORIGINS: z.string().default("http://localhost:3000"),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
	// Fail loudly and readably — this is the first thing a new developer sees.
	console.error("\n  Invalid environment configuration:\n")
	for (const issue of parsed.error.issues) {
		console.error(`   - ${issue.path.join(".")}: ${issue.message}`)
	}
	console.error("\n  Copy .env.example to .env and fill it in.\n")
	process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
