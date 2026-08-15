import sanitizeHtml from "sanitize-html"

/**
 * Reduces authored HTML to what the editor can actually produce.
 *
 * Product and category copy is stored as HTML and rendered on the storefront
 * with `dangerouslySetInnerHTML`. Two things write into those fields — the
 * admin's TipTap editor and the CSV importer — and only the first is anything
 * like trusted. A supplier's export is an outside file, and one `<img
 * onerror=…>` in a description column would run on every visitor's page.
 *
 * Applied where the value is *stored*, not where it is displayed. Sanitising on
 * render means every consumer has to remember to do it, and the one that
 * forgets is the invoice PDF or the confirmation email rather than the page
 * anybody tested.
 *
 * Not hand-rolled. Allowlist HTML parsing looks simple and is not — comments,
 * malformed nesting and mutation XSS all defeat the obvious regex version. This
 * is the one place in the codebase where a dependency beats writing our own.
 */

/**
 * Exactly what the toolbar in ProRichText can emit, and nothing else.
 *
 * Deliberately narrow: `img` and `iframe` are absent because no control
 * produces them, so their presence in a stored description means something got
 * in by another route.
 *
 * The table tags are here because the toolbar *does* have an Insert Table
 * button. Without them sanitize-html dropped each tag and kept its text, so a
 * saved size chart came back as one run of concatenated cell values — the
 * admin's work destroyed on save, with no warning and no undo.
 */
const ALLOWED_TAGS = [
	"p",
	"br",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"strike",
	"del",
	"a",
	"h1",
	"h2",
	"h3",
	"h4",
	"ul",
	"ol",
	"li",
	"blockquote",
	"hr",
	"code",
	"pre",
	"span",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"th",
	"td",
	"colgroup",
	"col",
]

const OPTIONS: sanitizeHtml.IOptions = {
	allowedTags: ALLOWED_TAGS,

	allowedAttributes: {
		// `target` and `rel` are set by the editor. They are allowed through
		// rather than re-added so an existing link is not rewritten, and
		// `enforceHtmlBoundary` below stops anything else riding along.
		a: ["href", "title", "target", "rel"],

		// Merged cells survive; column widths deliberately do not. `style` is
		// absent from every entry here, so the inline width prosemirror-tables
		// writes is stripped on the way in — which is what the editor already
		// intends by turning resizing off: a dragged pixel width fights the
		// storefront's own layout on a phone. Widths are the stylesheet's job.
		th: ["colspan", "rowspan"],
		td: ["colspan", "rowspan"],
		col: ["span"],
	},

	// The scheme allowlist. `javascript:` and `data:` are absent, which is the
	// whole point — `data:text/html` is as good as a script tag.
	allowedSchemes: ["http", "https", "mailto", "tel"],
	allowedSchemesAppliedToAttributes: ["href"],

	// A protocol-relative href would otherwise slip past the scheme check.
	allowProtocolRelative: false,

	// Anything after a stray </html> is discarded rather than parsed as content.
	enforceHtmlBoundary: true,

	// Dropped whole. The default is to keep the *text* inside a disallowed tag,
	// which for a <script> would paste its source into the page as visible copy.
	nonTextTags: ["script", "style", "textarea", "option", "noscript"],

	transformTags: {
		// Every outbound link leaves the tab intact and passes no referrer
		// credit on. Applied on the way in so imported links get it too.
		a: sanitizeHtml.simpleTransform("a", {
			rel: "noopener noreferrer nofollow",
			target: "_blank",
		}),
	},
}

export const sanitizeRichText = (value: string | null | undefined): string | null => {
	if (!value) return null

	const clean = sanitizeHtml(value, OPTIONS).trim()

	// An input that was nothing but markup — "<script>…</script>" — comes back
	// empty. Null rather than "" so it reads as "no description" everywhere,
	// the same as a field that was never filled in.
	return clean || null
}

/**
 * For values that are shown as plain text and must never carry markup at all —
 * a meta description, an email subject, an attribute label.
 */
export const stripHtml = (value: string | null | undefined): string | null => {
	if (!value) return null

	const clean = sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim()

	return clean || null
}
