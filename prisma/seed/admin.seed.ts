/**
 * Seeds the first ADMIN account. Idempotent — running it twice is safe.
 *
 *   npm run seed:admin
 *
 * Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD in .env, falling back to
 * development defaults. The fallback password is refused when NODE_ENV is
 * production, so a live deployment cannot end up with a known admin login.
 */
import bcrypt from "bcrypt"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import "dotenv/config"

const DEFAULT_EMAIL = "explainerium@gmail.com"
const DEFAULT_PASSWORD = "explainerium"
const BCRYPT_ROUNDS = 12

const main = async (): Promise<void> => {
	const connectionString = process.env.DATABASE_URL
	if (!connectionString) throw new Error("DATABASE_URL is not set")

	const email = (process.env.ADMIN_EMAIL ?? DEFAULT_EMAIL).toLowerCase()
	const password = process.env.ADMIN_PASSWORD ?? DEFAULT_PASSWORD

	if (process.env.NODE_ENV === "production" && password === DEFAULT_PASSWORD) {
		throw new Error(
			"Refusing to seed the default admin password in production. Set ADMIN_PASSWORD.",
		)
	}

	const prisma = new PrismaClient({
		adapter: new PrismaPg({ connectionString }),
	})

	try {
		const existing = await prisma.user.findUnique({ where: { email } })

		if (existing) {
			console.log(
				`admin already exists: ${email} (${existing.role}/${existing.status})`,
			)
			return
		}

		const user = await prisma.user.create({
			data: {
				email,
				passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
				role: "ADMIN",
				status: "ACTIVE",
				firstName: "Astano",
				lastName: "Admin",
				locale: "en",
			},
		})

		console.log(`admin created: ${user.email}`)
		if (password === DEFAULT_PASSWORD) {
			console.log(
				`password: ${DEFAULT_PASSWORD}  <-- change this before going live`,
			)
		}
	} finally {
		await prisma.$disconnect()
	}
}

main().catch((error: unknown) => {
	console.error(error)
	process.exit(1)
})
