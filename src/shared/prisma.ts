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

const createClient = (): PrismaClient => {
	const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })
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
