import "dotenv/config"
import { defineConfig, env } from "prisma/config"

export default defineConfig({
	// A folder, not a file — Prisma 7 merges every .prisma inside it. The
	// schema is split by domain so it stays readable as it grows (§12.4).
	schema: "prisma/schema",
	migrations: {
		path: "prisma/migrations",
	},
	datasource: {
		url: env("DATABASE_URL"),
	},
})
