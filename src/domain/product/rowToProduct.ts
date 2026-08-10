import {
	findAttributeColumns,
	readBackorders,
	readBoolean,
	readCategoryPaths,
	readDecimal,
	readImageUrls,
	readInt,
	readStatus,
	readVisibility,
	splitList,
} from "./importFields"

/**
 * One CSV row, read into the shape a product is made from.
 *
 * Pure, and separate from the service that writes it, because this is where the
 * decisions live — what a blank price means, whether stock is tracked, which
 * attributes a row carries — and those are worth testing without a database.
 *
 * Names and ids are *not* resolved here: categories, attributes and images come
 * out as the text the file contained. Turning "Ausstechformen > Edelstahl" into
 * a category id needs the database, and mixing that in would make this
 * untestable and the service unreadable.
 */

export interface ImportOptions {
	/**
	 * A row with no price becomes quote-only rather than free.
	 *
	 * On by default because that is what a blank price means in this catalogue:
	 * 27 of the shop's 55 products are priced on request. Off, they would import
	 * as buyable at nothing.
	 */
	quoteWhenNoPrice: boolean
	/** Fetch the image URLs. Slow, so it is a choice. */
	downloadImages: boolean
	/** Rows whose SKU already exists. */
	onExisting: "update" | "skip"
	/** Rows whose SKU is new. */
	onNew: "create" | "skip"
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
	quoteWhenNoPrice: true,
	downloadImages: false,
	onExisting: "update",
	onNew: "create",
}

export interface RowPrice {
	role: "B2C" | "RESELLER"
	basePrice: string
	salePrice: string | null
}

export interface RowAttribute {
	name: string
	values: string[]
}

export interface ParsedRow {
	sku: string | null
	name: string | null
	description: string | null
	shortDescription: string | null
	status: "PUBLISHED" | "DRAFT" | "ARCHIVED" | null
	visibility: "SHOP_AND_SEARCH" | "SHOP_ONLY" | "SEARCH_ONLY" | "HIDDEN" | null
	quoteEnabled: boolean
	prices: RowPrice[]
	/** Null means stock is not tracked at all, which is not the same as zero. */
	stock: number | null
	lowStockThreshold: number | null
	allowBackorder: boolean | null
	weightKg: string | null
	lengthCm: string | null
	widthCm: string | null
	heightCm: string | null
	sortOrder: number | null
	moq: number | null
	categoryPaths: string[][]
	imageUrls: string[]
	attributes: RowAttribute[]
	/** Anything the row said that could not be read. Never fatal on its own. */
	issues: string[]
}

/** `header -> field key`, as chosen or suggested in the mapping step. */
export type ColumnMapping = Record<string, string>

const invert = (mapping: ColumnMapping): Map<string, string> => {
	const byField = new Map<string, string>()
	for (const [header, field] of Object.entries(mapping)) {
		if (field && !byField.has(field)) byField.set(field, header)
	}
	return byField
}

export const parseRow = (
	record: Record<string, string>,
	mapping: ColumnMapping,
	headers: string[],
	options: ImportOptions
): ParsedRow => {
	const byField = invert(mapping)
	const issues: string[] = []

	const raw = (field: string): string => {
		const header = byField.get(field)
		return header ? (record[header] ?? "").trim() : ""
	}

	/** Reads a value, and says so when the cell had something unreadable in it. */
	const guarded = <T>(field: string, read: (value: string) => T | null, label: string): T | null => {
		const value = raw(field)
		if (!value) return null

		const parsed = read(value)
		if (parsed === null) issues.push(`${label}: could not read “${value}”`)

		return parsed
	}

	const prices: RowPrice[] = []

	const addPrice = (role: RowPrice["role"], baseField: string, saleField: string, label: string) => {
		const base = guarded(baseField, readDecimal, label)
		const sale = guarded(saleField, readDecimal, `${label} (sale)`)

		if (base !== null) {
			prices.push({ role, basePrice: base, salePrice: sale })
			return
		}

		// A sale price with nothing to be a discount from cannot be honoured, and
		// silently dropping it would leave the admin looking for it later.
		if (sale !== null) issues.push(`${label}: a sale price with no regular price was ignored`)
	}

	addPrice("B2C", "priceB2C", "salePriceB2C", "Regular price")
	addPrice("RESELLER", "priceReseller", "salePriceReseller", "Dealer price")

	const attributes: RowAttribute[] = []
	for (const { nameHeader, valueHeader } of findAttributeColumns(headers)) {
		const name = (record[nameHeader] ?? "").trim()
		const values = splitList(record[valueHeader] ?? "")

		// A name with no values describes nothing, and values with no name cannot
		// be filed under anything.
		if (name && values.length) attributes.push({ name, values })
	}

	const sku = raw("sku") || null
	const name = raw("name") || null

	if (!name) issues.push("No name — a product cannot be created without one")

	return {
		sku,
		name,
		description: raw("description") || null,
		shortDescription: raw("shortDescription") || null,
		status: guarded("status", readStatus, "Published"),
		visibility: guarded("visibility", readVisibility, "Visibility"),
		/*
		 * A mapped column wins; otherwise it is derived.
		 *
		 * WooCommerce has no "price on request" flag, and an empty price is how
		 * the live shop expresses it — so the fallback reads the absence of a
		 * price. Our own export does carry the column, which is what lets a file
		 * from here round-trip a quote-only product that also has a price.
		 */
		quoteEnabled:
			guarded("quoteEnabled", readBoolean, "Quote only") ??
			(options.quoteWhenNoPrice && prices.length === 0),
		prices,
		stock: guarded("stock", readInt, "Stock"),
		lowStockThreshold: guarded("lowStockThreshold", readInt, "Low stock amount"),
		allowBackorder: guarded("backorders", readBackorders, "Backorders"),
		weightKg: guarded("weightKg", readDecimal, "Weight"),
		lengthCm: guarded("lengthCm", readDecimal, "Length"),
		widthCm: guarded("widthCm", readDecimal, "Width"),
		heightCm: guarded("heightCm", readDecimal, "Height"),
		sortOrder: guarded("sortOrder", readInt, "Sort order"),
		moq: guarded("moq", readInt, "Minimum order quantity"),
		categoryPaths: readCategoryPaths(raw("categories")),
		imageUrls: options.downloadImages ? readImageUrls(raw("images")) : [],
		attributes,
		issues,
	}
}
