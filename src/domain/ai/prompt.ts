/**
 * What the shop asks a model for when staff press "write this for me".
 *
 * Pure: builds the two prompts and cleans what comes back. No provider, no
 * network, no settings — the service supplies those. That split is what makes
 * the wording testable, and the wording is the part that decides whether the
 * text reads like this shop or like a brochure.
 *
 * The client sells custom stainless-steel baking hardware to German bakeries
 * and to trade, so German is the language these texts are written in and
 * English is the translation. See ERP-PLAN.md and CONTENT-PLAN.md.
 */

export type AiProvider = "anthropic" | "openai"

/** What the field being written is, which decides the shape of the answer. */
export type AiKind = "product" | "productShort" | "category" | "content"

export interface GenerateInput {
	kind: AiKind
	locale: "de" | "en"
	/** What the admin typed: "stainless steel straw, 6mm, engraved". */
	brief: string
	/** The record's own name, when it has one — free context the admin need not retype. */
	name?: string
	sku?: string
	/** Attribute values, sizes, materials — whatever the editor knows. */
	facts?: string[]
	/** Existing copy. Present means rewrite this, absent means write it fresh. */
	existing?: string
	/** The house voice, from settings. Empty is fine; the defaults below carry it. */
	voice?: string
}

export interface Prompts {
	system: string
	user: string
	/** Upper bound for the answer. Short fields must not be given room to ramble. */
	maxTokens: number
}

/** Long enough for a real brief, short enough that a paste cannot run up a bill. */
export const MAX_BRIEF = 2000
export const MAX_EXISTING = 8000
export const MAX_FACTS = 20

/**
 * The model each provider uses unless the shop names another.
 *
 * Opus is the default because the text goes in front of customers in a language
 * the shop's own staff will read critically — and a description is a few
 * hundred tokens, so the difference between tiers is fractions of a cent per
 * press. The setting exists for whoever would rather spend less.
 */
export const DEFAULT_MODEL: Record<AiProvider, string> = {
	anthropic: "claude-opus-5",
	openai: "gpt-4o-mini",
}

const LANGUAGE: Record<GenerateInput["locale"], string> = {
	de: "German",
	en: "English",
}

/**
 * House voice when the shop has not written one.
 *
 * "Sie" rather than "du": the customers are bakeries, hotels and trade buyers,
 * and the existing catalogue addresses them formally.
 */
const DEFAULT_VOICE =
	"Plain, concrete, and free of marketing adjectives. Address the reader formally (Sie). " +
	"Say what the thing is, what it is made of, and what it is for. Never invent a measurement, " +
	"a material, a certification or a price that was not given to you."

const SHAPE: Record<AiKind, { instruction: string; maxTokens: number }> = {
	product: {
		instruction:
			"Write a product description of two short paragraphs. Return simple HTML: <p> for paragraphs, " +
			"<ul><li> for a short list of properties if there is something to list. No headings, no <html> or <body>.",
		maxTokens: 900,
	},
	productShort: {
		instruction:
			"Write a single sentence of at most 160 characters that says what this product is. Plain text, no HTML, no quotation marks.",
		maxTokens: 200,
	},
	category: {
		instruction:
			"Write one short paragraph introducing this product category to someone browsing it. " +
			"Return simple HTML: a single <p>. No headings.",
		maxTokens: 500,
	},
	content: {
		instruction:
			"Write the text asked for. Return simple HTML: <p> for paragraphs, <ul><li> where a list genuinely helps. " +
			"No headings unless the brief asks for them.",
		maxTokens: 1200,
	},
}

const clamp = (value: string | undefined, limit: number): string =>
	(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit)

export const buildPrompts = (input: GenerateInput): Prompts => {
	const shape = SHAPE[input.kind]
	const voice = clamp(input.voice, 1000) || DEFAULT_VOICE

	const system = [
		`You write catalogue copy for astano, a German manufacturer of custom stainless-steel baking and kitchen hardware sold to bakeries and to trade customers.`,
		`Write in ${LANGUAGE[input.locale]}.`,
		voice,
		shape.instruction,
		`Return only the text itself — no preamble, no explanation, no code fences.`,
	].join("\n\n")

	const facts = (input.facts ?? []).slice(0, MAX_FACTS).map((fact) => clamp(fact, 120)).filter(Boolean)
	const existing = clamp(input.existing, MAX_EXISTING)

	const user = [
		input.name ? `Product or page name: ${clamp(input.name, 200)}` : null,
		input.sku ? `Article number: ${clamp(input.sku, 60)}` : null,
		facts.length ? `Known facts:\n${facts.map((fact) => `- ${fact}`).join("\n")}` : null,
		existing
			? `Rewrite this existing text, keeping every fact in it:\n${existing}`
			: null,
		clamp(input.brief, MAX_BRIEF) ? `What to write about: ${clamp(input.brief, MAX_BRIEF)}` : null,
	]
		.filter(Boolean)
		.join("\n\n")

	return {
		system,
		// A request with nothing in it would otherwise send an empty user turn,
		// which both providers reject with a less helpful message than this.
		user: user || "Write the text from the name and facts above.",
		maxTokens: shape.maxTokens,
	}
}

export interface TranslateInput {
	/** The text as it stands, in `from`. */
	text: string
	from: "de" | "en"
	to: "de" | "en"
	/** HTML round-trips as HTML; a name or a title must come back as plain text. */
	html: boolean
}

/** Roughly what the source costs, plus room for a language that runs longer. */
const translationTokens = (text: string): number =>
	Math.min(4000, Math.max(300, Math.ceil(text.length / 2)))

/**
 * Translating one field into the other language.
 *
 * Deliberately not the same prompt as writing. A translator that is also
 * allowed to improve the copy will quietly drop the sentence it found awkward
 * and add one it thinks is missing — and nobody reads the German side again to
 * notice. The instruction is therefore narrow: same facts, same order, same
 * markup, and the trade's own words left alone.
 */
export const buildTranslationPrompts = (input: TranslateInput): Prompts => {
	const system = [
		`You translate catalogue copy for astano, a German manufacturer of stainless-steel baking and kitchen hardware.`,
		`Translate from ${LANGUAGE[input.from]} into ${LANGUAGE[input.to]}.`,
		`Translate faithfully: every fact, measurement, material and number exactly as given, in the same order. ` +
			`Add nothing, drop nothing, and do not improve the text.`,
		input.html
			? `The input is HTML. Return the same HTML structure with only the text translated — same tags, same order, no new ones.`
			: `Return plain text only, with no markup and no quotation marks around it.`,
		`Product names and article numbers stay as they are. Return only the translation, with no preamble and no code fences.`,
	].join("\n\n")

	return {
		system,
		user: input.text.slice(0, MAX_EXISTING),
		maxTokens: translationTokens(input.text),
	}
}

/**
 * What came back, made fit to drop into the field.
 *
 * Models wrap HTML in ``` fences when they think they are handing over code,
 * and a fence pasted into a description renders as literal backticks. The rest
 * of the cleaning — script tags, event handlers, anything else a field must not
 * carry — is `sanitizeRichText`'s job and happens in the service, because it is
 * the same rule every other HTML field on this site goes through.
 */
export const stripFences = (raw: string): string => {
	const text = raw.trim()
	const fenced = /^```(?:html|HTML)?\s*\n([\s\S]*?)\n?```$/.exec(text)
	return (fenced?.[1] ?? text).trim()
}

/** Plain-text fields must not come back carrying markup or surrounding quotes. */
export const toPlainText = (raw: string): string =>
	stripFences(raw)
		.replace(/<[^>]*>/g, "")
		.replace(/^["“”']+|["“”']+$/g, "")
		.replace(/\s+/g, " ")
		.trim()
