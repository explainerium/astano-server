import { describe, expect, it } from "vitest"
import { ContentValidation } from "../../src/app/modules/content/content.validation"
import { CONTENT_REGISTRY } from "../../src/app/modules/content/contentRegistry"

/**
 * The whitelist, defended.
 *
 * The shop edits 195 marketing values and 33 pictures. The message catalogue
 * they come from holds far more — the dashboard's own labels, every button on
 * the storefront, every validation message. None of those may be reachable from
 * the content screen, and the only thing standing between them and an editor is
 * contentRegistry.ts.
 *
 * That is a security boundary in the ordinary sense: the caller supplies the
 * key. Without this check, a request naming `common.loading` would rewrite the
 * word every loading state on the site prints, and nothing else in the stack
 * would object — the value is a string and the row would store it happily.
 */
describe("writeContentSchema — only registered keys may be written", () => {
	const parse = (body: unknown) =>
		ContentValidation.writeContentSchema.safeParse({ body, params: {}, query: {} })

	const TEXT_KEY = "home.hero.slides.0.title"
	const IMAGE_KEY = "home.hero.slides.0.image"

	it("has the keys this test is built on", () => {
		expect(CONTENT_REGISTRY[TEXT_KEY]?.type).toBe("text")
		expect(CONTENT_REGISTRY[IMAGE_KEY]?.type).toBe("image")
	})

	it("accepts a registered text key", () => {
		expect(parse({ entries: [{ key: TEXT_KEY, locale: "de", value: "Neuer Titel" }] }).success).toBe(
			true
		)
	})

	it("accepts a registered picture, and accepts clearing it", () => {
		const id = "00000000-0000-4000-8000-000000000000"
		expect(parse({ media: [{ key: IMAGE_KEY, assetId: id }] }).success).toBe(true)
		expect(parse({ media: [{ key: IMAGE_KEY, assetId: null }] }).success).toBe(true)
	})

	it.each([
		["a storefront button", "shop.addToCart"],
		["a dashboard label", "admin.save"],
		["a shared UI string", "common.loading"],
		["a checkout message", "checkout.placeOrder"],
		["something invented", "not.a.real.key"],
	])("refuses %s", (_what, key) => {
		expect(parse({ entries: [{ key, locale: "de", value: "x" }] }).success).toBe(false)
	})

	it("refuses a picture sent as text, and text sent as a picture", () => {
		expect(parse({ entries: [{ key: IMAGE_KEY, locale: "de", value: "x" }] }).success).toBe(false)
		expect(parse({ media: [{ key: TEXT_KEY, assetId: null }] }).success).toBe(false)
	})

	it("refuses an unknown language", () => {
		expect(parse({ entries: [{ key: TEXT_KEY, locale: "fr", value: "x" }] }).success).toBe(false)
	})

	it("refuses a request that would save nothing", () => {
		expect(parse({}).success).toBe(false)
		expect(parse({ entries: [], media: [] }).success).toBe(false)
	})

	/**
	 * next-intl substitutes `{year}` at render time. An editor who removes it has
	 * not shortened the sentence — they have taken the year out of the footer,
	 * and the page renders the rest without complaint. Nothing downstream would
	 * notice, so it is refused here.
	 */
	describe("placeholders survive the edit", () => {
		const COPYRIGHT = "home.footer.copyright"

		it("the key still declares its variable", () => {
			expect(CONTENT_REGISTRY[COPYRIGHT]?.vars).toEqual(["year"])
		})

		it("accepts a rewrite that keeps {year}", () => {
			const body = { entries: [{ key: COPYRIGHT, locale: "de", value: "© {year} ASSCA GmbH" }] }
			expect(parse(body).success).toBe(true)
		})

		it("refuses a rewrite that drops {year}", () => {
			const body = { entries: [{ key: COPYRIGHT, locale: "de", value: "© ASSCA GmbH" }] }
			expect(parse(body).success).toBe(false)
		})
	})

	/**
	 * A list is one value, and has to still be one on the way in.
	 *
	 * The storefront leaves a malformed list alone rather than breaking the page
	 * it renders, which is the right thing at read time and the wrong thing to
	 * rely on at write time: a bad save would report success and change nothing.
	 * This is what makes that impossible.
	 */
	describe("lists — the FAQ the shop may add to", () => {
		const LIST = "faq.groups.0.items"
		const list = (items: unknown) =>
			parse({ entries: [{ key: LIST, locale: "de", value: JSON.stringify(items) }] })

		it("is declared as a list, with the fields one question carries", () => {
			expect(CONTENT_REGISTRY[LIST]?.type).toBe("list")
			expect(CONTENT_REGISTRY[LIST]?.fields?.map((f) => f.name)).toEqual(["q", "a"])
		})

		it("accepts a longer list than the one that shipped", () => {
			const ten = Array.from({ length: 10 }, (_, i) => ({ q: `Frage ${i}`, a: `Antwort ${i}` }))
			expect(list(ten).success).toBe(true)
		})

		it("accepts an emptied list — a group with no questions is a choice", () => {
			expect(list([]).success).toBe(true)
		})

		it("refuses a value that is not a list at all", () => {
			expect(parse({ entries: [{ key: LIST, locale: "de", value: "Frage?" }] }).success).toBe(false)
			expect(list({ q: "x", a: "y" }).success).toBe(false)
		})

		it("refuses an item missing one of its fields", () => {
			expect(list([{ q: "Frage ohne Antwort" }]).success).toBe(false)
			expect(list([{ q: "x", a: 5 }]).success).toBe(false)
		})

		it("refuses an item carrying a field nothing renders", () => {
			expect(list([{ q: "x", a: "y", script: "<script>" }]).success).toBe(false)
		})

		it("refuses a list long enough to be a document", () => {
			const many = Array.from({ length: 51 }, () => ({ q: "q", a: "a" }))
			expect(list(many).success).toBe(false)
		})
	})

	/**
	 * One bad key must not let the rest through. The service writes in a single
	 * transaction, so a partially-valid payload is either refused whole or saved
	 * whole — and refusing it whole is the safe half.
	 */
	it("refuses the whole payload when one key in it is not editable", () => {
		const body = {
			entries: [
				{ key: TEXT_KEY, locale: "de", value: "fine" },
				{ key: "admin.save", locale: "de", value: "not fine" },
			],
		}
		expect(parse(body).success).toBe(false)
	})
})

/**
 * A registry that has drifted from the catalogue is not an error the type
 * checker can see: both sides are plain strings. These are the invariants the
 * generator produced and the screen relies on.
 */
describe("contentRegistry — shape", () => {
	const entries = Object.entries(CONTENT_REGISTRY)

	it("covers every editable string and picture", () => {
		const images = entries.filter(([, d]) => d.type === "image")
		expect(entries).toHaveLength(228)
		expect(images).toHaveLength(33)
	})

	it("gives every key a group, a section and a label", () => {
		for (const [key, d] of entries) {
			expect(d.group, key).toBeTruthy()
			expect(d.section, key).toBeTruthy()
			expect(d.label, key).toBeTruthy()
		}
	})

	/**
	 * A picture key has to be recognisable as one from the key alone, because
	 * that is all the merge on the storefront has to go on.
	 *
	 * Three shapes, and the third earns its place: most pictures hang off the
	 * thing they illustrate (`…slides.0.image`), a couple are a gallery
	 * (`about.craft.images.0`) — and the dealer cards are plain headings in the
	 * catalogue rather than objects, so theirs live in a parallel array beside
	 * them (`dealers.cardImages.0`) rather than by rewriting copy that reads
	 * perfectly well.
	 */
	it("names every picture key so it reads as one", () => {
		for (const [key, d] of entries) {
			if (d.type !== "image") continue
			expect(key, key).toMatch(/\.(image|icon)$|[Ii]mages\.\d+$/)
		}
	})

	it("keeps admin and storefront-chrome namespaces out", () => {
		const allowed = new Set([
			"auth",
			"shop",
			"home",
			"about",
			"custom",
			"quality",
			"dealers",
			"faq",
			"contact",
			"payment",
			"site",
			"nav",
		])
		for (const [key] of entries) {
			expect(allowed.has(key.split(".")[0]), key).toBe(true)
		}
	})
})
