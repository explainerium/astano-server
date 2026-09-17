/**
 * Repairs two things the product import left behind.
 *
 *  1. Every description carries literal `\n` sequences, which render as visible
 *     text in the middle of the paragraph. See domain/product/cleanRichText.
 *
 *  2. The catalogue is written in German but every translation row is filed
 *     under `locale: "en"`. With German now the primary language, those rows
 *     belong under "de" — otherwise the German site serves its content only by
 *     falling through to the English slot, and a real English translation can
 *     never be added without displacing it.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless `--apply` is passed:
 *
 *     npx tsx scripts/repairImportedContent.ts            # report only
 *     npx tsx scripts/repairImportedContent.ts --apply    # write
 *
 * Take a database snapshot before applying. This rewrites content columns and
 * there is no undo built in.
 */
import { sanitizeRichText } from "../src/domain/html/sanitizeRichText"
import { cleanRichText } from "../src/domain/product/cleanRichText"
import { prisma } from "../src/shared/prisma"

const APPLY = process.argv.includes("--apply")
const RELABEL = !process.argv.includes("--skip-locale")

const preview = (value: string | null, length = 90) =>
	value ? `${value.slice(0, length).replace(/\s+/g, " ")}…` : "(none)"

const run = async () => {
	console.log(APPLY ? "APPLYING CHANGES\n" : "DRY RUN — nothing will be written\n")

	// ── 1. descriptions ──────────────────────────────────────────────────────
	const rows = await prisma.productTranslation.findMany({
		select: { id: true, locale: true, name: true, description: true, shortDescription: true },
	})

	// Sanitised as well as cleaned. These rows predate the sanitiser, so nothing
	// has ever checked what the WooCommerce export put in them.
	const repair = (value: string | null) => sanitizeRichText(cleanRichText(value))

	const repairs = rows
		.map((row) => ({
			row,
			description: repair(row.description),
			shortDescription: repair(row.shortDescription),
		}))
		.filter(
			(r) =>
				r.description !== r.row.description || r.shortDescription !== r.row.shortDescription
		)

	console.log(`Descriptions to clean: ${repairs.length} of ${rows.length}`)

	if (repairs[0]) {
		console.log(`  before: ${preview(repairs[0].row.description)}`)
		console.log(`  after:  ${preview(repairs[0].description)}\n`)
	}

	if (APPLY && repairs.length) {
		// One statement per row. There are tens of these, not thousands, and a
		// single failure should not take the whole catalogue's copy with it.
		for (const r of repairs) {
			await prisma.productTranslation.update({
				where: { id: r.row.id },
				data: { description: r.description, shortDescription: r.shortDescription },
			})
		}
		console.log(`  cleaned ${repairs.length} rows\n`)
	}

	// ── 2. locale relabel ────────────────────────────────────────────────────
	if (!RELABEL) return

	const byLocale = await prisma.productTranslation.groupBy({
		by: ["locale"],
		_count: { _all: true },
	})
	console.log("Product translations by locale:", Object.fromEntries(byLocale.map((r) => [r.locale, r._count._all])))

	const germanUnderEnglish = byLocale.find((r) => r.locale === "en")?._count._all ?? 0

	console.log(`\n  ${germanUnderEnglish} rows filed as "en" would be relabelled "de".`)
	console.log("  Category and attribute translations are relabelled with them.")

	/*
	 * Rows whose owner is already German.
	 *
	 * Relabelling one of these would collide with the unique (owner, locale) key
	 * — and on categories with (locale, slug) as well. In this catalogue there is
	 * exactly one: a category carrying the identical German name and slug under
	 * both locales, left behind by the import. The English row is the duplicate,
	 * so it is deleted rather than relabelled.
	 *
	 * Anything that is NOT a duplicate is left alone and reported. A genuine
	 * English translation beside a German one is the shape this whole change is
	 * moving towards, and quietly deleting one would be the worst way to find
	 * that out.
	 */
	const duplicates = {
		productTranslation: [] as string[],
		categoryTranslation: [] as string[],
	}
	const genuine: string[] = []

	/**
	 * Two names that are the same words.
	 *
	 * Letters and digits only, because the pair this exists for differs by
	 * exactly one damaged character: the German row was written through a
	 * mis-decoded import and reads "Edelstahl Eisw<?>rfel optionen" where the
	 * English one has the ü. Comparing the strings says "two different
	 * translations"; comparing the words says "the same name, one copy broken".
	 */
	const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "")
	const damaged = (value: string) => value.includes("�")

	/** German rows to drop because the English row holds the same name, undamaged. */
	const brokenGerman = { productTranslation: [] as string[], categoryTranslation: [] as string[] }

	/** Keeps the readable copy of a name that exists twice. */
	const resolve = (
		table: "productTranslation" | "categoryTranslation",
		english: { id: string; name: string },
		german: { id: string; name: string },
		label: string
	) => {
		if (words(german.name) !== words(english.name)) {
			genuine.push(`${label}: de "${german.name}" vs en "${english.name}"`)
			return
		}

		// Same name twice. Delete whichever copy is damaged — and when neither is,
		// the English one, because the German row is already where it belongs.
		if (damaged(german.name) && !damaged(english.name)) brokenGerman[table].push(german.id)
		else duplicates[table].push(english.id)
	}

	const categories = await prisma.categoryTranslation.findMany({
		select: { id: true, categoryId: true, locale: true, name: true, slug: true },
	})

	for (const row of categories) {
		if (row.locale !== "en") continue

		const german = categories.find((other) => other.categoryId === row.categoryId && other.locale === "de")
		if (!german) continue

		resolve("categoryTranslation", row, german, `category ${row.categoryId}`)
	}

	const products = await prisma.productTranslation.findMany({ select: { id: true, productId: true, locale: true, name: true } })
	for (const row of products) {
		if (row.locale !== "en") continue
		const german = products.find((other) => other.productId === row.productId && other.locale === "de")
		if (!german) continue

		resolve("productTranslation", row, german, `product ${row.productId}`)
	}

	const duplicateCount = Object.values(duplicates).reduce((sum, ids) => sum + ids.length, 0)
	const brokenCount = Object.values(brokenGerman).reduce((sum, ids) => sum + ids.length, 0)
	if (duplicateCount) console.log(`  ${duplicateCount} English rows duplicate a German one and would be deleted.`)
	if (brokenCount) {
		console.log(
			`  ${brokenCount} German rows hold a damaged copy of a name the English row has intact —` +
				" those German rows go, and the English ones take their place."
		)
	}

	if (genuine.length) {
		console.log(`\n  STOPPING: ${genuine.length} rows have a real English translation beside the German one:`)
		for (const line of genuine) console.log(`    ${line}`)
		console.log("  Relabelling would overwrite them. Sort those out by hand first.")
		return
	}

	if (!APPLY) return

	// Both sets go before the relabel: each one is a row the rename would collide
	// with, on (owner, locale) and — for categories — on (locale, slug) as well.
	for (const [label, set] of [
		["duplicate English", duplicates],
		["damaged German", brokenGerman],
	] as const) {
		for (const [table, ids] of Object.entries(set)) {
			if (!ids.length) continue
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const model = (prisma as any)[table]
			const { count } = await model.deleteMany({ where: { id: { in: ids } } })
			console.log(`  ${table}: ${count} ${label} rows deleted`)
		}
	}

	// Ordered so a failure part-way leaves the catalogue readable rather than
	// half of it pointing at a locale the site does not serve.
	const results = {
		productTranslation: await prisma.productTranslation.updateMany({
			where: { locale: "en" },
			data: { locale: "de" },
		}),
		categoryTranslation: await prisma.categoryTranslation.updateMany({
			where: { locale: "en" },
			data: { locale: "de" },
		}),
		attributeTranslation: await prisma.attributeTranslation.updateMany({
			where: { locale: "en" },
			data: { locale: "de" },
		}),
		attributeValueTranslation: await prisma.attributeValueTranslation.updateMany({
			where: { locale: "en" },
			data: { locale: "de" },
		}),
	}

	for (const [table, result] of Object.entries(results)) {
		console.log(`  ${table}: ${result.count} rows relabelled`)
	}
}

run()
	.catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
