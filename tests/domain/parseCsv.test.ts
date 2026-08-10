import { describe, expect, it } from "vitest"
import {
	escapeCsvValue,
	parseCsv,
	rowToRecord,
	sniffDelimiter,
	stripBom,
	toCsv,
} from "../../src/domain/csv/parseCsv"

/**
 * The importer accepts whatever a customer exports from whatever they run, so
 * the cases worth pinning are the malformed and the regional ones rather than
 * the tidy example.
 */
describe("parseCsv", () => {
	it("reads a plain file", () => {
		const { headers, rows } = parseCsv("a,b\n1,2\n3,4")
		expect(headers).toEqual(["a", "b"])
		expect(rows).toEqual([
			["1", "2"],
			["3", "4"],
		])
	})

	it("strips the byte-order mark", () => {
		// Without this the first header is "﻿ID" and never matches anything.
		const { headers } = parseCsv("﻿ID,Name\n1,Thing")
		expect(headers).toEqual(["ID", "Name"])
		expect(stripBom("﻿x")).toBe("x")
	})

	it("keeps quoted delimiters, quotes and newlines inside one field", () => {
		const { rows } = parseCsv('a,b\n"x, y","he said ""no""\nsecond line"')
		expect(rows[0]).toEqual(["x, y", 'he said "no"\nsecond line'])
	})

	it("handles CRLF, lone CR and a trailing newline", () => {
		expect(parseCsv("a,b\r\n1,2\r\n").rows).toEqual([["1", "2"]])
		expect(parseCsv("a,b\r1,2").rows).toEqual([["1", "2"]])
		// A trailing newline must not produce a phantom empty row.
		expect(parseCsv("a,b\n1,2\n").rows).toHaveLength(1)
	})

	it("keeps empty fields, and drops rows that are entirely empty", () => {
		const { rows } = parseCsv("a,b,c\n1,,3\n,,\n4,5,6")
		expect(rows).toEqual([
			["1", "", "3"],
			["4", "5", "6"],
		])
	})

	it("does not lose a field that is only whitespace", () => {
		expect(parseCsv('a,b\n" ",x').rows[0]).toEqual([" ", "x"])
	})

	describe("delimiter sniffing", () => {
		it("finds semicolons, tabs and pipes", () => {
			// A German Excel writes semicolons by default.
			expect(sniffDelimiter("a;b;c")).toBe(";")
			expect(sniffDelimiter("a\tb\tc")).toBe("\t")
			expect(sniffDelimiter("a|b|c")).toBe("|")
			expect(sniffDelimiter("a,b,c")).toBe(",")
		})

		it("ignores delimiters inside quoted headers", () => {
			// "GTIN, UPC, EAN" is a real WooCommerce header; counting its commas
			// would pick the wrong separator for a semicolon file.
			expect(sniffDelimiter('"GTIN, UPC, EAN";Name;SKU')).toBe(";")
		})

		it("only looks at the header row", () => {
			// A description full of semicolons must not outvote the real separator.
			expect(sniffDelimiter('a,b\n"x;y;z;w;v",2')).toBe(",")
		})

		it("defaults to comma for a single column", () => {
			expect(sniffDelimiter("OnlyOneHeader")).toBe(",")
		})

		it("is overridable", () => {
			expect(parseCsv("a;b\n1;2", ";").rows[0]).toEqual(["1", "2"])
		})
	})

	describe("rowToRecord", () => {
		it("keys by header and pads a short row", () => {
			expect(rowToRecord(["a", "b", "c"], ["1", "2"])).toEqual({ a: "1", b: "2", c: "" })
		})

		it("keeps the first of two identical headers", () => {
			// Duplicated headers exist; silently overwriting would lose the column
			// the mapping was built against.
			expect(rowToRecord(["a", "a"], ["first", "second"])).toEqual({ a: "first" })
		})

		it("ignores an unnamed column", () => {
			expect(rowToRecord(["a", ""], ["1", "2"])).toEqual({ a: "1" })
		})
	})
})

describe("toCsv", () => {
	it("quotes only what needs it", () => {
		expect(escapeCsvValue("plain")).toBe("plain")
		expect(escapeCsvValue("a,b")).toBe('"a,b"')
		expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""')
		expect(escapeCsvValue("two\nlines")).toBe('"two\nlines"')
		// Excel trims unquoted padding.
		expect(escapeCsvValue(" padded ")).toBe('" padded "')
	})

	it("defuses a value a spreadsheet would run as a formula", () => {
		// =HYPERLINK(...) in a product name executes on open. Prefixing with an
		// apostrophe is what stops it being a formula at all.
		expect(escapeCsvValue("=1+1")).toBe("'=1+1")
		expect(escapeCsvValue("+A1")).toBe("'+A1")
		expect(escapeCsvValue("-2")).toBe("'-2")
		expect(escapeCsvValue("@x")).toBe("'@x")
	})

	it("writes a BOM and CRLF so Excel reads UTF-8", () => {
		const csv = toCsv(["a"], [["ü"]])
		expect(csv.startsWith("﻿")).toBe(true)
		expect(csv).toContain("\r\n")
	})

	it("round-trips through the parser", () => {
		const headers = ["Name", "Description", "Price"]
		const rows = [
			['Pan, 60 × 40', 'Says "big"\nand tall', "12.50"],
			["Plain", "", "0"],
		]

		const parsed = parseCsv(toCsv(headers, rows))
		expect(parsed.headers).toEqual(headers)
		expect(parsed.rows).toEqual(rows)
	})

	it("round-trips a semicolon file", () => {
		const parsed = parseCsv(toCsv(["a", "b"], [["x;y", "z"]], { delimiter: ";" }))
		expect(parsed.delimiter).toBe(";")
		expect(parsed.rows[0]).toEqual(["x;y", "z"])
	})
})
