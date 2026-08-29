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
 * however it reaches the API. That is the whole of what keeps the 1,664 admin
 * and storefront-chrome strings — every button label, every validation message
 * — out of reach while the 198 marketing ones are in it.
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
	 * Exactly one of the 198 carries any — the rest are plain sentences — so
	 * this is a guard on a single known case and not a general templating
	 * system. Anything listed must still appear in the value that is saved.
	 */
	vars?: string[]
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
	{ id: "about", title: "About us", blurb: "Über uns — the story, the photographs and the value cards." },
	{ id: "custom", title: "Custom manufacture", blurb: "Sonderanfertigung — how it works and why." },
	{ id: "quality", title: "Quality", blurb: "Qualität — what it means here, and the process behind it." },
	{ id: "dealers", title: "Dealers", blurb: "Händler — what a trade account is worth." },
	{ id: "faq", title: "FAQs", blurb: "The questions and their answers." },
	{ id: "contact", title: "Contact", blurb: "Kontakt — the page and its form labels." },
	{ id: "payment", title: "Payment & shipping", blurb: "Zahlung & Versand — terms, methods and delivery." },
	{ id: "shell", title: "Header & footer", blurb: "The menu and the footer, on every page." },
]

/**
 * Lists the shop may lengthen or shorten, by the prefix their entries share.
 *
 * Only the FAQ to begin with, and deliberately: a fixed number of questions is
 * the one place where "edit what is there" is plainly not enough — a shop
 * always has a tenth question. The hero slides and the various card rows are
 * fixed for now; adding them later is this constant plus a screen, not a
 * different design.
 *
 * `fields` are the leaf names one item carries, in the order they are shown.
 */
export const CONTENT_LISTS: { prefix: string; fields: string[]; label: string }[] = [
	{ prefix: "faq.groups.0.items", fields: ["q", "a"], label: "Questions — group 1" },
	{ prefix: "faq.groups.1.items", fields: ["q", "a"], label: "Questions — group 2" },
	{ prefix: "faq.groups.2.items", fields: ["q", "a"], label: "Questions — group 3" },
]

export const CONTENT_REGISTRY: Record<string, ContentDefinition> = {
	"home.tiles.0.body": { group: "home", section: "Banner tiles", label: "Tile 1 — body", type: "text" },
	"home.tiles.0.image": { group: "home", section: "Banner tiles", label: "Tile 1 — picture", type: "image" },
	"home.tiles.0.title": { group: "home", section: "Banner tiles", label: "Tile 1 — title", type: "text" },
	"home.tiles.1.body": { group: "home", section: "Banner tiles", label: "Tile 2 — body", type: "text" },
	"home.tiles.1.image": { group: "home", section: "Banner tiles", label: "Tile 2 — picture", type: "image" },
	"home.tiles.1.title": { group: "home", section: "Banner tiles", label: "Tile 2 — title", type: "text" },
	"home.tiles.2.body": { group: "home", section: "Banner tiles", label: "Tile 3 — body", type: "text" },
	"home.tiles.2.image": { group: "home", section: "Banner tiles", label: "Tile 3 — picture", type: "image" },
	"home.tiles.2.title": { group: "home", section: "Banner tiles", label: "Tile 3 — title", type: "text" },
	"home.tiles.3.body": { group: "home", section: "Banner tiles", label: "Tile 4 — body", type: "text" },
	"home.tiles.3.image": { group: "home", section: "Banner tiles", label: "Tile 4 — picture", type: "image" },
	"home.tiles.3.title": { group: "home", section: "Banner tiles", label: "Tile 4 — title", type: "text" },
	"home.categories.heading": { group: "home", section: "Categories strip", label: "Categories heading", type: "text" },
	"home.custom.cards.0.body": { group: "home", section: "Custom manufacture strip", label: "Card 1 — body", type: "textarea" },
	"home.custom.cards.0.icon": { group: "home", section: "Custom manufacture strip", label: "Card 1 — icon", type: "image" },
	"home.custom.cards.0.title": { group: "home", section: "Custom manufacture strip", label: "Card 1 — title", type: "text" },
	"home.custom.cards.1.body": { group: "home", section: "Custom manufacture strip", label: "Card 2 — body", type: "textarea" },
	"home.custom.cards.1.icon": { group: "home", section: "Custom manufacture strip", label: "Card 2 — icon", type: "image" },
	"home.custom.cards.1.title": { group: "home", section: "Custom manufacture strip", label: "Card 2 — title", type: "text" },
	"home.custom.cards.2.body": { group: "home", section: "Custom manufacture strip", label: "Card 3 — body", type: "textarea" },
	"home.custom.cards.2.icon": { group: "home", section: "Custom manufacture strip", label: "Card 3 — icon", type: "image" },
	"home.custom.cards.2.title": { group: "home", section: "Custom manufacture strip", label: "Card 3 — title", type: "text" },
	"home.custom.cards.3.body": { group: "home", section: "Custom manufacture strip", label: "Card 4 — body", type: "textarea" },
	"home.custom.cards.3.icon": { group: "home", section: "Custom manufacture strip", label: "Card 4 — icon", type: "image" },
	"home.custom.cards.3.title": { group: "home", section: "Custom manufacture strip", label: "Card 4 — title", type: "text" },
	"home.custom.heading": { group: "home", section: "Custom manufacture strip", label: "Custom heading", type: "text" },
	"home.custom.intro": { group: "home", section: "Custom manufacture strip", label: "Custom intro", type: "textarea" },
	"home.footer.about": { group: "shell", section: "Footer", label: "Footer about", type: "textarea" },
	"home.footer.contactHeading": { group: "shell", section: "Footer", label: "Footer contact heading", type: "text" },
	"home.footer.copyright": { group: "shell", section: "Footer", label: "Footer copyright", type: "text", vars: ["year"] },
	"home.footer.designedBy": { group: "shell", section: "Footer", label: "Footer designed by", type: "text" },
	"home.footer.legal": { group: "shell", section: "Footer", label: "Footer legal", type: "text" },
	"home.footer.quicklinks": { group: "shell", section: "Footer", label: "Footer quicklinks", type: "text" },
	"home.hero.cta": { group: "home", section: "Hero carousel", label: "Hero cta", type: "text" },
	"home.hero.slides.0.body": { group: "home", section: "Hero carousel", label: "Slide 1 — body", type: "textarea" },
	"home.hero.slides.0.image": { group: "home", section: "Hero carousel", label: "Slide 1 — picture", type: "image" },
	"home.hero.slides.0.title": { group: "home", section: "Hero carousel", label: "Slide 1 — title", type: "text" },
	"home.hero.slides.1.body": { group: "home", section: "Hero carousel", label: "Slide 2 — body", type: "textarea" },
	"home.hero.slides.1.image": { group: "home", section: "Hero carousel", label: "Slide 2 — picture", type: "image" },
	"home.hero.slides.1.title": { group: "home", section: "Hero carousel", label: "Slide 2 — title", type: "text" },
	"home.hero.slides.2.body": { group: "home", section: "Hero carousel", label: "Slide 3 — body", type: "textarea" },
	"home.hero.slides.2.image": { group: "home", section: "Hero carousel", label: "Slide 3 — picture", type: "image" },
	"home.hero.slides.2.title": { group: "home", section: "Hero carousel", label: "Slide 3 — title", type: "text" },
	"home.newsletter.email": { group: "home", section: "Newsletter", label: "Newsletter email", type: "text" },
	"home.newsletter.heading": { group: "home", section: "Newsletter", label: "Newsletter heading", type: "text" },
	"home.newsletter.note": { group: "home", section: "Newsletter", label: "Newsletter note", type: "text" },
	"home.newsletter.placeholder": { group: "home", section: "Newsletter", label: "Newsletter placeholder", type: "text" },
	"home.newsletter.submit": { group: "home", section: "Newsletter", label: "Newsletter submit", type: "text" },
	"home.popular.cta": { group: "home", section: "Popular products", label: "Popular cta", type: "text" },
	"home.popular.empty": { group: "home", section: "Popular products", label: "Popular empty", type: "text" },
	"home.popular.heading": { group: "home", section: "Popular products", label: "Popular heading", type: "text" },
	"home.topBar": { group: "shell", section: "Top bar", label: "Top bar", type: "text" },
	"about.craft.body": { group: "about", section: "Craft", label: "Craft body", type: "textarea" },
	"about.craft.images.0": { group: "about", section: "Craft", label: "Photograph 1", type: "image" },
	"about.craft.images.1": { group: "about", section: "Craft", label: "Photograph 2", type: "image" },
	"about.craft.title": { group: "about", section: "Craft", label: "Craft title", type: "text" },
	"about.heroCta": { group: "about", section: "Page", label: "Hero cta", type: "text" },
	"about.intro": { group: "about", section: "Page", label: "Intro", type: "textarea" },
	"about.title": { group: "about", section: "Page", label: "Title", type: "text" },
	"about.practical.body": { group: "about", section: "Practical", label: "Practical body", type: "textarea" },
	"about.practical.cta": { group: "about", section: "Practical", label: "Practical cta", type: "text" },
	"about.practical.title": { group: "about", section: "Practical", label: "Practical title", type: "text" },
	"about.quality.body": { group: "about", section: "Quality", label: "Quality body", type: "textarea" },
	"about.quality.cta": { group: "about", section: "Quality", label: "Quality cta", type: "text" },
	"about.quality.image": { group: "about", section: "Quality", label: "Photograph", type: "image" },
	"about.quality.title": { group: "about", section: "Quality", label: "Quality title", type: "text" },
	"about.cards.0.body": { group: "about", section: "Value cards", label: "Card 1 — body", type: "textarea" },
	"about.cards.0.icon": { group: "about", section: "Value cards", label: "Card 1 — icon", type: "image" },
	"about.cards.0.title": { group: "about", section: "Value cards", label: "Card 1 — title", type: "text" },
	"about.cards.1.body": { group: "about", section: "Value cards", label: "Card 2 — body", type: "textarea" },
	"about.cards.1.icon": { group: "about", section: "Value cards", label: "Card 2 — icon", type: "image" },
	"about.cards.1.title": { group: "about", section: "Value cards", label: "Card 2 — title", type: "text" },
	"about.cards.2.body": { group: "about", section: "Value cards", label: "Card 3 — body", type: "textarea" },
	"about.cards.2.icon": { group: "about", section: "Value cards", label: "Card 3 — icon", type: "image" },
	"about.cards.2.title": { group: "about", section: "Value cards", label: "Card 3 — title", type: "text" },
	"about.cards.3.body": { group: "about", section: "Value cards", label: "Card 4 — body", type: "textarea" },
	"about.cards.3.icon": { group: "about", section: "Value cards", label: "Card 4 — icon", type: "image" },
	"about.cards.3.title": { group: "about", section: "Value cards", label: "Card 4 — title", type: "text" },
	"custom.cta.body": { group: "custom", section: "Call to action", label: "Cta body", type: "textarea" },
	"custom.cta.button": { group: "custom", section: "Call to action", label: "Cta button", type: "text" },
	"custom.cta.title": { group: "custom", section: "Call to action", label: "Cta title", type: "text" },
	"custom.capabilities.items.0": { group: "custom", section: "Capabilities", label: "Item 1", type: "text" },
	"custom.capabilities.items.1": { group: "custom", section: "Capabilities", label: "Item 2", type: "text" },
	"custom.capabilities.items.2": { group: "custom", section: "Capabilities", label: "Item 3", type: "text" },
	"custom.capabilities.items.3": { group: "custom", section: "Capabilities", label: "Item 4", type: "text" },
	"custom.capabilities.items.4": { group: "custom", section: "Capabilities", label: "Item 5", type: "text" },
	"custom.capabilities.items.5": { group: "custom", section: "Capabilities", label: "Item 6", type: "text" },
	"custom.capabilities.title": { group: "custom", section: "Capabilities", label: "Capabilities title", type: "text" },
	"custom.how.steps.0.body": { group: "custom", section: "How it works", label: "Step 1 — body", type: "textarea" },
	"custom.how.steps.0.title": { group: "custom", section: "How it works", label: "Step 1 — title", type: "text" },
	"custom.how.steps.1.body": { group: "custom", section: "How it works", label: "Step 2 — body", type: "text" },
	"custom.how.steps.1.title": { group: "custom", section: "How it works", label: "Step 2 — title", type: "text" },
	"custom.how.steps.2.body": { group: "custom", section: "How it works", label: "Step 3 — body", type: "textarea" },
	"custom.how.steps.2.title": { group: "custom", section: "How it works", label: "Step 3 — title", type: "text" },
	"custom.how.steps.3.body": { group: "custom", section: "How it works", label: "Step 4 — body", type: "textarea" },
	"custom.how.steps.3.title": { group: "custom", section: "How it works", label: "Step 4 — title", type: "text" },
	"custom.how.title": { group: "custom", section: "How it works", label: "How title", type: "text" },
	"custom.lead.body": { group: "custom", section: "Lead", label: "Lead body", type: "textarea" },
	"custom.lead.images.0": { group: "custom", section: "Lead", label: "Photograph 1", type: "image" },
	"custom.lead.images.1": { group: "custom", section: "Lead", label: "Photograph 2", type: "image" },
	"custom.lead.title": { group: "custom", section: "Lead", label: "Lead title", type: "text" },
	"custom.intro": { group: "custom", section: "Page", label: "Intro", type: "textarea" },
	"custom.title": { group: "custom", section: "Page", label: "Title", type: "text" },
	"custom.why.cards.0.body": { group: "custom", section: "Why it works", label: "Card 1 — body", type: "textarea" },
	"custom.why.cards.0.icon": { group: "custom", section: "Why it works", label: "Card 1 — icon", type: "image" },
	"custom.why.cards.0.title": { group: "custom", section: "Why it works", label: "Card 1 — title", type: "text" },
	"custom.why.cards.1.body": { group: "custom", section: "Why it works", label: "Card 2 — body", type: "textarea" },
	"custom.why.cards.1.icon": { group: "custom", section: "Why it works", label: "Card 2 — icon", type: "image" },
	"custom.why.cards.1.title": { group: "custom", section: "Why it works", label: "Card 2 — title", type: "text" },
	"custom.why.cards.2.body": { group: "custom", section: "Why it works", label: "Card 3 — body", type: "textarea" },
	"custom.why.cards.2.icon": { group: "custom", section: "Why it works", label: "Card 3 — icon", type: "image" },
	"custom.why.cards.2.title": { group: "custom", section: "Why it works", label: "Card 3 — title", type: "text" },
	"custom.why.cards.3.body": { group: "custom", section: "Why it works", label: "Card 4 — body", type: "textarea" },
	"custom.why.cards.3.icon": { group: "custom", section: "Why it works", label: "Card 4 — icon", type: "image" },
	"custom.why.cards.3.title": { group: "custom", section: "Why it works", label: "Card 4 — title", type: "text" },
	"custom.why.title": { group: "custom", section: "Why it works", label: "Why title", type: "text" },
	"quality.heroCta": { group: "quality", section: "Page", label: "Hero cta", type: "text" },
	"quality.intro": { group: "quality", section: "Page", label: "Intro", type: "textarea" },
	"quality.title": { group: "quality", section: "Page", label: "Title", type: "text" },
	"quality.process.cta": { group: "quality", section: "Process", label: "Process cta", type: "text" },
	"quality.process.image": { group: "quality", section: "Process", label: "Photograph", type: "image" },
	"quality.process.steps.0.body": { group: "quality", section: "Process", label: "Step 1 — body", type: "textarea" },
	"quality.process.steps.0.title": { group: "quality", section: "Process", label: "Step 1 — title", type: "text" },
	"quality.process.steps.1.body": { group: "quality", section: "Process", label: "Step 2 — body", type: "textarea" },
	"quality.process.steps.1.title": { group: "quality", section: "Process", label: "Step 2 — title", type: "text" },
	"quality.process.steps.2.body": { group: "quality", section: "Process", label: "Step 3 — body", type: "textarea" },
	"quality.process.steps.2.title": { group: "quality", section: "Process", label: "Step 3 — title", type: "text" },
	"quality.process.steps.3.body": { group: "quality", section: "Process", label: "Step 4 — body", type: "textarea" },
	"quality.process.steps.3.title": { group: "quality", section: "Process", label: "Step 4 — title", type: "text" },
	"quality.process.title": { group: "quality", section: "Process", label: "Process title", type: "text" },
	"quality.promise.body": { group: "quality", section: "Promise", label: "Promise body", type: "textarea" },
	"quality.promise.cta": { group: "quality", section: "Promise", label: "Promise cta", type: "text" },
	"quality.promise.image": { group: "quality", section: "Promise", label: "Photograph", type: "image" },
	"quality.promise.title": { group: "quality", section: "Promise", label: "Promise title", type: "text" },
	"quality.meaning.cards.0.body": { group: "quality", section: "What quality means", label: "Card 1 — body", type: "textarea" },
	"quality.meaning.cards.0.icon": { group: "quality", section: "What quality means", label: "Card 1 — icon", type: "image" },
	"quality.meaning.cards.0.title": { group: "quality", section: "What quality means", label: "Card 1 — title", type: "text" },
	"quality.meaning.cards.1.body": { group: "quality", section: "What quality means", label: "Card 2 — body", type: "textarea" },
	"quality.meaning.cards.1.icon": { group: "quality", section: "What quality means", label: "Card 2 — icon", type: "image" },
	"quality.meaning.cards.1.title": { group: "quality", section: "What quality means", label: "Card 2 — title", type: "text" },
	"quality.meaning.cards.2.body": { group: "quality", section: "What quality means", label: "Card 3 — body", type: "textarea" },
	"quality.meaning.cards.2.icon": { group: "quality", section: "What quality means", label: "Card 3 — icon", type: "image" },
	"quality.meaning.cards.2.title": { group: "quality", section: "What quality means", label: "Card 3 — title", type: "text" },
	"quality.meaning.title": { group: "quality", section: "What quality means", label: "Meaning title", type: "text" },
	"dealers.cardImages.0": { group: "dealers", section: "Cards", label: "Card 1 — picture", type: "image" },
	"dealers.cardImages.1": { group: "dealers", section: "Cards", label: "Card 2 — picture", type: "image" },
	"dealers.cardImages.2": { group: "dealers", section: "Cards", label: "Card 3 — picture", type: "image" },
	"dealers.cardImages.3": { group: "dealers", section: "Cards", label: "Card 4 — picture", type: "image" },
	"dealers.cards.0": { group: "dealers", section: "Page", label: "Card 1", type: "text" },
	"dealers.cards.1": { group: "dealers", section: "Page", label: "Card 2", type: "text" },
	"dealers.cards.2": { group: "dealers", section: "Page", label: "Card 3", type: "text" },
	"dealers.cards.3": { group: "dealers", section: "Page", label: "Card 4", type: "text" },
	"dealers.cta": { group: "dealers", section: "Page", label: "Cta", type: "text" },
	"dealers.intro": { group: "dealers", section: "Page", label: "Intro", type: "textarea" },
	"dealers.title": { group: "dealers", section: "Page", label: "Title", type: "text" },
	"faq.intro": { group: "faq", section: "Page", label: "Intro", type: "textarea" },
	"faq.title": { group: "faq", section: "Page", label: "Title", type: "text" },
	"faq.groups.0.items.0.a": { group: "faq", section: "Questions", label: "Group 1 · Item 1 — answer", type: "textarea" },
	"faq.groups.0.items.0.q": { group: "faq", section: "Questions", label: "Group 1 · Item 1 — question", type: "text" },
	"faq.groups.0.items.1.a": { group: "faq", section: "Questions", label: "Group 1 · Item 2 — answer", type: "textarea" },
	"faq.groups.0.items.1.q": { group: "faq", section: "Questions", label: "Group 1 · Item 2 — question", type: "text" },
	"faq.groups.0.items.2.a": { group: "faq", section: "Questions", label: "Group 1 · Item 3 — answer", type: "textarea" },
	"faq.groups.0.items.2.q": { group: "faq", section: "Questions", label: "Group 1 · Item 3 — question", type: "text" },
	"faq.groups.0.title": { group: "faq", section: "Questions", label: "Group 1 — title", type: "text" },
	"faq.groups.1.items.0.a": { group: "faq", section: "Questions", label: "Group 2 · Item 1 — answer", type: "textarea" },
	"faq.groups.1.items.0.q": { group: "faq", section: "Questions", label: "Group 2 · Item 1 — question", type: "text" },
	"faq.groups.1.items.1.a": { group: "faq", section: "Questions", label: "Group 2 · Item 2 — answer", type: "textarea" },
	"faq.groups.1.items.1.q": { group: "faq", section: "Questions", label: "Group 2 · Item 2 — question", type: "text" },
	"faq.groups.1.items.2.a": { group: "faq", section: "Questions", label: "Group 2 · Item 3 — answer", type: "text" },
	"faq.groups.1.items.2.q": { group: "faq", section: "Questions", label: "Group 2 · Item 3 — question", type: "text" },
	"faq.groups.1.title": { group: "faq", section: "Questions", label: "Group 2 — title", type: "text" },
	"faq.groups.2.items.0.a": { group: "faq", section: "Questions", label: "Group 3 · Item 1 — answer", type: "textarea" },
	"faq.groups.2.items.0.q": { group: "faq", section: "Questions", label: "Group 3 · Item 1 — question", type: "text" },
	"faq.groups.2.items.1.a": { group: "faq", section: "Questions", label: "Group 3 · Item 2 — answer", type: "textarea" },
	"faq.groups.2.items.1.q": { group: "faq", section: "Questions", label: "Group 3 · Item 2 — question", type: "text" },
	"faq.groups.2.items.2.a": { group: "faq", section: "Questions", label: "Group 3 · Item 3 — answer", type: "textarea" },
	"faq.groups.2.items.2.q": { group: "faq", section: "Questions", label: "Group 3 · Item 3 — question", type: "text" },
	"faq.groups.2.title": { group: "faq", section: "Questions", label: "Group 3 — title", type: "text" },
	"contact.fields.company": { group: "contact", section: "Form fields", label: "Fields company", type: "text" },
	"contact.fields.email": { group: "contact", section: "Form fields", label: "Fields email", type: "text" },
	"contact.fields.message": { group: "contact", section: "Form fields", label: "Fields message", type: "text" },
	"contact.fields.name": { group: "contact", section: "Form fields", label: "Fields name", type: "text" },
	"contact.fields.phone": { group: "contact", section: "Form fields", label: "Fields phone", type: "text" },
	"contact.fields.subject": { group: "contact", section: "Form fields", label: "Fields subject", type: "text" },
	"contact.addressLabel": { group: "contact", section: "Page", label: "Address label", type: "text" },
	"contact.emailLabel": { group: "contact", section: "Page", label: "Email label", type: "text" },
	"contact.error": { group: "contact", section: "Page", label: "Error", type: "text" },
	"contact.formHeading": { group: "contact", section: "Page", label: "Form heading", type: "text" },
	"contact.formSubtitle": { group: "contact", section: "Page", label: "Form subtitle", type: "text" },
	"contact.intro": { group: "contact", section: "Page", label: "Intro", type: "textarea" },
	"contact.phoneLabel": { group: "contact", section: "Page", label: "Phone label", type: "text" },
	"contact.sending": { group: "contact", section: "Page", label: "Sending", type: "text" },
	"contact.submit": { group: "contact", section: "Page", label: "Submit", type: "text" },
	"contact.success": { group: "contact", section: "Page", label: "Success", type: "text" },
	"contact.title": { group: "contact", section: "Page", label: "Title", type: "text" },
	"payment.times.custom": { group: "payment", section: "Page", label: "Times custom", type: "textarea" },
	"payment.times.standard": { group: "payment", section: "Page", label: "Times standard", type: "textarea" },
	"payment.times.title": { group: "payment", section: "Page", label: "Times title", type: "text" },
	"payment.title": { group: "payment", section: "Page", label: "Title", type: "text" },
	"payment.shipping.abroad": { group: "payment", section: "Shipping", label: "Shipping abroad", type: "textarea" },
	"payment.shipping.abroadLabel": { group: "payment", section: "Shipping", label: "Shipping abroad label", type: "text" },
	"payment.shipping.carriers": { group: "payment", section: "Shipping", label: "Shipping carriers", type: "textarea" },
	"payment.shipping.countries": { group: "payment", section: "Shipping", label: "Shipping countries", type: "textarea" },
	"payment.shipping.domestic": { group: "payment", section: "Shipping", label: "Shipping domestic", type: "textarea" },
	"payment.shipping.domesticLabel": { group: "payment", section: "Shipping", label: "Shipping domestic label", type: "text" },
	"payment.shipping.intro": { group: "payment", section: "Shipping", label: "Shipping intro", type: "text" },
	"payment.shipping.islands": { group: "payment", section: "Shipping", label: "Shipping islands", type: "text" },
	"payment.shipping.title": { group: "payment", section: "Shipping", label: "Shipping title", type: "text" },
	"payment.terms.contact": { group: "payment", section: "Terms", label: "Terms contact", type: "text" },
	"payment.terms.detailsTitle": { group: "payment", section: "Terms", label: "Terms details title", type: "text" },
	"payment.terms.due": { group: "payment", section: "Terms", label: "Terms due", type: "textarea" },
	"payment.terms.invoice": { group: "payment", section: "Terms", label: "Terms invoice", type: "textarea" },
	"payment.terms.methods.0": { group: "payment", section: "Terms", label: "Methods 1", type: "text" },
	"payment.terms.methods.1": { group: "payment", section: "Terms", label: "Methods 2", type: "text" },
	"payment.terms.methodsTitle": { group: "payment", section: "Terms", label: "Terms methods title", type: "text" },
	"payment.terms.title": { group: "payment", section: "Terms", label: "Terms title", type: "text" },
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
	"site.description": { group: "shell", section: "Site", label: "Description", type: "text" },
	"site.title": { group: "shell", section: "Site", label: "Title", type: "text" },
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
