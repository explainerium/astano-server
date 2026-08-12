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
	const alreadyGerman = byLocale.find((r) => r.locale === "de")?._count._all ?? 0

	if (alreadyGerman > 0) {
		// Relabelling now would collide with the unique (productId, locale) key
		// and, worse, might overwrite a genuine translation. Left for a human.
		console.log(
			`\n  SKIPPED: ${alreadyGerman} rows are already German. Relabelling could collide` +
				" with them — sort those out by hand first."
		)
		return
	}

	console.log(`\n  ${germanUnderEnglish} rows filed as "en" would be relabelled "de".`)
	console.log("  Category, attribute and page translations are relabelled with them.")

	if (!APPLY) return

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
