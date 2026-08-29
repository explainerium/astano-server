import { type LocaleCode } from "../../../config/locales"
import { sanitizeRichText } from "../../../domain/html/sanitizeRichText"
import { storage } from "../../../helpers/storage"
import { prisma } from "../../../shared/prisma"
import {
	CONTENT_GROUPS,
	CONTENT_PAGES,
	CONTENT_SECTIONS,
	CONTENT_REGISTRY,
	isEditableKey,
	isEditablePage,
	isImageKey,
} from "./contentRegistry"

/**
 * What the storefront reads, for one language.
 *
 * Only overrides — a key with no row is simply absent, and the storefront falls
 * back to the string that shipped in its own message catalogue. That is the
 * whole safety property of this design: an empty table, a table that has never
 * been written to, or a database that cannot be reached all leave the site
 * reading exactly as it does today.
 *
 * Rows whose key is no longer in the registry are dropped rather than served.
 * A key removed from contentRegistry.ts stops reaching the page immediately,
 * without anybody having to remember to delete its row — and nothing is deleted
 * to achieve that, so the row is still there if the key comes back.
 */
const publicContent = async (locale: LocaleCode) => {
	const [entries, media] = await Promise.all([
		prisma.contentEntry.findMany({
			where: { locale },
			select: { key: true, value: true },
		}),
		prisma.contentMedia.findMany({
			where: { assetId: { not: null } },
			select: {
				key: true,
				asset: { select: { storageKey: true, visibility: true } },
			},
		}),
	])

	return {
		entries: Object.fromEntries(
			entries.filter((e) => isEditableKey(e.key)).map((e) => [e.key, e.value])
		),
		/**
		 * Public assets only.
		 *
		 * A private asset's URL is signed and expires, and a marketing picture
		 * that stops loading after an hour is worse than one that was never
		 * changed. Anything not public is left out, so the page keeps the image
		 * it shipped with.
		 */
		media: Object.fromEntries(
			media
				.filter((m) => isEditableKey(m.key) && m.asset?.visibility === "PUBLIC")
				.map((m) => [m.key, storage.publicUrl(m.asset!.storageKey)])
		),
	}
}

/**
 * Everything the dashboard needs to draw the editor.
 *
 * Both languages in one response, because the screen shows them side by side in
 * tabs and a per-locale fetch would make switching tabs a network round trip.
 * The registry travels with it for the same reason the settings screen sends
 * its own: the screen should render each key as the control it deserves rather
 * than guessing from the value.
 */
const adminContent = async () => {
	const [entries, media] = await Promise.all([
		prisma.contentEntry.findMany({
			select: { key: true, locale: true, value: true, updatedAt: true },
		}),
		prisma.contentMedia.findMany({
			select: {
				key: true,
				assetId: true,
				updatedAt: true,
				asset: { select: { storageKey: true, visibility: true, originalName: true } },
			},
		}),
	])

	const byLocale: Record<string, Record<string, string>> = {}
	for (const e of entries) {
		if (!isEditableKey(e.key)) continue
		const bucket = (byLocale[e.locale] ??= {})
		bucket[e.key] = e.value
	}

	return {
		entries: byLocale,
		media: Object.fromEntries(
			media
				.filter((m) => isEditableKey(m.key))
				.map((m) => [
					m.key,
					{
						assetId: m.assetId,
						name: m.asset?.originalName ?? null,
						url:
							m.asset && m.asset.visibility === "PUBLIC"
								? storage.publicUrl(m.asset.storageKey)
								: null,
					},
				])
		),
		definitions: CONTENT_REGISTRY,
		groups: CONTENT_GROUPS,
		// Where each section is on the site. The screen prints it under the
		// heading, which is what lets the field labels stay short.
		sections: CONTENT_SECTIONS,
	}
}

export interface ContentWrite {
	entries?: { key: string; locale: string; value: string }[]
	media?: { key: string; assetId: string | null }[]
}

/**
 * Save a screenful.
 *
 * One transaction, because a half-saved page is a page nobody can reason about
 * — the editor pressed Save once and either all of it took or none of it did.
 *
 * Upsert rather than insert-or-update by hand: a key is written for the first
 * time on the edit that changes it, so most of these rows do not exist yet and
 * "has this been overridden before" is not a question the caller should have to
 * answer.
 *
 * Nothing is ever deleted here. Clearing a picture writes `assetId: null`,
 * which the storefront reads as "fall back to what shipped" — the same state as
 * never having been set, without losing the record that somebody set it.
 */
const setMany = async (payload: ContentWrite, actorId?: string) => {
	const entries = payload.entries ?? []
	const media = payload.media ?? []

	// The validator has already refused anything outside the registry. This is
	// the same check at the only layer that actually writes, because a whitelist
	// that can be reached around is not one.
	for (const e of entries) {
		if (!isEditableKey(e.key) || isImageKey(e.key)) {
			throw new Error(`content: refusing to write a non-editable key (${e.key})`)
		}
	}
	for (const m of media) {
		if (!isImageKey(m.key)) {
			throw new Error(`content: refusing to write a picture to a text key (${m.key})`)
		}
	}

	await prisma.$transaction([
		...entries.map((e) =>
			prisma.contentEntry.upsert({
				where: { key_locale: { key: e.key, locale: e.locale } },
				create: { key: e.key, locale: e.locale, value: e.value, updatedById: actorId ?? null },
				update: { value: e.value, updatedById: actorId ?? null },
			})
		),
		...media.map((m) =>
			prisma.contentMedia.upsert({
				where: { key: m.key },
				create: { key: m.key, assetId: m.assetId, updatedById: actorId ?? null },
				update: { assetId: m.assetId, updatedById: actorId ?? null },
			})
		),
	])

	return { entries: entries.length, media: media.length }
}

/**
 * One long document, for one language.
 *
 * Null when the shop has never edited it, which is the normal state: the three
 * legal documents ship with the storefront and it falls back to them. Returning
 * null rather than an empty document is what lets it tell "not edited" from
 * "edited to nothing".
 *
 * Deliberately not part of `publicContent`. The German privacy policy runs to
 * about ten thousand words; putting it in the payload every page render merges
 * would make every page on the site pay for a document three of them show.
 */
const publicPage = async (slug: string, locale: LocaleCode) => {
	if (!isEditablePage(slug)) return null

	const row = await prisma.page.findUnique({
		where: { slug_locale: { slug, locale } },
		select: { title: true, bodyHtml: true, updatedAt: true },
	})

	return row ?? null
}

/** Every document in every language, for the editor. */
const adminPages = async () => {
	const rows = await prisma.page.findMany({
		select: { slug: true, locale: true, title: true, bodyHtml: true, updatedAt: true },
	})

	const byLocale: Record<string, Record<string, { title: string; bodyHtml: string }>> = {}
	for (const row of rows) {
		if (!isEditablePage(row.slug)) continue
		const bucket = (byLocale[row.locale] ??= {})
		bucket[row.slug] = { title: row.title, bodyHtml: row.bodyHtml }
	}

	return { pages: byLocale, definitions: CONTENT_PAGES }
}

export interface PageWrite {
	pages: { slug: string; locale: string; title: string; bodyHtml: string }[]
}

/**
 * Save one or more documents.
 *
 * The HTML is sanitised on the way in and not merely on the way out: this ends
 * up injected into a page with dangerouslySetInnerHTML, and the allowlist that
 * made the WordPress import safe is the same one that has to hold for anything
 * typed afterwards. An ADMIN is trusted, but a pasted document carrying a
 * script tag is not something anyone types on purpose.
 */
const setPages = async (payload: PageWrite, actorId?: string) => {
	for (const page of payload.pages) {
		if (!isEditablePage(page.slug)) {
			throw new Error(`content: refusing to write an unknown page (${page.slug})`)
		}
	}

	await prisma.$transaction(
		payload.pages.map((page) => {
			// The sanitiser answers null for "nothing survived", which for a
			// document the shop deliberately emptied is an empty one, not a
			// missing row — the column is not nullable and must not become so.
			const bodyHtml = sanitizeRichText(page.bodyHtml) ?? ""
			return prisma.page.upsert({
				where: { slug_locale: { slug: page.slug, locale: page.locale } },
				create: {
					slug: page.slug,
					locale: page.locale,
					title: page.title,
					bodyHtml,
					updatedById: actorId ?? null,
				},
				update: { title: page.title, bodyHtml, updatedById: actorId ?? null },
			})
		})
	)

	return { pages: payload.pages.length }
}

export const ContentService = {
	publicContent,
	adminContent,
	setMany,
	publicPage,
	adminPages,
	setPages,
}
