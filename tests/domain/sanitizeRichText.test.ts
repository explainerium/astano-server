import { describe, expect, it } from "vitest"
import { sanitizeRichText, stripHtml } from "../../src/domain/html/sanitizeRichText"

/**
 * Product descriptions reach the storefront through dangerouslySetInnerHTML,
 * and one of the two writers is a CSV file from outside. These are the shapes
 * that must not survive the trip.
 */
describe("sanitizeRichText", () => {
	describe("what it removes", () => {
		it("drops a script tag and its source", () => {
			// Not just the tag: keeping the text would paste the source into the
			// page as visible copy.
			expect(sanitizeRichText('<p>Hallo</p><script>alert(1)</script>')).toBe("<p>Hallo</p>")
		})

		it("drops an event handler", () => {
			expect(sanitizeRichText('<p onclick="steal()">Hallo</p>')).toBe("<p>Hallo</p>")
		})

		it("drops an image with an onerror payload", () => {
			// The classic CSV-import vector. img is not on the allowlist at all,
			// so the whole element goes.
			expect(sanitizeRichText('<p>a</p><img src=x onerror=alert(1)>')).toBe("<p>a</p>")
		})

		it("drops a javascript: href but keeps the text", () => {
			expect(sanitizeRichText('<a href="javascript:alert(1)">Klicken</a>')).toBe(
				'<a rel="noopener noreferrer nofollow" target="_blank">Klicken</a>'
			)
		})

		it("drops a data: href", () => {
			const result = sanitizeRichText('<a href="data:text/html,<script>alert(1)</script>">x</a>')
			expect(result).not.toContain("data:")
		})

		it("drops a protocol-relative href", () => {
			const result = sanitizeRichText('<a href="//evil.example/x">x</a>')
			expect(result).not.toContain("evil.example")
		})

		it("drops an iframe", () => {
			expect(sanitizeRichText('<p>a</p><iframe src="https://evil.example"></iframe>')).toBe(
				"<p>a</p>"
			)
		})

		it("drops a style block rather than printing its source", () => {
			expect(sanitizeRichText("<p>a</p><style>body{display:none}</style>")).toBe("<p>a</p>")
		})

		it("returns null when nothing survives", () => {
			// Null, not "", so it reads as "no description" like a field never
			// filled in.
			expect(sanitizeRichText("<script>alert(1)</script>")).toBeNull()
			expect(sanitizeRichText(null)).toBeNull()
			expect(sanitizeRichText("")).toBeNull()
		})
	})

	describe("what it keeps", () => {
		it("keeps everything the editor can produce", () => {
			const html =
				"<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4>" +
				"<p><strong>bold</strong><em>italic</em><u>under</u><s>struck</s><code>code</code></p>" +
				"<ul><li>one</li></ul><ol><li>two</li></ol>" +
				"<blockquote>quote</blockquote><hr /><pre><code>block</code></pre>"

			const result = sanitizeRichText(html)

			for (const tag of ["h1", "h2", "h3", "h4", "strong", "em", "u", "s", "code", "ul", "ol", "li", "blockquote", "hr", "pre"]) {
				expect(result).toContain(`<${tag}`)
			}
		})

		it("keeps a real link and hardens it", () => {
			expect(sanitizeRichText('<a href="https://astano.de">astano</a>')).toBe(
				'<a href="https://astano.de" rel="noopener noreferrer nofollow" target="_blank">astano</a>'
			)
		})

		it("keeps mailto and tel links", () => {
			expect(sanitizeRichText('<a href="mailto:a@b.de">mail</a>')).toContain("mailto:a@b.de")
			expect(sanitizeRichText('<a href="tel:+4912345">call</a>')).toContain("tel:+4912345")
		})

		it("keeps German text unharmed", () => {
			// Umlauts and the sharp s survive the round trip rather than coming
			// back as entities that then render literally.
			expect(sanitizeRichText("<p>Ausstechformen für Kühlakkus, größe 3</p>")).toBe(
				"<p>Ausstechformen für Kühlakkus, größe 3</p>"
			)
		})
	})
})

describe("stripHtml", () => {
	it("reduces markup to its text", () => {
		expect(stripHtml("<p>Edelstahl <strong>Eiswürfel</strong></p>")).toBe("Edelstahl Eiswürfel")
	})

	it("removes a script rather than printing it", () => {
		expect(stripHtml("<script>alert(1)</script>Hallo")).toBe("Hallo")
	})

	it("returns null for nothing", () => {
		expect(stripHtml("<p></p>")).toBeNull()
		expect(stripHtml(null)).toBeNull()
	})
})
