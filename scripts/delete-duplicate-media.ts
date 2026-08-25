/**
 * Removes the copies of images the library holds twice.
 *
 * The eighty-odd product photographs were uploaded by hand during the rebuild,
 * and the WordPress import then brought the same originals across again — so
 * for each of them the library now holds two files: the one a product points
 * at, and an untouched twin sitting in a folder.
 *
 * Deletes only what it can prove is redundant, and works that out for itself
 * rather than reading a list, so a stale file cannot widen what goes:
 *
 *   · the asset is used by nothing at all, and
 *   · another asset with the same filename **is** in use, and
 *   · both are the same pixel size — a twin that is *larger* than the one in
 *     use is the better master and is deliberately left alone, or
 *   · it is one of the theme's demo placeholders, which were never astano's.
 *
 * Goes through the API, so the server does the deleting: it refuses anything
 * still in use, and removes the derivative files along with the original rather
 * than leaving four orphans in the bucket per image.
 *
 *   npx tsx scripts/delete-duplicate-media.ts --dry-run
 *   npx tsx scripts/delete-duplicate-media.ts
 *   npx tsx scripts/delete-duplicate-media.ts --include-larger   # also the masters
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { prisma } from "../src/shared/prisma"

/**
 * Storage keys the marketing pages hard-code, which the database knows nothing
 * about.
 *
 * `pageMedia.ts` addresses these by key rather than through a relation, so they
 * count as used by nothing — and one of them, an ice-cube photograph that also
 * exists as a product image, was a line away from being deleted out from under
 * the Sonderanfertigung page. A usage count is only as complete as the ways a
 * file can be referred to.
 */
const hardCodedKeys = (): Set<string> => {
	const source = readFileSync(
		path.join(__dirname, "../../frontend/src/lib/pageMedia.ts"),
		"utf8"
	)
	return new Set([...source.matchAll(/"(\d{4}\/\d{2}\/[0-9a-f]{32}\.\w+)"/g)].map((m) => m[1]!))
}

const argv = new Set(process.argv.slice(2))
const DRY_RUN = argv.has("--dry-run")
const INCLUDE_LARGER = argv.has("--include-larger")
const BASE = argv.has("--local")
	? "http://localhost:5000/api/v1"
	: "https://astano-server.vercel.app/api/v1"

const CREDENTIALS = {
	email: process.env.IMPORT_EMAIL ?? "explainerium@gmail.com",
	password: process.env.IMPORT_PASSWORD ?? "explainerium",
}

/** Shipped with the Woodmart theme. */
const DEMO =
	/^(placeholder|w-corp-|w-lawyer|wood-layout|landing-gadget|digitals-\d|hs-(check|waterproof)|drinks-map|sample-|demo-)/i

const USAGE = {
	products: true,
	featuredFor: true,
	categoryImageFor: true,
	categoryIconFor: true,
	variantImageFor: true,
	cartLines: true,
	quoteBasketLines: true,
	orderLines: true,
	quoteLines: true,
} as const

let token = ""
let tokenAt = 0

const authorise = async (): Promise<string> => {
	if (token && Date.now() - tokenAt < 10 * 60 * 1000) return token

	const res = await fetch(`${BASE}/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(CREDENTIALS),
	})
	const body = (await res.json()) as { data?: { accessToken?: string } }
	if (!body?.data?.accessToken) throw new Error(`login failed (${res.status})`)

	token = body.data.accessToken
	tokenAt = Date.now()
	return token
}

const main = async () => {
	const pinned = hardCodedKeys()
	console.log(`${pinned.size} storage key(s) are referenced directly by the marketing pages`)

	const assets = await prisma.asset.findMany({
		select: {
			id: true,
			originalName: true,
			width: true,
			height: true,
			sizeBytes: true,
			storageKey: true,
			folder: { select: { name: true } },
			_count: { select: USAGE },
		},
	})

	const uses = (a: (typeof assets)[number]) =>
		Object.values(a._count).reduce((sum, n) => sum + n, 0)

	const inUseByName = new Map<string, (typeof assets)[number]>()
	for (const a of assets) {
		if (uses(a) > 0) inUseByName.set((a.originalName ?? "").toLowerCase(), a)
	}

	const doomed: { a: (typeof assets)[number]; why: string }[] = []
	let keptLarger = 0

	for (const a of assets) {
		if (uses(a) > 0) continue
		// Referred to by key from the storefront rather than by a relation.
		if (pinned.has(a.storageKey)) continue

		const twin = inUseByName.get((a.originalName ?? "").toLowerCase())

		if (twin) {
			const sameSize = a.width === twin.width && a.height === twin.height
			if (sameSize) doomed.push({ a, why: "identical twin in use" })
			else if (INCLUDE_LARGER) doomed.push({ a, why: "larger twin, removed on request" })
			else keptLarger++
			continue
		}

		if (DEMO.test(a.originalName ?? "")) doomed.push({ a, why: "theme demo file" })
	}

	const bytes = doomed.reduce((sum, d) => sum + (d.a.sizeBytes ?? 0), 0)
	console.log(`${assets.length} assets in the library`)
	console.log(`${doomed.length} to delete (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
	if (keptLarger) console.log(`${keptLarger} left alone — larger than the copy in use`)
	console.log("")

	if (DRY_RUN) {
		for (const { a, why } of doomed) {
			console.log(`  would delete  ${a.originalName}  (${a.folder?.name ?? "unfiled"}) — ${why}`)
		}
		return
	}

	let gone = 0
	let failed = 0

	for (const { a } of doomed) {
		const bearer = await authorise()
		const res = await fetch(`${BASE}/media/${a.id}`, {
			method: "DELETE",
			headers: { authorization: `Bearer ${bearer}` },
		})

		if (res.ok) {
			gone++
			if (gone % 20 === 0) console.log(`  ${gone} deleted …`)
		} else {
			failed++
			console.log(`  FAILED ${a.originalName}: ${res.status} ${(await res.text()).slice(0, 120)}`)
		}
	}

	console.log(`\ndeleted ${gone}, failed ${failed}`)
}

void main().finally(() => prisma.$disconnect())
