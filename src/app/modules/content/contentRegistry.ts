/**
 * Every piece of the storefront the shop may edit, and enough about each one for
 * the dashboard to render it.
 *
 * The same arrangement as emailRegistry.ts, for the same reasons, and it is
 * worth reading that file's opening comment before changing this one. The copy
 * itself ships in the frontend's message catalogue and the pictures in
 * pageMedia.ts; those remain the defaults. What is stored against these keys is
 * an *override*, so an empty table means the site reads exactly as it does
 * today, and a key with no row falls back to what shipped.
 *
 * **This registry is the whitelist.** A key that is not here cannot be edited,
 * however it reaches the API. That is the whole of what keeps the rest of the
 * catalogue — every admin label, every button on the storefront, every
 * validation message — out of reach while the 207 marketing strings and
 * 33 pictures in it are not.
 *
 * Labels are English, like settingRegistry's. They are translated on the client
 * against the `adminContent` namespace, keyed by the content key with its dots
 * escaped, and the English here is the fallback — so a key added tomorrow shows
 * up immediately and can be translated later without a backend deploy. See
 * useSettingText.ts, which explains the escaping and why the translations live
 * in the frontend catalogue rather than here.
 *
 * The keys are the message catalogue's own dotted paths. Reusing them means the
 * merge on the storefront is a lookup rather than a mapping table, and that a
 * key renamed in the catalogue surfaces as an entry this file no longer
 * recognises instead of as a silent mismatch.
 *
 * Picture keys sit beside the text they belong to — `home.hero.slides.0.image`
 * next to `home.hero.slides.0.title` — even though pageMedia.ts holds them in
 * separate arrays today. One naming scheme, one editor, one merge.
 */

export type ContentType =
	/** A line. */
	| "text"
	/** A paragraph. Chosen for anything whose German runs past 120 characters. */
	| "textarea"
	/** Sanitised HTML. Not used by any of the 198 — the long documents are Pages. */
	| "richtext"
	/**
	 * A picture from the media library, stored as an asset id.
	 *
	 * Not per locale, unlike every other type: the marketing images are shared
	 * by both languages, which is how the site works today and what the shop
	 * means by "change this picture".
	 */
	| "image"
	/**
	 * A list the shop may lengthen and shorten, stored as one value.
	 *
	 * Whole rather than per item, and that is the point: the merge on the
	 * storefront replaces what shipped, and can only replace a key the
	 * catalogue already has. Nine questions stored as eighteen keys can be
	 * reworded but never added to — a tenth would land on a key nothing reads,
	 * save without complaint and change nothing. One key holding the whole list
	 * grows and shrinks with it.
	 */
	| "list"

export type ContentGroup =
	| "home"
	| "about"
	| "custom"
	| "quality"
	| "dealers"
	| "faq"
	| "contact"
	| "payment"
	| "shell"
	| "auth"
	| "product"

export interface ContentDefinition {
	/** Which screen in the dashboard, and which page of the site. */
	group: ContentGroup
	/** The sub-heading it appears under within that screen. */
	section: string
	label: string
	/** Shown under the field. Say what it changes, not what it is. */
	help?: string
	type: ContentType
	/**
	 * Placeholders the shipped copy interpolates, without their braces.
	 *
	 * next-intl substitutes `{year}` at render time; an editor who deletes it
	 * has not shortened the sentence, they have removed the year from the
	 * footer. Declared here rather than read from the default, because the
	 * defaults live in the frontend repo and this validation runs in this one.
	 *
	 * Exactly one of them carries any — the rest are plain sentences — so
	 * this is a guard on a single known case and not a general templating
	 * system. Anything listed must still appear in the value that is saved.
	 */
	vars?: string[]
	/**
	 * For `list`: what one item is made of, in the order the editor shows them.
	 *
	 * The names are the keys inside each item as the catalogue already spells
	 * them — an FAQ item is `{ q, a }` — so a saved list drops straight into
	 * the shipped array with nothing to translate.
	 */
	fields?: { name: string; label: string; type: "text" | "textarea" }[]
}

/**
 * The groups, in the order the dashboard's side navigation lists them.
 *
 * Home first because it is the page anybody opens this screen to change, then
 * the marketing pages in the order the menu lists them, then the header and
 * footer — which belong to every page and to none.
 */
export const CONTENT_GROUPS: { id: ContentGroup; title: string; blurb: string }[] = [
	{ id: "home", title: "Home page", blurb: "The hero, the banner tiles and the strips beneath them." },
	{ id: "about", title: "About us", blurb: "The story, the photographs and the value cards." },
	{ id: "custom", title: "Custom manufacture", blurb: "How custom manufacture works, and why." },
	{ id: "quality", title: "Quality", blurb: "What quality means here, and the process behind it." },
	{ id: "dealers", title: "Dealers", blurb: "What a trade account is worth." },
	{ id: "faq", title: "FAQs", blurb: "The questions and their answers." },
	{ id: "contact", title: "Contact", blurb: "The page and its form labels." },
	{ id: "payment", title: "Payment & shipping", blurb: "Terms, methods and delivery." },
	{ id: "shell", title: "Header & footer", blurb: "The menu and the footer, on every page." },
	/*
	 * The sentences on the sign-in, registration and dealer-application pages.
	 *
	 * Their field labels are not here and should not be: "E-Mail" is not copy,
	 * and neither is the hint that explains when a VAT number is required — that
	 * one describes a validation rule, and rewording it would leave the rule
	 * saying something else. What is here is the shop explaining why somebody
	 * should open an account and what happens to their application.
	 */
	{ id: "auth", title: "Sign-in & registration", blurb: "What the shop says on the account pages." },
	/*
	 * The fixed copy on a product page. The product itself is not here — its
	 * name, description and pictures are the catalogue's and are edited under
	 * Products. What is here is the shop explaining how its options work, which
	 * is the same paragraph on all 56 of them.
	 */
	{ id: "product", title: "Product page", blurb: "The shop's own explanation of how options work." },
]

/**
 * The long documents, and the only slugs `pages` will accept.
 *
 * A whitelist for the same reason CONTENT_REGISTRY is one: the slug arrives
 * from the caller, and without this a request could invent a page nothing
 * renders and nobody can find.
 *
 * These three ship as sanitised HTML in the frontend's src/content/legal/, and
 * that stays the default — a slug with no row falls back to it, exactly as a
 * key with no row falls back to the catalogue. Nothing is written here until
 * somebody edits, so the tables start empty and the pages read as they always
 * have.
 */
export const CONTENT_PAGES: { slug: string; label: string; blurb: string }[] = [
	{ slug: "imprint", label: "Imprint", blurb: "Required by §5 TMG." },
	{
		slug: "privacy",
		label: "Privacy policy",
		blurb: "Datenschutzerklärung. The longest document on the site.",
	},
	{ slug: "terms", label: "Terms and conditions", blurb: "What a sale is subject to." },
]

export const isEditablePage = (slug: string): boolean =>
	CONTENT_PAGES.some((page) => page.slug === slug)

/**
 * Where each section is on the site.
 *
 * Printed under the section heading on the content screen, and the whole
 * reason the labels beneath it can stay short: "Tile 2 text" means nothing on
 * its own, and everything under "the four picture tiles directly under the
 * slider, left to right".
 *
 * Keyed `group/section`, because a section name is only unique within its
 * group — four pages have a section called Page and three have Cards.
 */
export const CONTENT_SECTIONS: Record<string, string> = {
	"home/Hero carousel": "The full-width slider at the very top of the home page.",
	"home/Banner tiles": "The four picture tiles directly under the slider, left to right.",
	"home/Categories strip": "The heading above the row of category pictures.",
	"home/Popular products": "The heading and link above the product row.",
	"home/Custom manufacture strip": "The four cards in the Sonderanfertigungen band, lower down the home page.",
	"home/Newsletter": "The sign-up band near the foot of the home page.",
	"about/Page": "The dark band at the top of Über uns.",
	"about/Craft": "The first section, beside the two photographs.",
	"about/Quality": "The second section, beside the single photograph.",
	"about/Practical": "The third section.",
	"about/Value cards": "The four cards at the foot of Über uns, left to right.",
	"custom/Page": "The dark band at the top of Sonderanfertigung.",
	"custom/Lead": "The opening section, beside the two photographs.",
	"custom/How it works": "The four numbered steps.",
	"custom/Why it works": "The four cards under the steps.",
	"custom/Capabilities": "The bulleted list of what can be made.",
	"custom/Call to action": "The closing band with the button.",
	"quality/Page": "The dark band at the top of Qualität.",
	"quality/What quality means": "The three cards under the intro.",
	"quality/Process": "The numbered steps and the photograph beside them.",
	"quality/Promise": "The closing section and its photograph.",
	"dealers/Page": "The top of Händler, and the four card headings.",
	"dealers/Cards": "The pictures on the four cards, left to right.",
	"faq/Page": "The dark band at the top of FAQs.",
	"faq/Questions": "The questions themselves, in the three groups the page shows.",
	"contact/Page": "The top of Kontakt, and the details beside the form.",
	"contact/Form fields": "The labels on the contact form.",
	"payment/Page": "The top of Zahlung & Versand, and the delivery times.",
	"payment/Shipping": "The delivery section.",
	"payment/Terms": "The payment conditions.",
	"shell/Site": "The shop name, used in the browser tab and in search results.",
	"shell/Top bar": "The thin strip above the header. On every page.",
	"shell/Menu": "The links in the header and in the footer. On every page.",
	"shell/Footer": "The footer. On every page.",
	"auth/Sign in": "Under the heading on the sign-in page.",
	"auth/Register": "Under the heading on the registration page.",
	"auth/Dealer application": "The dealer application, and what an applicant is told afterwards.",
	"auth/Password": "The forgotten-password and new-password pages.",
	"product/Options": "The Options area on every product page.",
}

/**
 * **The order of this object is the order of the screen.**
 *
 * Not alphabetical, and not the order the keys happen to sit in the message
 * catalogue: the sections run down the page the way a visitor meets them, and
 * within a section each item runs heading, text, picture, in the order the
 * items themselves appear left to right.
 *
 * So the Startseite screen opens Hero carousel, Banner tiles, Categories strip,
 * Popular products, Sonderanfertigungen, Newsletter — which is what the page
 * does — and somebody editing tile three counts three tiles across the page and
 * finds the third block down. Sorting this file would quietly undo that.
 *
 * A key added later belongs beside the ones it sits next to on the page, not at
 * the end.
 */
export const CONTENT_REGISTRY: Record<string, ContentDefinition> = {
	"home.hero.slides.0.title": { group: "home", section: "Hero carousel", label: "Slide 1 heading", type: "text" },
	"home.hero.slides.0.body": { group: "home", section: "Hero carousel", label: "Slide 1 text", type: "textarea" },
	"home.hero.slides.0.image": { group: "home", section: "Hero carousel", label: "Slide 1 picture", type: "image" },
	"home.hero.slides.1.title": { group: "home", section: "Hero carousel", label: "Slide 2 heading", type: "text" },
	"home.hero.slides.1.body": { group: "home", section: "Hero carousel", label: "Slide 2 text", type: "textarea" },
	"home.hero.slides.1.image": { group: "home", section: "Hero carousel", label: "Slide 2 picture", type: "image" },
	"home.hero.slides.2.title": { group: "home", section: "Hero carousel", label: "Slide 3 heading", type: "text" },
	"home.hero.slides.2.body": { group: "home", section: "Hero carousel", label: "Slide 3 text", type: "textarea" },
	"home.hero.slides.2.image": { group: "home", section: "Hero carousel", label: "Slide 3 picture", type: "image" },
	"home.hero.cta": { group: "home", section: "Hero carousel", label: "Button", type: "text" },
	"home.tiles.0.title": { group: "home", section: "Banner tiles", label: "Tile 1 heading", type: "text" },
	"home.tiles.0.body": { group: "home", section: "Banner tiles", label: "Tile 1 text", type: "text" },
	"home.tiles.0.image": { group: "home", section: "Banner tiles", label: "Tile 1 picture", type: "image" },
	"home.tiles.1.title": { group: "home", section: "Banner tiles", label: "Tile 2 heading", type: "text" },
	"home.tiles.1.body": { group: "home", section: "Banner tiles", label: "Tile 2 text", type: "text" },
	"home.tiles.1.image": { group: "home", section: "Banner tiles", label: "Tile 2 picture", type: "image" },
	"home.tiles.2.title": { group: "home", section: "Banner tiles", label: "Tile 3 heading", type: "text" },
	"home.tiles.2.body": { group: "home", section: "Banner tiles", label: "Tile 3 text", type: "text" },
	"home.tiles.2.image": { group: "home", section: "Banner tiles", label: "Tile 3 picture", type: "image" },
	"home.tiles.3.title": { group: "home", section: "Banner tiles", label: "Tile 4 heading", type: "text" },
	"home.tiles.3.body": { group: "home", section: "Banner tiles", label: "Tile 4 text", type: "text" },
	"home.tiles.3.image": { group: "home", section: "Banner tiles", label: "Tile 4 picture", type: "image" },
	"home.categories.heading": { group: "home", section: "Categories strip", label: "Heading", type: "text" },
	"home.popular.heading": { group: "home", section: "Popular products", label: "Heading", type: "text" },
	"home.popular.cta": { group: "home", section: "Popular products", label: "Button", type: "text" },
	"home.popular.empty": { group: "home", section: "Popular products", label: "Message when there is nothing to show", type: "text" },
	"home.custom.cards.0.title": { group: "home", section: "Custom manufacture strip", label: "Card 1 heading", type: "text" },
	"home.custom.cards.0.body": { group: "home", section: "Custom manufacture strip", label: "Card 1 text", type: "textarea" },
	"home.custom.cards.0.icon": { group: "home", section: "Custom manufacture strip", label: "Card 1 icon", type: "image" },
	"home.custom.cards.1.title": { group: "home", section: "Custom manufacture strip", label: "Card 2 heading", type: "text" },
	"home.custom.cards.1.body": { group: "home", section: "Custom manufacture strip", label: "Card 2 text", type: "textarea" },
	"home.custom.cards.1.icon": { group: "home", section: "Custom manufacture strip", label: "Card 2 icon", type: "image" },
	"home.custom.cards.2.title": { group: "home", section: "Custom manufacture strip", label: "Card 3 heading", type: "text" },
	"home.custom.cards.2.body": { group: "home", section: "Custom manufacture strip", label: "Card 3 text", type: "textarea" },
	"home.custom.cards.2.icon": { group: "home", section: "Custom manufacture strip", label: "Card 3 icon", type: "image" },
	"home.custom.cards.3.title": { group: "home", section: "Custom manufacture strip", label: "Card 4 heading", type: "text" },
	"home.custom.cards.3.body": { group: "home", section: "Custom manufacture strip", label: "Card 4 text", type: "textarea" },
	"home.custom.cards.3.icon": { group: "home", section: "Custom manufacture strip", label: "Card 4 icon", type: "image" },
	"home.custom.heading": { group: "home", section: "Custom manufacture strip", label: "Heading", type: "text" },
	"home.custom.intro": { group: "home", section: "Custom manufacture strip", label: "Intro text", type: "textarea" },
	"home.newsletter.heading": { group: "home", section: "Newsletter", label: "Heading", type: "text" },
	"home.newsletter.email": { group: "home", section: "Newsletter", label: "Email", type: "text" },
	"home.newsletter.note": { group: "home", section: "Newsletter", label: "Note", type: "text" },
	"home.newsletter.placeholder": { group: "home", section: "Newsletter", label: "Placeholder", type: "text" },
	"home.newsletter.submit": { group: "home", section: "Newsletter", label: "Submit", type: "text" },
	"about.title": { group: "about", section: "Page", label: "Heading", type: "text" },
	"about.intro": { group: "about", section: "Page", label: "Intro text", type: "textarea" },
	"about.heroCta": { group: "about", section: "Page", label: "Hero cta", type: "text" },
	"about.craft.images.0": { group: "about", section: "Craft", label: "Photograph 1", type: "image" },
	"about.craft.images.1": { group: "about", section: "Craft", label: "Photograph 2", type: "image" },
	"about.craft.title": { group: "about", section: "Craft", label: "Heading", type: "text" },
	"about.craft.body": { group: "about", section: "Craft", label: "Text", type: "textarea" },
	"about.quality.title": { group: "about", section: "Quality", label: "Heading", type: "text" },
	"about.quality.body": { group: "about", section: "Quality", label: "Text", type: "textarea" },
	"about.quality.image": { group: "about", section: "Quality", label: "Picture", type: "image" },
	"about.quality.cta": { group: "about", section: "Quality", label: "Button", type: "text" },
	"about.practical.title": { group: "about", section: "Practical", label: "Heading", type: "text" },
	"about.practical.body": { group: "about", section: "Practical", label: "Text", type: "textarea" },
	"about.practical.cta": { group: "about", section: "Practical", label: "Button", type: "text" },
	"about.cards.0.title": { group: "about", section: "Value cards", label: "Card 1 heading", type: "text" },
	"about.cards.0.body": { group: "about", section: "Value cards", label: "Card 1 text", type: "textarea" },
	"about.cards.0.icon": { group: "about", section: "Value cards", label: "Card 1 icon", type: "image" },
	"about.cards.1.title": { group: "about", section: "Value cards", label: "Card 2 heading", type: "text" },
	"about.cards.1.body": { group: "about", section: "Value cards", label: "Card 2 text", type: "textarea" },
	"about.cards.1.icon": { group: "about", section: "Value cards", label: "Card 2 icon", type: "image" },
	"about.cards.2.title": { group: "about", section: "Value cards", label: "Card 3 heading", type: "text" },
	"about.cards.2.body": { group: "about", section: "Value cards", label: "Card 3 text", type: "textarea" },
	"about.cards.2.icon": { group: "about", section: "Value cards", label: "Card 3 icon", type: "image" },
	"about.cards.3.title": { group: "about", section: "Value cards", label: "Card 4 heading", type: "text" },
	"about.cards.3.body": { group: "about", section: "Value cards", label: "Card 4 text", type: "textarea" },
	"about.cards.3.icon": { group: "about", section: "Value cards", label: "Card 4 icon", type: "image" },
	"custom.title": { group: "custom", section: "Page", label: "Heading", type: "text" },
	"custom.intro": { group: "custom", section: "Page", label: "Intro text", type: "textarea" },
	"custom.lead.images.0": { group: "custom", section: "Lead", label: "Photograph 1", type: "image" },
	"custom.lead.images.1": { group: "custom", section: "Lead", label: "Photograph 2", type: "image" },
	"custom.lead.title": { group: "custom", section: "Lead", label: "Heading", type: "text" },
	"custom.lead.body": { group: "custom", section: "Lead", label: "Text", type: "textarea" },
	"custom.how.steps.0.title": { group: "custom", section: "How it works", label: "Step 1 heading", type: "text" },
	"custom.how.steps.0.body": { group: "custom", section: "How it works", label: "Step 1 text", type: "textarea" },
	"custom.how.steps.1.title": { group: "custom", section: "How it works", label: "Step 2 heading", type: "text" },
	"custom.how.steps.1.body": { group: "custom", section: "How it works", label: "Step 2 text", type: "text" },
	"custom.how.steps.2.title": { group: "custom", section: "How it works", label: "Step 3 heading", type: "text" },
	"custom.how.steps.2.body": { group: "custom", section: "How it works", label: "Step 3 text", type: "textarea" },
	"custom.how.steps.3.title": { group: "custom", section: "How it works", label: "Step 4 heading", type: "text" },
	"custom.how.steps.3.body": { group: "custom", section: "How it works", label: "Step 4 text", type: "textarea" },
	"custom.how.title": { group: "custom", section: "How it works", label: "Heading", type: "text" },
	"custom.why.cards.0.title": { group: "custom", section: "Why it works", label: "Card 1 heading", type: "text" },
	"custom.why.cards.0.body": { group: "custom", section: "Why it works", label: "Card 1 text", type: "textarea" },
	"custom.why.cards.0.icon": { group: "custom", section: "Why it works", label: "Card 1 icon", type: "image" },
	"custom.why.cards.1.title": { group: "custom", section: "Why it works", label: "Card 2 heading", type: "text" },
	"custom.why.cards.1.body": { group: "custom", section: "Why it works", label: "Card 2 text", type: "textarea" },
	"custom.why.cards.1.icon": { group: "custom", section: "Why it works", label: "Card 2 icon", type: "image" },
	"custom.why.cards.2.title": { group: "custom", section: "Why it works", label: "Card 3 heading", type: "text" },
	"custom.why.cards.2.body": { group: "custom", section: "Why it works", label: "Card 3 text", type: "textarea" },
	"custom.why.cards.2.icon": { group: "custom", section: "Why it works", label: "Card 3 icon", type: "image" },
	"custom.why.cards.3.title": { group: "custom", section: "Why it works", label: "Card 4 heading", type: "text" },
	"custom.why.cards.3.body": { group: "custom", section: "Why it works", label: "Card 4 text", type: "textarea" },
	"custom.why.cards.3.icon": { group: "custom", section: "Why it works", label: "Card 4 icon", type: "image" },
	"custom.why.title": { group: "custom", section: "Why it works", label: "Heading", type: "text" },
	"custom.capabilities.items.0": { group: "custom", section: "Capabilities", label: "Item 1", type: "text" },
	"custom.capabilities.items.1": { group: "custom", section: "Capabilities", label: "Item 2", type: "text" },
	"custom.capabilities.items.2": { group: "custom", section: "Capabilities", label: "Item 3", type: "text" },
	"custom.capabilities.items.3": { group: "custom", section: "Capabilities", label: "Item 4", type: "text" },
	"custom.capabilities.items.4": { group: "custom", section: "Capabilities", label: "Item 5", type: "text" },
	"custom.capabilities.items.5": { group: "custom", section: "Capabilities", label: "Item 6", type: "text" },
	"custom.capabilities.title": { group: "custom", section: "Capabilities", label: "Heading", type: "text" },
	"custom.cta.title": { group: "custom", section: "Call to action", label: "Heading", type: "text" },
	"custom.cta.body": { group: "custom", section: "Call to action", label: "Text", type: "textarea" },
	"custom.cta.button": { group: "custom", section: "Call to action", label: "Button", type: "text" },
	"quality.title": { group: "quality", section: "Page", label: "Heading", type: "text" },
	"quality.intro": { group: "quality", section: "Page", label: "Intro text", type: "textarea" },
	"quality.heroCta": { group: "quality", section: "Page", label: "Hero cta", type: "text" },
	"quality.meaning.cards.0.title": { group: "quality", section: "What quality means", label: "Card 1 heading", type: "text" },
	"quality.meaning.cards.0.body": { group: "quality", section: "What quality means", label: "Card 1 text", type: "textarea" },
	"quality.meaning.cards.0.icon": { group: "quality", section: "What quality means", label: "Card 1 icon", type: "image" },
	"quality.meaning.cards.1.title": { group: "quality", section: "What quality means", label: "Card 2 heading", type: "text" },
	"quality.meaning.cards.1.body": { group: "quality", section: "What quality means", label: "Card 2 text", type: "textarea" },
	"quality.meaning.cards.1.icon": { group: "quality", section: "What quality means", label: "Card 2 icon", type: "image" },
	"quality.meaning.cards.2.title": { group: "quality", section: "What quality means", label: "Card 3 heading", type: "text" },
	"quality.meaning.cards.2.body": { group: "quality", section: "What quality means", label: "Card 3 text", type: "textarea" },
	"quality.meaning.cards.2.icon": { group: "quality", section: "What quality means", label: "Card 3 icon", type: "image" },
	"quality.meaning.title": { group: "quality", section: "What quality means", label: "Heading", type: "text" },
	"quality.process.steps.0.title": { group: "quality", section: "Process", label: "Step 1 heading", type: "text" },
	"quality.process.steps.0.body": { group: "quality", section: "Process", label: "Step 1 text", type: "textarea" },
	"quality.process.steps.1.title": { group: "quality", section: "Process", label: "Step 2 heading", type: "text" },
	"quality.process.steps.1.body": { group: "quality", section: "Process", label: "Step 2 text", type: "textarea" },
	"quality.process.steps.2.title": { group: "quality", section: "Process", label: "Step 3 heading", type: "text" },
	"quality.process.steps.2.body": { group: "quality", section: "Process", label: "Step 3 text", type: "textarea" },
	"quality.process.steps.3.title": { group: "quality", section: "Process", label: "Step 4 heading", type: "text" },
	"quality.process.steps.3.body": { group: "quality", section: "Process", label: "Step 4 text", type: "textarea" },
	"quality.process.title": { group: "quality", section: "Process", label: "Heading", type: "text" },
	"quality.process.image": { group: "quality", section: "Process", label: "Picture", type: "image" },
	"quality.process.cta": { group: "quality", section: "Process", label: "Button", type: "text" },
	"quality.promise.title": { group: "quality", section: "Promise", label: "Heading", type: "text" },
	"quality.promise.body": { group: "quality", section: "Promise", label: "Text", type: "textarea" },
	"quality.promise.image": { group: "quality", section: "Promise", label: "Picture", type: "image" },
	"quality.promise.cta": { group: "quality", section: "Promise", label: "Button", type: "text" },
	"dealers.cards.0": { group: "dealers", section: "Page", label: "Card 1", type: "text" },
	"dealers.cards.1": { group: "dealers", section: "Page", label: "Card 2", type: "text" },
	"dealers.cards.2": { group: "dealers", section: "Page", label: "Card 3", type: "text" },
	"dealers.cards.3": { group: "dealers", section: "Page", label: "Card 4", type: "text" },
	"dealers.title": { group: "dealers", section: "Page", label: "Heading", type: "text" },
	"dealers.intro": { group: "dealers", section: "Page", label: "Intro text", type: "textarea" },
	"dealers.cta": { group: "dealers", section: "Page", label: "Button", type: "text" },
	"dealers.cardImages.0": { group: "dealers", section: "Cards", label: "Card 1", type: "image" },
	"dealers.cardImages.1": { group: "dealers", section: "Cards", label: "Card 2", type: "image" },
	"dealers.cardImages.2": { group: "dealers", section: "Cards", label: "Card 3", type: "image" },
	"dealers.cardImages.3": { group: "dealers", section: "Cards", label: "Card 4", type: "image" },
	"faq.title": { group: "faq", section: "Page", label: "Heading", type: "text" },
	"faq.intro": { group: "faq", section: "Page", label: "Intro text", type: "textarea" },
	"faq.groups.0.title": { group: "faq", section: "Questions", label: "Group 1 heading", type: "text" },
	"faq.groups.0.items": { group: "faq", section: "Questions", label: "Group 1 questions", type: "list", fields: [{ name: "q", label: "Question", type: "text" }, { name: "a", label: "Answer", type: "textarea" }] },
	"faq.groups.1.title": { group: "faq", section: "Questions", label: "Group 2 heading", type: "text" },
	"faq.groups.1.items": { group: "faq", section: "Questions", label: "Group 2 questions", type: "list", fields: [{ name: "q", label: "Question", type: "text" }, { name: "a", label: "Answer", type: "textarea" }] },
	"faq.groups.2.title": { group: "faq", section: "Questions", label: "Group 3 heading", type: "text" },
	"faq.groups.2.items": { group: "faq", section: "Questions", label: "Group 3 questions", type: "list", fields: [{ name: "q", label: "Question", type: "text" }, { name: "a", label: "Answer", type: "textarea" }] },
	"contact.title": { group: "contact", section: "Page", label: "Heading", type: "text" },
	"contact.intro": { group: "contact", section: "Page", label: "Intro text", type: "textarea" },
	"contact.addressLabel": { group: "contact", section: "Page", label: "Address label", type: "text" },
	"contact.emailLabel": { group: "contact", section: "Page", label: "Email label", type: "text" },
	"contact.error": { group: "contact", section: "Page", label: "Error", type: "text" },
	"contact.formHeading": { group: "contact", section: "Page", label: "Form heading", type: "text" },
	"contact.formSubtitle": { group: "contact", section: "Page", label: "Form subtitle", type: "text" },
	"contact.phoneLabel": { group: "contact", section: "Page", label: "Phone label", type: "text" },
	"contact.sending": { group: "contact", section: "Page", label: "Sending", type: "text" },
	"contact.submit": { group: "contact", section: "Page", label: "Submit", type: "text" },
	"contact.success": { group: "contact", section: "Page", label: "Success", type: "text" },
	"contact.fields.company": { group: "contact", section: "Form fields", label: "Company", type: "text" },
	"contact.fields.email": { group: "contact", section: "Form fields", label: "Email", type: "text" },
	"contact.fields.message": { group: "contact", section: "Form fields", label: "Message", type: "text" },
	"contact.fields.name": { group: "contact", section: "Form fields", label: "Name", type: "text" },
	"contact.fields.phone": { group: "contact", section: "Form fields", label: "Phone", type: "text" },
	"contact.fields.subject": { group: "contact", section: "Form fields", label: "Subject", type: "text" },
	"payment.times.title": { group: "payment", section: "Page", label: "Heading", type: "text" },
	"payment.title": { group: "payment", section: "Page", label: "Heading", type: "text" },
	"payment.times.custom": { group: "payment", section: "Page", label: "Times custom", type: "textarea" },
	"payment.times.standard": { group: "payment", section: "Page", label: "Times standard", type: "textarea" },
	"payment.shipping.title": { group: "payment", section: "Shipping", label: "Heading", type: "text" },
	"payment.shipping.intro": { group: "payment", section: "Shipping", label: "Intro text", type: "text" },
	"payment.shipping.abroad": { group: "payment", section: "Shipping", label: "Abroad", type: "textarea" },
	"payment.shipping.abroadLabel": { group: "payment", section: "Shipping", label: "Abroad label", type: "text" },
	"payment.shipping.carriers": { group: "payment", section: "Shipping", label: "Carriers", type: "textarea" },
	"payment.shipping.countries": { group: "payment", section: "Shipping", label: "Countries", type: "textarea" },
	"payment.shipping.domestic": { group: "payment", section: "Shipping", label: "Domestic", type: "textarea" },
	"payment.shipping.domesticLabel": { group: "payment", section: "Shipping", label: "Domestic label", type: "text" },
	"payment.shipping.islands": { group: "payment", section: "Shipping", label: "Islands", type: "text" },
	"payment.terms.methods.0": { group: "payment", section: "Terms", label: "Methods 1", type: "text" },
	"payment.terms.methods.1": { group: "payment", section: "Terms", label: "Methods 2", type: "text" },
	"payment.terms.title": { group: "payment", section: "Terms", label: "Heading", type: "text" },
	"payment.terms.contact": { group: "payment", section: "Terms", label: "Contact", type: "text" },
	"payment.terms.detailsTitle": { group: "payment", section: "Terms", label: "Details title", type: "text" },
	"payment.terms.due": { group: "payment", section: "Terms", label: "Due", type: "textarea" },
	"payment.terms.invoice": { group: "payment", section: "Terms", label: "Invoice", type: "textarea" },
	"payment.terms.methodsTitle": { group: "payment", section: "Terms", label: "Methods title", type: "text" },
	"site.title": { group: "shell", section: "Site", label: "Heading", type: "text" },
	"site.description": { group: "shell", section: "Site", label: "Description", type: "text" },
	"home.topBar": { group: "shell", section: "Top bar", label: "Top bar", type: "text" },
	"nav.account": { group: "shell", section: "Menu", label: "Account", type: "text" },
	"nav.cart": { group: "shell", section: "Menu", label: "Cart", type: "text" },
	"nav.checkout": { group: "shell", section: "Menu", label: "Checkout", type: "text" },
	"nav.contact": { group: "shell", section: "Menu", label: "Contact", type: "text" },
	"nav.dealerRegistration": { group: "shell", section: "Menu", label: "Dealer registration", type: "text" },
	"nav.home": { group: "shell", section: "Menu", label: "Home", type: "text" },
	"nav.language": { group: "shell", section: "Menu", label: "Language", type: "text" },
	"nav.login": { group: "shell", section: "Menu", label: "Login", type: "text" },
	"nav.logout": { group: "shell", section: "Menu", label: "Logout", type: "text" },
	"nav.products": { group: "shell", section: "Menu", label: "Products", type: "text" },
	"nav.quoteBasket": { group: "shell", section: "Menu", label: "Quote basket", type: "text" },
	"nav.register": { group: "shell", section: "Menu", label: "Register", type: "text" },
	"nav.wishlist": { group: "shell", section: "Menu", label: "Wishlist", type: "text" },
	"home.footer.about": { group: "shell", section: "Footer", label: "About", type: "textarea" },
	"home.footer.contactHeading": { group: "shell", section: "Footer", label: "Contact heading", type: "text" },
	"home.footer.copyright": { group: "shell", section: "Footer", label: "Copyright", type: "text", vars: ["year"] },
	"home.footer.designedBy": { group: "shell", section: "Footer", label: "Designed by", type: "text" },
	"home.footer.legal": { group: "shell", section: "Footer", label: "Legal", type: "text" },
	"home.footer.quicklinks": { group: "shell", section: "Footer", label: "Quicklinks", type: "text" },
	"auth.signInSubtitle": { group: "auth", section: "Sign in", label: "Sign in subtitle", type: "textarea" },
	"auth.createAccountSubtitle": { group: "auth", section: "Register", label: "Create account subtitle", type: "textarea" },
	"auth.dealerPrompt": { group: "auth", section: "Register", label: "Dealer prompt", type: "textarea" },
	"auth.dealerSubmittedBody": { group: "auth", section: "Dealer application", label: "Dealer submitted body", type: "textarea" },
	"auth.dealerSubtitle": { group: "auth", section: "Dealer application", label: "Dealer subtitle", type: "textarea" },
	"auth.pendingBody": { group: "auth", section: "Dealer application", label: "Pending body", type: "textarea" },
	"auth.rejectedBody": { group: "auth", section: "Dealer application", label: "Rejected body", type: "textarea" },
	"auth.forgotPasswordSubtitle": { group: "auth", section: "Password", label: "Forgot password subtitle", type: "textarea" },
	"auth.resetPasswordSubtitle": { group: "auth", section: "Password", label: "Reset password subtitle", type: "textarea" },
	"shop.optionProductBody": { group: "product", section: "Options", label: "Option product body", type: "textarea" },
	"shop.optionsIntro": { group: "product", section: "Options", label: "Options intro", type: "textarea" },
	"shop.optionsTierHint": { group: "product", section: "Options", label: "Options tier hint", type: "textarea" },
}

/** Whether this key may be written at all. The API's only authority on that. */
export const isEditableKey = (key: string): boolean => key in CONTENT_REGISTRY

/** Pictures are one value for both languages; everything else is per locale. */
export const isImageKey = (key: string): boolean => CONTENT_REGISTRY[key]?.type === "image"

/** Every key in one group, in registry order — what one dashboard screen shows. */
export const keysInGroup = (group: ContentGroup): string[] =>
	Object.entries(CONTENT_REGISTRY)
		.filter(([, definition]) => definition.group === group)
		.map(([key]) => key)
