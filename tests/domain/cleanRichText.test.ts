import { describe, expect, it } from "vitest"
import { cleanRichText } from "../../src/domain/product/cleanRichText"

/**
 * Every imported astano description rendered a visible "\n" through the middle
 * of its paragraphs, so the cases that matter are the ones where an escape is
 * removed and the one where it must not be.
 */
describe("cleanRichText", () => {
	it("strips escaped newlines from markup", () => {
		expect(cleanRichText("<p>Edelstahl</p>\\n<p>Ausstechformen</p>")).toBe(
			"<p>Edelstahl</p> <p>Ausstechformen</p>"
		)
	})

	it("strips a run of them", () => {
		expect(cleanRichText("<ul>\\n \\n<li>Markenaktionen</li>\\n</ul>")).toBe(
			"<ul> <li>Markenaktionen</li> </ul>"
		)
	})

	it("handles the Windows pair", () => {
		expect(cleanRichText("<p>a</p>\\r\\n<p>b</p>")).toBe("<p>a</p> <p>b</p>")
	})

	it("turns them into real breaks in plain text", () => {
		// Not markup, so the escape genuinely stood for a line break and the
		// paragraphs would otherwise run together.
		expect(cleanRichText("Erste Zeile\\nZweite Zeile")).toBe("Erste Zeile\nZweite Zeile")
	})

	it("leaves clean markup alone", () => {
		const html = "<p>Nichts zu tun</p>"
		expect(cleanRichText(html)).toBe(html)
	})

	it("treats empty and missing input as no description", () => {
		expect(cleanRichText(null)).toBeNull()
		expect(cleanRichText("")).toBeNull()
		expect(cleanRichText("   ")).toBeNull()
	})

	it("leaves a backslash that is not one of the three escapes", () => {
		expect(cleanRichText("<p>Ordner C:\\daten</p>")).toBe("<p>Ordner C:\\daten</p>")
	})
})
