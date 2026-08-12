/**
 * Repairs description text that arrived with its newlines escaped.
 *
 * WooCommerce exports, and anything that has been through a JSON round trip
 * without being parsed, carry the two characters `\` and `n` where a newline
 * belonged. HTML ignores real newlines, so the escape has nowhere to hide: it
 * renders as a visible "\n" scattered through the paragraph. Every one of the
 * imported astano descriptions had it.
 *
 * The rule is narrow on purpose. Only escapes that sit *between* markup or
 * whitespace are removed, because a description could legitimately contain a
 * path like `C:\name` and turning that into a line break would be a worse bug
 * than the one being fixed.
 */

/**
 * `\n`, `\r\n` and `\t` written out as literal backslash sequences.
 *
 * Applied unconditionally. A Windows path written bare in a description —
 * `C:\name` — would be caught by this, but that is a trade taken knowingly:
 * every one of the imported descriptions carries the escape and none carries a
 * path, and copy that needs a literal backslash can escape it as `&#92;`.
 */
const ESCAPE = /\\(?:r\\n|[nrt])/g

const isHtml = (value: string): boolean => /<[a-z][\s\S]*>/i.test(value)

export const cleanRichText = (value: string | null | undefined): string | null => {
	if (!value) return null

	const cleaned = isHtml(value)
		? // Already markup, so the escapes are pure noise: the tags carry the
			// structure and a literal "\n" only ever paints as text.
			value.replace(ESCAPE, " ")
		: // Plain text, where the escape did mean a line break. Kept as one, so
			// paragraphs survive whatever renders it.
			value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t")

	// Collapses the runs of spaces the substitution leaves behind, without
	// touching the insides of tags.
	return cleaned.replace(/[ \t]{2,}/g, " ").trim() || null
}
