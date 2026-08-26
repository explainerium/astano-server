/**
 * Gives each category the picture WordPress gave it.
 *
 * The dashboard has had a category image field all along and every category was
 * empty, so the storefront's category grid rendered twelve grey rectangles. The
 * pictures themselves are already here — the media import brought them across —
 * they were simply never pointed at anything.
 *
 * Which picture belongs to which category is not a guess: WooCommerce stores it
 * as `thumbnail_id` in `wp_termmeta` against the `product_cat` term. That is
 * read from the dump and followed through to the asset the import created.
 *
 * Matching is by name, because the two systems share no ids. Compared with
 * accents and case folded away and punctuation dropped, since the same category
 * is spelled "Präge-Ausstechformen" in one place and "Präge Ausstechformen" in
 * the other.
 *
 * Only fills a category that has no image. One already set is a decision
 * somebody made in the dashboard, and this is not the authority on it.
 *
 *   npx tsx scripts/import-category-images.ts --dry-run
 *   npx tsx scripts/import-category-images.ts
 */
import { createReadStream, existsSync, readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import path from "node:path"
import { prisma } from "../src/shared/prisma"

const DUMP = "C:/Users/mdrab/Local Sites/astano-v2/app/sql/local.sql"
const MAP_FILE = path.join(__dirname, "wp-media-map.json")
const DRY_RUN = process.argv.includes("--dry-run")

// ── dump parsing ─────────────────────────────────────────────────────────────

const splitRows = (line: string): string[] => {
	const start = line.indexOf("VALUES ")
	if (start < 0) return []

	const out: string[] = []
	let depth = 0
	let current = ""
	let quoted = false
	let escaped = false

	for (let i = start + 7; i < line.length; i++) {
		const c = line[i]!
		if (escaped) {
			current += c
			escaped = false
			continue
		}
		if (quoted) {
			if (c === "\\") escaped = true
			else if (c === "'") quoted = false
			current += c
			continue
		}
		if (c === "'") {
			quoted = true
			current += c
			continue
		}
		if (c === "(" && ++depth === 1) {
			current = ""
			continue
		}
		if (c === ")" && --depth === 0) {
			out.push(current)
			continue
		}
		if (depth > 0) current += c
	}

	return out
}

const splitColumns = (row: string): string[] => {
	const out: string[] = []
	let current = ""
	let quoted = false
	let escaped = false

	for (const c of row) {
		if (escaped) {
			current += c === "n" ? "\n" : c
			escaped = false
			continue
		}
		if (c === "\\") {
			escaped = true
			continue
		}
		if (c === "'") {
			quoted = !quoted
			continue
		}
		if (c === "," && !quoted) {
			out.push(current)
			current = ""
			continue
		}
		current += c
	}

	out.push(current)
	return out
}

const decodeEntities = (v: string): string =>
	v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')

/**
 * A name reduced to what two systems can be expected to agree on.
 *
 * "Präge-Ausstechformen" and "Präge Ausstechformen" are the same category;
 * "Brot/Sandwich Ausstecher" and "Sandwich Ausstecher" are not quite, and are
 * left to the substring pass below rather than forced together here.
 */
const normalise = (name: string): string =>
	name
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()

/**
 * The categories whose folder is named something else, written down.
 *
 * Name matching handles nine cases out of eleven. These two it cannot, and
 * guessing at them is how the broad "Ausstechformen" ended up wearing the
 * picture of the narrower "Ausstechformen individuell" on an earlier attempt.
 * Two lines of judgement, stated, beats a rule that is wrong somewhere nobody
 * is looking.
 *
 * Keys and values are compared after `normalise`.
 */
const ALIASES: Record<string, string> = {
	// The parent of the cutter categories; the folder of stainless cutters is
	// the picture of it.
	ausstechformen: "Ausstechformen Edelstahl",
	// Called "Brot/Sandwich Ausstecher" in the shop, filed as "Sandwich
	// Ausstecher" in the library.
	"brot sandwich ausstecher": "Sandwich Ausstecher",
}

interface WpCategory {
	name: string
	file: string
}

const readWordPressCategories = async (): Promise<WpCategory[]> => {
	const productCatTerm = new Set<string>() // term_id
	const termName = new Map<string, string>()
	const thumbnail = new Map<string, string>() // term_id → attachment id
	const attachmentFile = new Map<string, string>()

	const rl = createInterface({ input: createReadStream(DUMP), crlfDelay: Infinity })

	for await (const line of rl) {
		if (line.startsWith("INSERT INTO `wp_term_taxonomy`")) {
			for (const row of splitRows(line)) {
				const c = splitColumns(row)
				if (c[2] === "product_cat") productCatTerm.add(c[1]!)
			}
		} else if (line.startsWith("INSERT INTO `wp_terms`")) {
			for (const row of splitRows(line)) {
				const c = splitColumns(row)
				termName.set(c[0]!, c[1]!)
			}
		} else if (line.startsWith("INSERT INTO `wp_termmeta`")) {
			for (const row of splitRows(line)) {
				const c = splitColumns(row)
				if (c[2] === "thumbnail_id") thumbnail.set(c[1]!, c[3]!)
			}
		} else if (line.startsWith("INSERT INTO `wp_postmeta`")) {
			for (const row of splitRows(line)) {
				const c = splitColumns(row)
				if (c[2] === "_wp_attached_file") attachmentFile.set(c[1]!, c[3]!)
			}
		}
	}

	const out: WpCategory[] = []
	for (const termId of productCatTerm) {
		const attachmentId = thumbnail.get(termId)
		const file = attachmentId ? attachmentFile.get(attachmentId) : undefined
		if (file) out.push({ name: decodeEntities(termName.get(termId) ?? ""), file })
	}

	return out
}

// ── the run ──────────────────────────────────────────────────────────────────

const main = async () => {
	const wp = await readWordPressCategories()
	console.log(`${wp.length} WordPress categories carry a picture`)

	const map: Record<string, { assetId: string }> = existsSync(MAP_FILE)
		? JSON.parse(readFileSync(MAP_FILE, "utf8"))
		: {}

	const byName = new Map<string, string>() // normalised name → assetId
	let unimported = 0

	for (const c of wp) {
		const assetId = map[c.file]?.assetId
		if (!assetId) {
			unimported++
			continue
		}
		byName.set(normalise(c.name), assetId)
	}

	console.log(`${byName.size} of them were imported${unimported ? `, ${unimported} were not` : ""}\n`)

	/*
	 * The media folders, as a second source — and the better one here.
	 *
	 * Only five WordPress categories turned out to carry a `thumbnail_id` that
	 * still resolves to a file, so the taxonomy alone would leave most of the
	 * grid grey. The folders the client organised by hand are named after the
	 * same categories and hold the same photographs, so a folder whose name
	 * matches is a picture of that category by construction.
	 *
	 * First by filename, so a re-run picks the same one. It is a starting
	 * point, not a decision — the dashboard has the field, and choosing a
	 * better shot is a click.
	 */
	const folders = await prisma.mediaFolder.findMany({
		select: {
			name: true,
			assets: {
				select: { id: true, originalName: true },
				orderBy: { originalName: "asc" },
				take: 1,
			},
		},
	})

	const byFolder = new Map<string, { id: string; originalName: string | null }>()
	for (const f of folders) {
		if (f.assets[0]) byFolder.set(normalise(f.name), f.assets[0])
	}

	const categories = await prisma.category.findMany({
		select: {
			id: true,
			imageAssetId: true,
			translations: { select: { name: true } },
		},
	})

	const matched: { id: string; name: string; assetId: string; how: string }[] = []
	const unmatched: string[] = []

	for (const category of categories) {
		if (category.imageAssetId) continue

		const names = category.translations.map((t) => t.name)
		let hit: { assetId: string; how: string } | null = null

		/*
		 * Exact names only, on both passes.
		 *
		 * A substring pass was tried and had to go: it gave the broad
		 * "Ausstechformen" the picture of the narrower "Ausstechformen
		 * individuell", because one name contains the other. A category with no
		 * picture is a grey box somebody fills in; a category with the wrong
		 * picture is a mistake nobody goes looking for.
		 */
		for (const name of names) {
			const key = normalise(name)

			const fromWordPress = byName.get(key)
			if (fromWordPress) {
				hit = { assetId: fromWordPress, how: "WordPress category image" }
				break
			}

			const alias = ALIASES[key]
			const fromFolder = byFolder.get(key) ?? (alias ? byFolder.get(normalise(alias)) : undefined)

			if (fromFolder) {
				hit = {
					assetId: fromFolder.id,
					how: `${alias ? `alias → ${alias}` : "folder"} · ${fromFolder.originalName}`,
				}
				break
			}
		}

		if (hit) matched.push({ id: category.id, name: names[0] ?? "—", assetId: hit.assetId, how: hit.how })
		else unmatched.push(names[0] ?? "—")
	}

	console.log(`${matched.length} categor(ies) matched:`)
	for (const m of matched) console.log(`   ${m.name.padEnd(38)} ${m.how}`)

	if (unmatched.length) {
		console.log(`\n${unmatched.length} left without a picture:`)
		for (const name of unmatched) console.log(`   ${name}`)
	}

	if (DRY_RUN) return

	for (const m of matched) {
		await prisma.category.update({ where: { id: m.id }, data: { imageAssetId: m.assetId } })
	}

	console.log(`\nset ${matched.length}`)
}

void main().finally(() => prisma.$disconnect())
