import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { env } from "../config"

/**
 * Prisma 7 takes the connection through a driver adapter rather than reading
 * `url` from the schema. One client for the whole process; `globalThis` keeps
 * a single instance alive across tsx hot reloads so development does not leak
 * connections on every file save.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/**
 * How many connections this process may hold.
 *
 * The driver's own default is ten, and it is the wrong number for both places
 * this runs. Supabase's session pooler allows **fifteen in total, across every
 * client** — so one development server at ten leaves five for everything else,
 * and two serverless instances asking for ten apiece exhaust it outright. What
 * that looks like from the outside is a shop with no products and a login that
 * answers "the database rejected this change", on a database that is perfectly
 * healthy and simply has no free slot to answer from.
 *
 * One per serverless instance, because an instance handles one request at a
 * time — a second connection would sit idle holding a slot some other instance
 * needs. Five for a long-running server, which does serve requests
 * concurrently, and which is still a third of the pooler rather than
 * two thirds.
 *
 * `VERCEL` is set by the platform on every deployment, so neither environment
 * needs a variable set by hand. `DATABASE_POOL_SIZE` overrides both, for the
 * VPS move where the database is ours and the ceiling is not fifteen.
 */
const poolSize = (): number => env.DATABASE_POOL_SIZE ?? (process.env.VERCEL ? 1 : 5)

const createClient = (): PrismaClient => {
	const adapter = new PrismaPg({
		connectionString: env.DATABASE_URL,
		max: poolSize(),
		/*
		 * Idle connections are given back rather than held.
		 *
		 * The driver's default keeps one for ten seconds after the last query,
		 * which is right for a server answering a steady stream and wrong for a
		 * serverless instance that answers one request and is then frozen —
		 * still holding a slot it will not use again. Five seconds is longer
		 * than the gap between two requests of the same page load and shorter
		 * than the pause before the next visitor.
		 */
		idleTimeoutMillis: 5_000,
	})

	return new PrismaClient({
		adapter,
		log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
	})
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient()

if (env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma
}

export default prisma
