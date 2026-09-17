import { describe, expect, it } from "vitest"
import {
	buildPrompts,
	buildTranslationPrompts,
	DEFAULT_MODEL,
	formatOf,
	MAX_BRIEF,
	stripFences,
	toPlainText,
	type GenerateInput,
} from "../../src/domain/ai/prompt"

/**
 * The prompts behind the "write this for me" button.
 *
 * Pinned rather than merely exercised: these decide what a customer reads on a
 * product page. The two rules worth a failing test are that the language is
 * stated explicitly — the catalogue is German and a model left to guess from a
 * German product name will still sometimes answer in English — and that the
 * model is told not to invent facts about hardware it cannot see.
 */
const input = (overrides: Partial<GenerateInput> = {}): GenerateInput => ({
	kind: "product",
	locale: "de",
	brief: "Edelstahl Trinkhalm, 6mm, mit Gravur",
	...overrides,
})

describe("buildPrompts", () => {
	it("names the language, and names German for the German catalogue", () => {
		expect(buildPrompts(input()).system).toContain("Write in German.")
		expect(buildPrompts(input({ locale: "en" })).system).toContain("Write in English.")
	})

	it("forbids invented facts, which is the whole risk with hardware copy", () => {
		expect(buildPrompts(input()).system).toContain("Never invent a measurement")
	})

	it("uses the shop's own voice when it has one", () => {
		const system = buildPrompts(input({ voice: "Kurz und sachlich, per du." })).system
		expect(system).toContain("Kurz und sachlich, per du.")
		expect(system).not.toContain("Address the reader formally")
	})

	it("asks for HTML for a description and plain text for the one-liner", () => {
		expect(buildPrompts(input()).system).toContain("<p> for paragraphs")
		const short = buildPrompts(input({ kind: "productShort" }))
		expect(short.system).toContain("no HTML")
		// A short field given a long ceiling is a short field that comes back long.
		expect(short.maxTokens).toBeLessThan(buildPrompts(input()).maxTokens)
	})

	it("carries the name, article number and known facts into the request", () => {
		const { user } = buildPrompts(
			input({ name: "Edelstahl Trinkhalm", sku: "1-ESH-1", facts: ["6 mm", "215 mm lang"] })
		)
		expect(user).toContain("Edelstahl Trinkhalm")
		expect(user).toContain("1-ESH-1")
		expect(user).toContain("- 6 mm")
		expect(user).toContain("- 215 mm lang")
	})

	it("says rewrite, not write, when there is already text", () => {
		const { user } = buildPrompts(input({ existing: "Ein Trinkhalm aus Edelstahl." }))
		expect(user).toContain("Rewrite this existing text, keeping every fact in it")
		expect(user).toContain("Ein Trinkhalm aus Edelstahl.")
	})

	it("caps a pasted brief rather than sending whatever was in the clipboard", () => {
		const { user } = buildPrompts(input({ brief: "x".repeat(MAX_BRIEF + 500) }))
		expect(user).toContain("x".repeat(MAX_BRIEF))
		expect(user).not.toContain("x".repeat(MAX_BRIEF + 1))
	})

	it("never sends an empty user turn", () => {
		expect(buildPrompts(input({ brief: "   " })).user).toBe(
			"Write the text from the name and facts above."
		)
	})

	it("defaults to a model per provider", () => {
		expect(DEFAULT_MODEL.anthropic).toBe("claude-opus-5")
		expect(DEFAULT_MODEL.openai).toBe("gpt-4o-mini")
	})
})

describe("buildTranslationPrompts", () => {
	const translate = (overrides: Partial<Parameters<typeof buildTranslationPrompts>[0]> = {}) =>
		buildTranslationPrompts({
			text: "Edelstahl Trinkhalm, 6 mm, 215 mm lang.",
			from: "de",
			to: "en",
			html: false,
			...overrides,
		})

	it("names the direction, and the other way round when asked", () => {
		expect(translate().system).toContain("Translate from German into English.")
		expect(translate({ from: "en", to: "de" }).system).toContain(
			"Translate from English into German."
		)
	})

	/*
	 * The rule this whole prompt exists for. A translator allowed to improve the
	 * copy quietly drops the awkward sentence and adds one it thinks is missing —
	 * and nobody reads the German side again to catch it.
	 */
	it("forbids improving, adding to, or dropping anything", () => {
		const { system } = translate()
		expect(system).toContain("Add nothing, drop nothing, and do not improve the text.")
		expect(system).toContain("every fact, measurement, material and number exactly as given")
	})

	it("asks for the same HTML back for a description, and plain text for a name", () => {
		expect(translate({ html: true }).system).toContain("same HTML structure")
		expect(translate({ html: false }).system).toContain("plain text only")
	})

	it("sends the text as it stands, and leaves product names alone", () => {
		expect(translate().user).toBe("Edelstahl Trinkhalm, 6 mm, 215 mm lang.")
		expect(translate().system).toContain("Product names and article numbers stay as they are")
	})

	it("sizes the answer from the source, with room for a longer language", () => {
		const short = translate({ text: "Halm." })
		const long = translate({ text: "x".repeat(6000) })
		expect(short.maxTokens).toBeGreaterThanOrEqual(300)
		expect(long.maxTokens).toBeGreaterThan(short.maxTokens)
		expect(long.maxTokens).toBeLessThanOrEqual(4000)
	})
})

describe("the plain boxes — meta fields, and a kind in a textarea", () => {
	it("gives a search title and description their own lengths", () => {
		const title = buildPrompts(input({ kind: "metaTitle" }))
		const description = buildPrompts(input({ kind: "metaDescription" }))

		expect(title.system).toContain("at most 60 characters")
		expect(title.system).toContain("Do not append the shop name")
		expect(description.system).toContain("at most 155 characters")
		expect(title.maxTokens).toBeLessThan(description.maxTokens)
	})

	it("says plain text for a kind that normally returns HTML, when the box is plain", () => {
		// A category description is a textarea here and rich text on a product,
		// which is the whole reason `format` overrides the kind.
		const plain = buildPrompts(input({ kind: "category", format: "text" }))
		expect(plain.system).toContain("return no HTML tags of any kind")

		const html = buildPrompts(input({ kind: "category" }))
		expect(html.system).not.toContain("return no HTML tags of any kind")
	})

	it("knows each kind's usual shape", () => {
		expect(formatOf({ kind: "product" })).toBe("html")
		expect(formatOf({ kind: "content" })).toBe("html")
		expect(formatOf({ kind: "metaTitle" })).toBe("text")
		expect(formatOf({ kind: "metaDescription" })).toBe("text")
		expect(formatOf({ kind: "product", format: "text" })).toBe("text")
	})
})

describe("stripFences", () => {
	it("unwraps a fenced answer, which is how models hand over HTML", () => {
		expect(stripFences("```html\n<p>Hallo</p>\n```")).toBe("<p>Hallo</p>")
		expect(stripFences("```\n<p>Hallo</p>\n```")).toBe("<p>Hallo</p>")
	})

	it("leaves ordinary text alone", () => {
		expect(stripFences("  <p>Hallo</p>  ")).toBe("<p>Hallo</p>")
	})
})

describe("toPlainText", () => {
	it("strips markup and the quotation marks a model wraps a sentence in", () => {
		expect(toPlainText('"<p>Ein Trinkhalm aus Edelstahl.</p>"')).toBe(
			"Ein Trinkhalm aus Edelstahl."
		)
		expect(toPlainText("„Ein Halm.“".replace("„", "“"))).toBe("Ein Halm.")
	})

	it("collapses the whitespace a multi-line answer arrives with", () => {
		expect(toPlainText("Ein Halm\n\n  aus Edelstahl.")).toBe("Ein Halm aus Edelstahl.")
	})
})
