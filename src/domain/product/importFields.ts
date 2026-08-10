/**
 * What a CSV column can become, and how to read its value.
 *
 * The importer accepts any file, which only works if the admin can say which
 * column is which. This is the list they choose from — and the aliases below
 * mean a WooCommerce export, in English or German, arrives already mapped and
 * needs nothing said about it.
 *
 * Everything is pure. Nothing here touches the database; it turns a row of
 * strings into a described shape and reports what it could not read.
 */

export type FieldType =
	| "text"
	| "html"
	| "decimal"
	| "int"
	| "boolean"
	| "list"
	| "categories"
	| "images"
	| "status"
	| "visibility"
	| "backorders"

export interface ImportField {
	key: string
	label: string
	help?: string
	type: FieldType
	/**
	 * Header names seen in real exports, matched case- and space-insensitively.
	 * WooCommerce's own English and German headers are here so its export maps
	 * itself; anything else the admin points by hand.
	 */
	aliases: string[]
}

export const IMPORT_FIELDS: ImportField[] = [
	{
		key: "sku",
		label: "SKU",
		help: "How a row is matched to a product that already exists. Without it every row creates a new product.",
		type: "text",
		aliases: ["sku", "artikelnummer", "article number", "artikel-nr", "art-nr"],
	},
	{
		key: "name",
		label: "Name",
		type: "text",
		aliases: ["name", "product name", "produktname", "titel", "title", "post_title"],
	},
	{
		key: "description",
		label: "Description",
		type: "html",
		aliases: ["description", "beschreibung", "post_content", "long description"],
	},
	{
		key: "shortDescription",
		label: "Short description",
		type: "html",
		aliases: ["short description", "kurzbeschreibung", "post_excerpt"],
	},
	{
		key: "status",
		label: "Published",
		help: "1 or “publish” makes it live; 0 or “draft” keeps it a draft.",
		type: "status",
		aliases: ["published", "veröffentlicht", "veroeffentlicht", "status", "post_status"],
	},
	{
		key: "visibility",
		label: "Catalogue visibility",
		type: "visibility",
		aliases: [
			"visibility in catalog",
			"sichtbarkeit im katalog",
			"catalog visibility",
			"visibility",
			"sichtbarkeit",
		],
	},
	{
		key: "priceB2C",
		label: "Regular price",
		help: "The retail price. A row with none becomes quote-only if you ask for that below.",
		type: "decimal",
		aliases: ["regular price", "regulärer preis", "regulaerer preis", "price", "preis"],
	},
	{
		key: "salePriceB2C",
		label: "Sale price",
		type: "decimal",
		aliases: ["sale price", "angebotspreis", "aktionspreis"],
	},
	{
		key: "priceReseller",
		label: "Dealer price",
		help: "What a signed-in dealer pays.",
		type: "decimal",
		aliases: ["reseller base price", "dealer price", "händlerpreis", "haendlerpreis", "b2b price"],
	},
	{
		key: "salePriceReseller",
		label: "Dealer sale price",
		type: "decimal",
		aliases: ["reseller sale price", "dealer sale price"],
	},
	{
		key: "quoteEnabled",
		label: "Quote only",
		help: "Price on request. When this column is mapped it decides, rather than the presence of a price.",
		type: "boolean",
		aliases: ["quote only", "price on request", "preis auf anfrage", "auf anfrage"],
	},
	{
		key: "stock",
		label: "Stock",
		help: "Left empty, the product is not stock-tracked at all rather than being set to zero.",
		type: "int",
		aliases: ["stock", "bestand", "lagerbestand", "stock quantity", "lagermenge"],
	},
	{
		key: "lowStockThreshold",
		label: "Low stock amount",
		type: "int",
		aliases: ["low stock amount", "geringe lagermenge", "low stock threshold"],
	},
	{
		key: "backorders",
		label: "Backorders allowed",
		type: "backorders",
		aliases: ["backorders allowed?", "backorders", "lieferrückstände erlaubt?", "lieferrueckstaende erlaubt?"],
	},
	{
		key: "weightKg",
		label: "Weight (kg)",
		type: "decimal",
		aliases: ["weight (kg)", "gewicht (kg)", "weight", "gewicht"],
	},
	{
		key: "lengthCm",
		label: "Length (cm)",
		type: "decimal",
		aliases: ["length (cm)", "länge (cm)", "laenge (cm)", "length", "länge"],
	},
	{
		key: "widthCm",
		label: "Width (cm)",
		type: "decimal",
		aliases: ["width (cm)", "breite (cm)", "width", "breite"],
	},
	{
		key: "heightCm",
		label: "Height (cm)",
		type: "decimal",
		aliases: ["height (cm)", "höhe (cm)", "hoehe (cm)", "height", "höhe"],
	},
	{
		key: "categories",
		label: "Categories",
		help: "Comma-separated. “Parent > Child” creates the tree; missing categories are created.",
		type: "categories",
		aliases: ["categories", "kategorien", "category", "kategorie"],
	},
	{
		key: "images",
		label: "Image URLs",
		help: "Comma-separated. Fetched only if you turn image downloading on.",
		type: "images",
		aliases: ["images", "bilder", "image", "bild", "image url", "bild-url"],
	},
	{
		key: "sortOrder",
		label: "Sort order",
		type: "int",
		aliases: ["position", "menu order", "sortierung", "sort order"],
	},
	{
		key: "moq",
		label: "Minimum order quantity",
		type: "int",
		aliases: ["moq", "minimum order quantity", "mindestbestellmenge"],
	},
]

export const FIELD_BY_KEY = new Map(IMPORT_FIELDS.map((f) => [f.key, f]))

/** Loose header comparison: case, spaces, punctuation and umlauts all ignored. */
export const normaliseHeader = (header: string): string =>
	header
		.toLowerCase()
		.replace(/ä/g, "a")
		.replace(/ö/g, "o")
		.replace(/ü/g, "u")
		.replace(/ß/g, "ss")
		.replace(/[^a-z0-9()]+/g, " ")
		.trim()

const ALIAS_INDEX = new Map<string, string>()
for (const field of IMPORT_FIELDS) {
	for (const alias of field.aliases) {
		// First alias wins, so an earlier field keeps a shared name.
		const key = normaliseHeader(alias)
		if (!ALIAS_INDEX.has(key)) ALIAS_INDEX.set(key, field.key)
	}
}

/**
 * Guesses which of our fields each column is.
 *
 * Only exact alias matches. A fuzzy guess that is wrong is worse than no guess:
 * the admin reviews the mapping either way, and an empty row invites a look
 * while a confidently wrong one does not.
 */
export const suggestMapping = (headers: string[]): Record<string, string> => {
	const mapping: Record<string, string> = {}
	const claimed = new Set<string>()

	for (const header of headers) {
		const field = ALIAS_INDEX.get(normaliseHeader(header))
		// One column per field. A file with both "Price" and "Regular price"
		// would otherwise map both and the last would silently win.
		if (field && !claimed.has(field)) {
			mapping[header] = field
			claimed.add(field)
		}
	}

	return mapping
}

// ── attribute columns ────────────────────────────────────────────────────────

/**
 * WooCommerce writes attributes as numbered triplets — "Attribut 1 Name",
 * "Attribut 1 Wert(e)" and so on, up to however many the widest product needs.
 * They are matched by shape rather than listed in the registry, because the
 * count is a property of the file and a fixed list would truncate a wider one.
 */
export interface AttributeColumns {
	position: number
	nameHeader: string
	valueHeader: string
}

export const findAttributeColumns = (headers: string[]): AttributeColumns[] => {
	const names = new Map<number, string>()
	const values = new Map<number, string>()

	for (const header of headers) {
		const normalised = normaliseHeader(header)

		const nameMatch = /^attribut(?:e)? (\d+) name$/.exec(normalised)
		if (nameMatch) {
			names.set(Number(nameMatch[1]), header)
			continue
		}

		// "Wert(e)" and "value(s)" — the parentheses survive normalisation.
		const valueMatch = /^attribut(?:e)? (\d+) (?:wert\(e\)|werte|value\(s\)|values|value)$/.exec(
			normalised
		)
		if (valueMatch) values.set(Number(valueMatch[1]), header)
	}

	return [...names.keys()]
		.filter((position) => values.has(position))
		.sort((a, b) => a - b)
		.map((position) => ({
			position,
			nameHeader: names.get(position)!,
			valueHeader: values.get(position)!,
		}))
}

// ── value reading ────────────────────────────────────────────────────────────

/**
 * Splits a WooCommerce list.
 *
 * Commas separate, and a literal comma inside a value is escaped as `\,` —
 * "Edelstahl 430\, rostfrei" is one value, not two. Splitting naively turns one
 * material into two and the product ends up with an attribute called
 * " rostfrei".
 */
export const splitList = (value: string): string[] => {
	const out: string[] = []
	let current = ""

	for (let i = 0; i < value.length; i++) {
		const char = value[i]

		if (char === "\\" && value[i + 1] === ",") {
			current += ","
			i++
			continue
		}

		if (char === ",") {
			out.push(current.trim())
			current = ""
			continue
		}

		current += char
	}

	out.push(current.trim())
	return out.filter(Boolean)
}

const TRUTHY = new Set(["1", "true", "yes", "y", "ja", "wahr", "on", "x"])
const FALSY = new Set(["0", "false", "no", "n", "nein", "falsch", "off", ""])

export const readBoolean = (value: string): boolean | null => {
	const text = value.trim().toLowerCase()
	if (TRUTHY.has(text)) return true
	if (FALSY.has(text)) return false
	return null
}

/**
 * A number, in either decimal convention.
 *
 * "1.234,56" is German for "1234.56" and "1,69" is "1.69". Deciding by the last
 * separator rather than by locale means one rule covers both, and a file that
 * mixes them — which happens when a spreadsheet has been edited by two people —
 * still reads correctly row by row.
 */
export const readDecimal = (value: string): string | null => {
	const text = value.trim().replace(/[\s'€$£]/g, "")
	if (!text) return null

	const lastComma = text.lastIndexOf(",")
	const lastDot = text.lastIndexOf(".")

	let normalised: string

	if (lastComma > lastDot) {
		// Comma is the decimal mark: strip dots as thousands separators.
		normalised = text.replace(/\./g, "").replace(",", ".")
	} else if (lastDot > lastComma) {
		normalised = text.replace(/,/g, "")
	} else {
		normalised = text
	}

	if (!/^-?\d+(\.\d+)?$/.test(normalised)) return null

	return normalised
}

export const readInt = (value: string): number | null => {
	const decimal = readDecimal(value)
	if (decimal === null) return null

	const n = Number(decimal)
	return Number.isFinite(n) ? Math.trunc(n) : null
}

const PUBLISHED = new Set(["1", "publish", "published", "veröffentlicht", "live", "active"])
const PRIVATE = new Set(["-1", "private", "privat"])

export const readStatus = (value: string): "PUBLISHED" | "DRAFT" | "ARCHIVED" | null => {
	const text = value.trim().toLowerCase()
	if (!text) return null
	if (PUBLISHED.has(text)) return "PUBLISHED"
	if (PRIVATE.has(text)) return "ARCHIVED"
	if (text === "0" || text === "draft" || text === "entwurf") return "DRAFT"
	return null
}

export const readVisibility = (
	value: string
): "SHOP_AND_SEARCH" | "SHOP_ONLY" | "SEARCH_ONLY" | "HIDDEN" | null => {
	const text = value.trim().toLowerCase()

	switch (text) {
		case "visible":
		case "sichtbar":
			return "SHOP_AND_SEARCH"
		case "catalog":
		case "katalog":
			return "SHOP_ONLY"
		case "search":
		case "suche":
			return "SEARCH_ONLY"
		case "hidden":
		case "versteckt":
			return "HIDDEN"
		default:
			return null
	}
}

/** WooCommerce's third state, "notify", still means backorders are allowed. */
export const readBackorders = (value: string): boolean | null => {
	const text = value.trim().toLowerCase()
	if (text === "notify" || text === "benachrichtigen") return true
	return readBoolean(text)
}

/**
 * "Parent > Child" into its segments, for one comma-separated cell.
 *
 * Returns each full path so the importer can build the tree. WooCommerce lists
 * both the parent on its own and the full path when a product is in both.
 */
export const readCategoryPaths = (value: string): string[][] =>
	splitList(value)
		.map((path) =>
			path
				.split(">")
				.map((segment) => segment.trim())
				.filter(Boolean)
		)
		.filter((segments) => segments.length > 0)

/** Only absolute http(s) URLs — a local file path cannot be fetched from here. */
export const readImageUrls = (value: string): string[] =>
	splitList(value).filter((url) => /^https?:\/\//i.test(url))
