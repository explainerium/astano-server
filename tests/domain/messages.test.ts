import { describe, expect, it } from "vitest"
import de from "../../src/i18n/messages/de.json"
import en from "../../src/i18n/messages/en.json"
import { t } from "../../src/i18n"

/**
 * The catalogues are **flat**: the key is the literal string
 * `"staff.orderArtwork.subject"`, not a path into nested objects. `t()` does
 * `catalogs[locale][key]`, and its fallback for a miss is to return the key
 * itself — so a nested block does not fail, it quietly ships
 * "staff.orderArtwork.subject" as the subject line of a real email.
 *
 * That is a mistake worth one test rather than one incident.
 */

/**
 * Widened once, here.
 *
 * A JSON import is typed as an object literal with one property per key, so
 * indexing it with a plain `string` is an implicit `any` — TS7053. Whether that
 * is reported depends on the compiler: the one this repo uses lets it pass, and
 * the one Vercel's builder falls back to does not, so it surfaced as a failed
 * deployment rather than a failed typecheck. Two names either way, and now both
 * compilers agree.
 */
const EN: Record<string, string> = en
const DE: Record<string, string> = de

const catalogues: Record<string, Record<string, unknown>> = { en: EN, de: DE }

describe("message catalogues", () => {
	for (const [locale, catalogue] of Object.entries(catalogues)) {
		it(`${locale} is flat — every value is a string, never a nested block`, () => {
			const nested = Object.entries(catalogue)
				.filter(([, value]) => typeof value !== "string")
				.map(([key]) => key)

			expect(nested).toEqual([])
		})
	}

	it("the two catalogues carry exactly the same keys", () => {
		const enKeys = Object.keys(EN).sort()
		const deKeys = Object.keys(DE).sort()

		expect(deKeys.filter((k) => !enKeys.includes(k))).toEqual([])
		expect(enKeys.filter((k) => !deKeys.includes(k))).toEqual([])
	})

	it("resolves a key rather than handing back the key", () => {
		// The shape of the bug this file guards: a lookup that misses returns the
		// key, which reads as a translation until somebody looks at it.
		for (const key of Object.keys(EN)) {
			expect(t(key, "en"), key).not.toBe(key)
			expect(t(key, "de"), key).not.toBe(key)
		}
	})

	it("leaves no placeholder unfilled that the other language fills", () => {
		// A German subject interpolating {number} while the English one does not
		// means one of the two was edited without the other.
		const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

		for (const key of Object.keys(EN)) {
			expect(placeholders(DE[key] ?? ""), key).toEqual(placeholders(EN[key] ?? ""))
		}
	})
})
