/**
 * CSV in, rows out.
 *
 * Hand-written rather than a dependency, because the interesting parts are the
 * ones a spreadsheet actually produces and most small libraries get one of them
 * wrong: a byte-order mark that turns the first header into `﻿ID`, semicolons
 * instead of commas from a German Excel, and quoted fields carrying commas,
 * quotes and newlines — a product description is HTML with all three.
 *
 * Everything here is pure. The importer is only as trustworthy as this is, so
 * it is the part with the most tests.
 */

export interface ParsedCsv {
	headers: string[]
	rows: string[][]
	/** What was actually used, so the UI can say so when it guessed. */
	delimiter: string
}

const DELIMITERS = [",", ";", "\t", "|"] as const

/**
 * Guesses the delimiter from the first line outside quotes.
 *
 * Counting on the header alone rather than the whole file: a description full
 * of semicolons in one row should not outvote the actual separator, and the
 * header is the one line guaranteed to be a plain list of names.
 */
export const sniffDelimiter = (text: string): string => {
	const firstLine = readLogicalLine(text)

	let best = ","
	let bestCount = 0

	for (const candidate of DELIMITERS) {
		const count = countOutsideQuotes(firstLine, candidate)
		if (count > bestCount) {
			best = candidate
			bestCount = count
		}
	}

	// A single column is a legitimate CSV; comma is the harmless default.
	return bestCount === 0 ? "," : best
}

/** The first line, respecting quotes — a quoted header may contain a newline. */
const readLogicalLine = (text: string): string => {
	let quoted = false

	for (let i = 0; i < text.length; i++) {
		const char = text[i]
		if (char === '"') {
			if (quoted && text[i + 1] === '"') i++
			else quoted = !quoted
		} else if (!quoted && (char === "\n" || char === "\r")) {
			return text.slice(0, i)
		}
	}

	return text
}

const countOutsideQuotes = (line: string, delimiter: string): number => {
	let count = 0
	let quoted = false

	for (let i = 0; i < line.length; i++) {
		const char = line[i]
		if (char === '"') {
			if (quoted && line[i + 1] === '"') i++
			else quoted = !quoted
		} else if (!quoted && char === delimiter) {
			count++
		}
	}

	return count
}

/** Strips the UTF-8 BOM, which otherwise becomes part of the first header. */
export const stripBom = (text: string): string =>
	text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

export const parseCsv = (input: string, delimiter?: string): ParsedCsv => {
	const text = stripBom(input)
	const sep = delimiter ?? sniffDelimiter(text)

	const rows: string[][] = []
	let row: string[] = []
	let field = ""
	let quoted = false
	// Distinguishes an empty final row from a file that simply ended after a
	// newline — without it every file gains a phantom blank row.
	let started = false

	const endField = () => {
		row.push(field)
		field = ""
		started = true
	}

	const endRow = () => {
		endField()
		rows.push(row)
		row = []
		started = false
	}

	for (let i = 0; i < text.length; i++) {
		const char = text[i]!

		if (quoted) {
			if (char === '"') {
				// "" inside a quoted field is one literal quote.
				if (text[i + 1] === '"') {
					field += '"'
					i++
				} else {
					quoted = false
				}
			} else {
				field += char
			}
			continue
		}

		if (char === '"') {
			quoted = true
			started = true
			continue
		}

		if (char === sep) {
			endField()
			continue
		}

		if (char === "\r") {
			// CRLF and a lone CR both end the row; the LF is swallowed below.
			if (text[i + 1] === "\n") i++
			endRow()
			continue
		}

		if (char === "\n") {
			endRow()
			continue
		}

		field += char
		started = true
	}

	if (started || field || row.length) endRow()

	const headers = (rows.shift() ?? []).map((h) => h.trim())

	return {
		headers,
		// A trailing newline leaves one empty row, and spreadsheets add blank
		// rows below the data often enough that dropping them is kinder than
		// reporting fifty "row is empty" errors.
		rows: rows.filter((r) => r.some((cell) => cell.trim() !== "")),
		delimiter: sep,
	}
}

/** Row as an object keyed by header. Duplicate headers: the first one wins. */
export const rowToRecord = (headers: string[], row: string[]): Record<string, string> => {
	const record: Record<string, string> = {}

	for (const [index, header] of headers.entries()) {
		if (header && !(header in record)) record[header] = row[index] ?? ""
	}

	return record
}

/**
 * One value out to CSV.
 *
 * Quoted whenever it contains the delimiter, a quote, a newline, or leading or
 * trailing space — Excel eats the spaces otherwise. A leading `=`, `+`, `-` or
 * `@` is prefixed with a quote character as well: spreadsheets treat those as
 * formulas, which is how a product name becomes a command someone's machine
 * runs when they open the export.
 */
export const escapeCsvValue = (value: unknown, delimiter = ","): string => {
	if (value === null || value === undefined) return ""

	let text = String(value)

	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`

	const mustQuote =
		text.includes(delimiter) ||
		text.includes('"') ||
		text.includes("\n") ||
		text.includes("\r") ||
		text !== text.trim()

	return mustQuote ? `"${text.replace(/"/g, '""')}"` : text
}

export const toCsv = (
	headers: string[],
	rows: unknown[][],
	opts: { delimiter?: string; bom?: boolean } = {}
): string => {
	const delimiter = opts.delimiter ?? ","

	const lines = [
		headers.map((h) => escapeCsvValue(h, delimiter)).join(delimiter),
		...rows.map((row) => row.map((cell) => escapeCsvValue(cell, delimiter)).join(delimiter)),
	]

	// CRLF and a BOM by default: both are what Excel expects, and without the
	// BOM it reads a UTF-8 export as Latin-1 and turns every ü into Ã¼.
	return (opts.bom === false ? "" : "﻿") + lines.join("\r\n")
}
