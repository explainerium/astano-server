/**
 * What is in the media library, what uses it, and what is there twice.
 *
 * Written for the WordPress import but not specific to it: the same three
 * questions come up whenever a library grows faster than the shop that reads
 * from it.
 *
 * **Duplicates.** The eighty-odd product photographs were uploaded by hand
 * during the rebuild, and they came from the same WordPress originals the
 * import now brings across — so the same picture can legitimately end up in the
	 * library twice, once filed and once not. Matched on the original filename
 * first, because that is what survives both routes, and by hashing the local
 * originals second, which catches the same picture saved under another name.
 *
 * **Unused.** An asset is used when something points at it: a product's gallery
 * or featured image, a category's image or icon, a variant's image, or a file a
 * customer attached to a basket, an order or a quote. Sitting in a folder is
 * not use — the folders are how the client organises the library, not how the
 * shop consumes it.
 *
 * Reports only. Nothing here deletes anything: which of two copies is the one
 * in use is a question about the shop, not about the files.
 *
 *   npx tsx scripts/audit-media.ts
 *   npx tsx scripts/audit-media.ts --json audit.json
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { prisma } from "../src/shared/prisma"

const UPLOADS = "C:/Users/mdrab/Local Sites/astano-v2/app/public/wp-content/uploads"
const MAP_FILE = path.join(__dirname, "wp-media-map.json")

const argv = process.argv.slice(2)
const JSON_OUT = argv[argv.indexOf("--json") + 1]

const usage = {
	translations: true,
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

const main = async () => {
	// ── folders ──────────────────────────────────────────────────────────────
	const folders = await prisma.mediaFolder.findMany({
		include: { _count: { select: { assets: true } } },
		orderBy: { name: "asc" },
	})

	const filed = folders.reduce((sum, f) => sum + f._count.assets, 0)
	const total = await prisma.asset.count()

	console.log(`${total} assets, ${filed} filed, ${total - filed} unfiled\n`)
	console.log("folders:")
	for (const f of folders) {
		console.log(`  ${String(f._count.assets).padStart(4)}  ${f.name}`)
	}

	const empty = folders.filter((f) => !f._count.assets)
	if (empty.length) console.log(`\n${empty.length} folder(s) still empty`)

	// ── duplicates ───────────────────────────────────────────────────────────
	const assets = await prisma.asset.findMany({
		select: {
			id: true,
			originalName: true,
			sizeBytes: true,
			width: true,
			height: true,
			storageKey: true,
			folder: { select: { name: true } },
			_count: { select: usage },
		},
		orderBy: { createdAt: "asc" },
	})

	const used = (a: (typeof assets)[number]) =>
		Object.entries(a._count)
			// A translation is a caption, not a use — an alt text does not make an
			// image wanted by anything.
			.filter(([key]) => key !== "translations")
			.reduce((sum, [, n]) => sum + n, 0)

	const byName = new Map<string, typeof assets>()
	for (const a of assets) {
		const key = a.originalName?.toLowerCase() ?? ""
		if (!key) continue
		if (!byName.has(key)) byName.set(key, [])
		byName.get(key)!.push(a)
	}

	const nameDupes = [...byName.entries()].filter(([, group]) => group.length > 1)

	console.log(`\n${nameDupes.length} filename(s) appear more than once:`)
	for (const [name, group] of nameDupes.slice(0, 40)) {
		console.log(`  ${group.length}×  ${name}`)
		for (const a of group) {
			console.log(
				`        ${a.folder?.name ?? "(unfiled)"} · ${a.sizeBytes} B · ${used(a) ? `${used(a)} use(s)` : "unused"}`
			)
		}
	}
	if (nameDupes.length > 40) console.log(`  … and ${nameDupes.length - 40} more`)

	/*
	 * Same picture under two names — confirmed by hashing, not guessed at.
	 *
	 * Matching on dimensions and byte size alone looked convincing and was
	 * wrong: these are line drawings on white, and a beaver and a dough scraper
	 * really do compress to the same 6,490 bytes at 800×800. Three of the first
	 * five "duplicates" found that way were different pictures.
	 *
	 * The originals are on disk and the import map says which asset each became,
	 * so the honest answer costs a hash of a local file. Only covers what was
	 * imported; anything uploaded by hand has no original to hash, and is caught
	 * by the filename pass above instead.
	 */
	const map: Record<string, { assetId: string }> = existsSync(MAP_FILE)
		? JSON.parse(readFileSync(MAP_FILE, "utf8"))
		: {}

	const byContent = new Map<string, { wpPath: string; assetId: string }[]>()
	for (const [wpPath, entry] of Object.entries(map)) {
		const file = `${UPLOADS}/${wpPath}`
		if (!entry.assetId || !existsSync(file)) continue

		const hash = createHash("sha256").update(readFileSync(file)).digest("hex")
		if (!byContent.has(hash)) byContent.set(hash, [])
		byContent.get(hash)!.push({ wpPath, assetId: entry.assetId })
	}

	const byId = new Map(assets.map((a) => [a.id, a]))
	const contentDupes = [...byContent.values()].filter((g) => g.length > 1)

	console.log(`\n${contentDupes.length} picture(s) imported more than once under different names:`)
	for (const group of contentDupes.slice(0, 25)) {
		for (const { wpPath, assetId } of group) {
			const a = byId.get(assetId)
			console.log(
				`        ${wpPath.split("/").pop()}  (${a?.folder?.name ?? "unfiled"}${a && used(a) ? `, ${used(a)} use(s)` : ""})`
			)
		}
		console.log("")
	}
	if (contentDupes.length > 25) console.log(`  … and ${contentDupes.length - 25} more`)

	// ── unused ───────────────────────────────────────────────────────────────
	const unused = assets.filter((a) => used(a) === 0)

	console.log(`\n${unused.length} asset(s) nothing points at:`)
	const byFolder = new Map<string, number>()
	for (const a of unused) {
		const f = a.folder?.name ?? "(unfiled)"
		byFolder.set(f, (byFolder.get(f) ?? 0) + 1)
	}
	for (const [folder, n] of [...byFolder.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${String(n).padStart(4)}  ${folder}`)
	}

	if (JSON_OUT) {
		writeFileSync(
			JSON_OUT,
			JSON.stringify(
				{
					folders: folders.map((f) => ({ name: f.name, assets: f._count.assets })),
					duplicateNames: nameDupes.map(([name, group]) => ({
						name,
						copies: group.map((a) => ({
							id: a.id,
							folder: a.folder?.name ?? null,
							sizeBytes: a.sizeBytes,
							uses: used(a),
							storageKey: a.storageKey,
						})),
					})),
					unused: unused.map((a) => ({
						id: a.id,
						name: a.originalName,
						folder: a.folder?.name ?? null,
						sizeBytes: a.sizeBytes,
						storageKey: a.storageKey,
					})),
				},
				null,
				2
			)
		)
		console.log(`\nwrote ${JSON_OUT}`)
	}

	await prisma.$disconnect()
}

void main()
