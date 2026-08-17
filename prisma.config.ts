import "dotenv/config"
import { defineConfig } from "prisma/config"

/**
 * The connection string, if there is one — read straight from the environment.
 *
 * Deliberately **not** Prisma's own `env("DATABASE_URL")` helper. That one
 * throws while the config file is being loaded, which means every Prisma
 * command needs a database URL just to start — including `prisma generate`,
 * which only ever reads the schema and never connects to anything.
 *
 * That difference is not academic: a deployment build runs `prisma generate`
 * and nothing else, so the strict helper made the build fail with
 * `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`
 * unless a production credential was exposed to it. A build should not need a
 * secret it does not use.
 *
 * Migrate genuinely does need it, and still gets it — or Prisma's own "no
 * datasource url" error, which says so plainly.
 */
const url = process.env.DATABASE_URL

export default defineConfig({
	// A folder, not a file — Prisma 7 merges every .prisma inside it. The
	// schema is split by domain so it stays readable as it grows (§12.4).
	schema: "prisma/schema",
	migrations: {
		path: "prisma/migrations",
	},
	...(url ? { datasource: { url } } : {}),
})
