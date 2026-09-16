import type { PriceRole } from "@prisma/client"
import {
	parsePriceList,
	planLadders,
	type LadderPlan,
	type ParsedPriceList,
} from "../../../domain/pricing/priceList"
import { prisma } from "../../../shared/prisma"

/**
 * Importing the ERP's price list.
 *
 * What it does, and as importantly what it refuses to do:
 *
 *  - It matches on SKU and **never creates a product**. The ERP holds 986
 *    articles and this shop sells 55 of them; an import that created what it
 *    did not recognise would bury the catalogue in apparel.
 *  - It touches **no name, description or image**. Those belong to the shop,
 *    which is the whole point of the client editing them.
 *  - It never changes **`quoteEnabled`**. Twenty-seven of the products that are
 *    "Preis auf Anfrage" carry prices in the ERP, and the client's answer on
 *    16 September was that they stay on request. A price may be stored for
 *    them; it must not make them purchasable.
 *  - A ladder is **replaced, never merged**. Old rungs left in place would
 *    quietly undercut the new ones at the quantity nobody tested.
 *
 * The preview runs the same code with the writes skipped, so what it reports is
 * what will happen rather than an estimate of it.
 */

export interface AnalysePriceListResult {
	delimiter: string
	headers: string[]
	columns: ParsedPriceList["columns"]
	rowCount: number
	/** Row counts per `PREISLISTE`, and the role each maps to. */
	lists: ParsedPriceList["lists"]
	articlesInFile: number
	/** How many of those articles this shop actually sells. */
	articlesInShop: number
	unreadableRows: number
	sample: { sku: string; list: string; minQuantity: number | null; price: string | null }[]
}

export interface LadderReport {
	sku: string
	role: PriceRole
	action: "written" | "skipped"
	basePrice: string
	baseSource: LadderPlan["baseSource"]
	rungs: number
	/** True when the product stays "Preis auf Anfrage" despite now having a price. */
	quoteOnly: boolean
	issues: string[]
}

export interface PriceListReport {
	dryRun: boolean
	rowsRead: number
	unreadableRows: number
	articlesInFile: number
	articlesMatched: number
	/** Articles in the file this shop does not sell. Ignored, not an error. */
	articlesNotInShop: string[]
	laddersWritten: Record<string, number>
	rungsWritten: number
	quoteOnlyProducts: string[]
	ladders: LadderReport[]
}

const skuIndex = async (skus: string[]): Promise<Map<string, { productId: string; quoteEnabled: boolean }>> => {
	if (!skus.length) return new Map()

	const variants = await prisma.productVariant.findMany({
		where: { sku: { in: skus } },
		select: { sku: true, productId: true, product: { select: { quoteEnabled: true } } },
	})

	return new Map(
		variants
			.filter((variant) => variant.sku)
			.map((variant) => [variant.sku!, { productId: variant.productId, quoteEnabled: variant.product.quoteEnabled }])
	)
}

const analyse = async (csv: string, delimiter?: string): Promise<AnalysePriceListResult> => {
	const parsed = parsePriceList(csv, delimiter)
	const articles = [...new Set(parsed.rows.map((row) => row.sku).filter(Boolean))]
	const known = await skuIndex(articles)

	return {
		delimiter: parsed.delimiter,
		headers: parsed.headers,
		columns: parsed.columns,
		rowCount: parsed.rows.length,
		lists: parsed.lists,
		articlesInFile: articles.length,
		articlesInShop: known.size,
		unreadableRows: parsed.rows.filter((row) => row.issues.length).length,
		sample: parsed.rows.slice(0, 5).map((row) => ({
			sku: row.sku,
			list: row.list,
			minQuantity: row.minQuantity,
			price: row.price?.toString() ?? null,
		})),
	}
}

const runImport = async (
	csv: string,
	params: { delimiter?: string; dryRun: boolean }
): Promise<PriceListReport> => {
	const parsed = parsePriceList(csv, params.delimiter)
	const plans = planLadders(parsed.rows)

	const articles = [...new Set(parsed.rows.map((row) => row.sku).filter(Boolean))]
	const known = await skuIndex(articles)

	const report: PriceListReport = {
		dryRun: params.dryRun,
		rowsRead: parsed.rows.length,
		unreadableRows: parsed.rows.filter((row) => row.issues.length).length,
		articlesInFile: articles.length,
		articlesMatched: known.size,
		articlesNotInShop: articles.filter((sku) => !known.has(sku)),
		laddersWritten: {},
		rungsWritten: 0,
		quoteOnlyProducts: [],
		ladders: [],
	}

	for (const plan of plans) {
		const product = known.get(plan.sku)

		if (!product) {
			// Not an error, and not reported per ladder either: 930 of the ERP's
			// articles are other product lines, and a report listing each of them
			// twice would bury the ones that matter.
			continue
		}

		if (product.quoteEnabled && !report.quoteOnlyProducts.includes(plan.sku)) {
			report.quoteOnlyProducts.push(plan.sku)
		}

		const role = plan.role as PriceRole

		if (!params.dryRun) {
			await prisma.$transaction(async (tx) => {
				/*
				 * The base price is written; the sale price is left alone.
				 *
				 * A sale is something the shop decided and the ERP knows nothing
				 * about. Overwriting it here would end a campaign silently, and
				 * clearing it would be worse — `resolvePrice` reads a sale price as
				 * the price whenever its window is open.
				 */
				await tx.productPrice.upsert({
					where: { productId_role: { productId: product.productId, role } },
					create: { productId: product.productId, role, basePrice: plan.basePrice.toString() },
					update: { basePrice: plan.basePrice.toString() },
				})

				await tx.productPriceTier.deleteMany({ where: { productId: product.productId, role } })

				if (plan.rungs.length) {
					await tx.productPriceTier.createMany({
						data: plan.rungs.map((rung) => ({
							productId: product.productId,
							role,
							minQuantity: rung.minQuantity,
							type: "FIXED_PRICE" as const,
							value: rung.value.toString(),
						})),
					})
				}
			})
		}

		report.laddersWritten[role] = (report.laddersWritten[role] ?? 0) + 1
		report.rungsWritten += plan.rungs.length
		report.ladders.push({
			sku: plan.sku,
			role,
			action: "written",
			basePrice: plan.basePrice.toString(),
			baseSource: plan.baseSource,
			rungs: plan.rungs.length,
			quoteOnly: product.quoteEnabled,
			issues: plan.issues,
		})
	}

	return report
}

export const PriceListIoService = { analyse, runImport }
