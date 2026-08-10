import type { Prisma } from "@prisma/client"
import type { LocaleCode } from "../../../config/locales"
import { DEFAULT_LOCALE } from "../../../config/locales"
import { toPublicAsset, type PublicAsset } from "../../../domain/media/publicAsset"
import { copyNameFor } from "../../../shared/duplicate"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { slugify, uniqueSlug } from "../../../shared/slugify"
import ApiError from "../../errors/ApiError"

interface TranslationInput {
	locale: string
	name: string
	slug?: string
	description?: string
	metaTitle?: string
	metaDescription?: string
}

export interface CategoryView {
	id: string
	parentId: string | null
	sortOrder: number
	isHidden: boolean
	isOptionCategory: boolean
	name: string
	slug: string
	description: string | null
	/** Both optional, and both null far more often than not. */
	image: CategoryAsset | null
	icon: CategoryAsset | null
	productCount: number
	children?: CategoryView[]
}

/**
 * What staff see. Carries **every** translation rather than one resolved
 * language.
 *
 * The public view deliberately collapses a category to the requested locale,
 * which is right for a storefront and useless for an editor: you cannot edit
 * the German name of a category if the only thing the API ever returns is the
 * English one.
 */
export interface AdminCategoryView {
	id: string
	parentId: string | null
	sortOrder: number
	isHidden: boolean
	isOptionCategory: boolean
	imageAssetId: string | null
	iconAssetId: string | null
	/**
	 * Resolved alongside the id so the editor can show what is already chosen.
	 * With only an id it would have to fetch the whole media library to draw one
	 * thumbnail, or show nothing and look like the field was empty.
	 */
	image: CategoryAsset | null
	icon: CategoryAsset | null
	productCount: number
	translations: TranslationInput[]
	createdAt: Date
}

export type CategoryAsset = PublicAsset

const assetSelect = {
	select: { id: true, storageKey: true, derivatives: true, width: true, height: true },
} as const

const adminInclude = {
	translations: true,
	_count: { select: { products: true } },
	image: assetSelect,
	icon: assetSelect,
} satisfies Prisma.CategoryInclude

type CategoryForAdmin = Prisma.CategoryGetPayload<{ include: typeof adminInclude }>

const toAsset = toPublicAsset

/**
 * The storefront needs the pictures too, or an admin can set one and nothing
 * ever shows it. Same two joins as the admin include — categories are a short
 * list and this is the query that renders the menu.
 */
const publicInclude = adminInclude

type CategoryWithTranslations = CategoryForAdmin

/**
 * Picks the requested language, falling back to the default locale and then to
 * whatever exists. A category with no translation in the current language must
 * still render — an empty name would be worse than a German one.
 */
const view = (row: CategoryWithTranslations, locale: LocaleCode): CategoryView => {
	const t =
		row.translations.find((x) => x.locale === locale) ??
		row.translations.find((x) => x.locale === DEFAULT_LOCALE) ??
		row.translations[0]

	return {
		id: row.id,
		parentId: row.parentId,
		sortOrder: row.sortOrder,
		isHidden: row.isHidden,
		isOptionCategory: row.isOptionCategory,
		name: t?.name ?? "(untitled)",
		slug: t?.slug ?? row.id,
		description: t?.description ?? null,
		image: toAsset(row.image),
		icon: toAsset(row.icon),
		productCount: row._count.products,
	}
}

const buildTree = (flat: CategoryView[]): CategoryView[] => {
	const byId = new Map(flat.map((c) => [c.id, { ...c, children: [] as CategoryView[] }]))
	const roots: CategoryView[] = []

	for (const node of byId.values()) {
		const parent = node.parentId ? byId.get(node.parentId) : undefined
		if (parent) parent.children!.push(node)
		else roots.push(node)
	}

	const sort = (nodes: CategoryView[]): CategoryView[] => {
		nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
		nodes.forEach((n) => n.children?.length && sort(n.children))
		return nodes
	}

	return sort(roots)
}

const list = async (
	locale: LocaleCode,
	opts: { includeHidden: boolean; tree: boolean }
): Promise<CategoryView[]> => {
	const rows = await prisma.category.findMany({
		// R13: hidden categories vanish from every public list.
		where: opts.includeHidden ? {} : { isHidden: false },
		include: publicInclude,
		orderBy: { sortOrder: "asc" },
	})

	const flat = rows.map((r) => view(r, locale))
	return opts.tree ? buildTree(flat) : flat
}

const getBySlug = async (slug: string, locale: LocaleCode): Promise<CategoryView> => {
	const row = await prisma.category.findFirst({
		where: { translations: { some: { slug } }, isHidden: false },
		include: publicInclude,
	})

	// R13: a hidden category's URL must 404, not redirect or render empty.
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Category not found", {
			messageKey: "category.notFound",
		})
	}

	return view(row, locale)
}

const getById = async (id: string, locale: LocaleCode): Promise<CategoryView> => {
	const row = await prisma.category.findUnique({
		where: { id },
		include: publicInclude,
	})

	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Category not found", {
			messageKey: "category.notFound",
		})
	}

	return view(row, locale)
}

/** Derives a slug when one was not supplied, and guarantees uniqueness per locale. */
const resolveSlug = async (
	t: TranslationInput,
	excludeCategoryId?: string
): Promise<string> => {
	const base = t.slug ?? slugify(t.name, t.locale as LocaleCode)

	return uniqueSlug(base || "category", async (candidate) => {
		const clash = await prisma.categoryTranslation.findFirst({
			where: {
				locale: t.locale,
				slug: candidate,
				...(excludeCategoryId ? { categoryId: { not: excludeCategoryId } } : {}),
			},
			select: { id: true },
		})
		return clash !== null
	})
}

const create = async (
	payload: {
		parentId?: string | null
		sortOrder?: number
		isHidden?: boolean
		isOptionCategory?: boolean
		imageAssetId?: string | null
		iconAssetId?: string | null
		translations: TranslationInput[]
	},
	locale: LocaleCode
): Promise<CategoryView> => {
	const translations = await Promise.all(
		payload.translations.map(async (t) => ({
			locale: t.locale,
			name: t.name,
			slug: await resolveSlug(t),
			description: t.description ?? null,
			metaTitle: t.metaTitle ?? null,
			metaDescription: t.metaDescription ?? null,
		}))
	)

	const row = await prisma.category.create({
		data: {
			parentId: payload.parentId ?? null,
			sortOrder: payload.sortOrder ?? 0,
			isHidden: payload.isHidden ?? false,
			isOptionCategory: payload.isOptionCategory ?? false,
			imageAssetId: payload.imageAssetId ?? null,
			iconAssetId: payload.iconAssetId ?? null,
			translations: { create: translations },
		},
		include: publicInclude,
	})

	return view(row, locale)
}

const update = async (
	id: string,
	payload: {
		parentId?: string | null
		sortOrder?: number
		isHidden?: boolean
		isOptionCategory?: boolean
		imageAssetId?: string | null
		iconAssetId?: string | null
		translations?: TranslationInput[]
	},
	locale: LocaleCode
): Promise<CategoryView> => {
	const existing = await prisma.category.findUnique({ where: { id } })
	if (!existing) {
		throw new ApiError(httpStatus.NOT_FOUND, "Category not found", {
			messageKey: "category.notFound",
		})
	}

	// A category cannot be its own parent, and cannot be moved under one of its
	// own descendants — either would create a cycle the tree builder cannot render.
	if (payload.parentId) {
		if (payload.parentId === id) {
			throw new ApiError(httpStatus.BAD_REQUEST, "A category cannot be its own parent", {
				messageKey: "category.cycle",
			})
		}

		let cursor: string | null = payload.parentId
		while (cursor) {
			if (cursor === id) {
				throw new ApiError(httpStatus.BAD_REQUEST, "That move would create a loop", {
					messageKey: "category.cycle",
				})
			}
			const parent: { parentId: string | null } | null = await prisma.category.findUnique({
				where: { id: cursor },
				select: { parentId: true },
			})
			cursor = parent?.parentId ?? null
		}
	}

	await prisma.$transaction(async (tx) => {
		await tx.category.update({
			where: { id },
			data: {
				...(payload.parentId !== undefined ? { parentId: payload.parentId } : {}),
				...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
				...(payload.isHidden !== undefined ? { isHidden: payload.isHidden } : {}),
				...(payload.isOptionCategory !== undefined
					? { isOptionCategory: payload.isOptionCategory }
					: {}),
				...(payload.imageAssetId !== undefined ? { imageAssetId: payload.imageAssetId } : {}),
				...(payload.iconAssetId !== undefined ? { iconAssetId: payload.iconAssetId } : {}),
			},
		})

		for (const t of payload.translations ?? []) {
			const slug = await resolveSlug(t, id)
			await tx.categoryTranslation.upsert({
				where: { categoryId_locale: { categoryId: id, locale: t.locale } },
				create: {
					categoryId: id,
					locale: t.locale,
					name: t.name,
					slug,
					description: t.description ?? null,
					metaTitle: t.metaTitle ?? null,
					metaDescription: t.metaDescription ?? null,
				},
				update: {
					name: t.name,
					...(t.slug ? { slug } : {}),
					description: t.description ?? null,
					metaTitle: t.metaTitle ?? null,
					metaDescription: t.metaDescription ?? null,
				},
			})
		}
	})

	return getById(id, locale)
}

/**
 * Copies a category's settings, not its contents.
 *
 * Built on `create` so slug resolution is the one that already exists. What
 * carries over is everything that makes the next category tedious to set up by
 * hand: parent, sort order, hidden flag, option-category flag, image, and the
 * descriptions and meta text in both languages.
 *
 * Two things deliberately do not:
 *
 * - **Products.** Copying the assignments would put every product in two
 *   categories at once, which is almost never what "duplicate this category"
 *   means and is tedious to undo one product at a time. The copy starts empty.
 * - **Subcategories.** Duplicating a branch would silently create a whole tree
 *   from one click, and the size of it would not be visible beforehand.
 *
 * The copy keeps the original's `isHidden`. Left alone that means a duplicate
 * of a visible category is immediately visible — but a category with nothing in
 * it shows an empty listing, not a wrong one, and quietly hiding a copy of a
 * visible category would be its own surprise.
 */
const duplicate = async (id: string, locale: LocaleCode): Promise<CategoryView> => {
	const row = await prisma.category.findUnique({
		where: { id },
		include: { translations: true },
	})

	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Category not found", {
			messageKey: "category.notFound",
		})
	}

	return create(
		{
			parentId: row.parentId,
			sortOrder: row.sortOrder,
			isHidden: row.isHidden,
			isOptionCategory: row.isOptionCategory,
			imageAssetId: row.imageAssetId,
			iconAssetId: row.iconAssetId,
			// Slug omitted: `resolveSlug` derives a fresh one from the copied name,
			// so the duplicate cannot claim the original's URL.
			translations: row.translations.map((t) => ({
				locale: t.locale,
				name: copyNameFor(t.name, t.locale),
				description: t.description ?? undefined,
				metaTitle: t.metaTitle ?? undefined,
				metaDescription: t.metaDescription ?? undefined,
			})),
		},
		locale
	)
}

const remove = async (id: string): Promise<void> => {
	const row = await prisma.category.findUnique({
		where: { id },
		include: { _count: { select: { products: true, children: true } } },
	})

	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Category not found", {
			messageKey: "category.notFound",
		})
	}

	// Refuse rather than cascade. Silently deleting a subtree, or orphaning
	// products out of the catalogue, is not something a click should do.
	if (row._count.children > 0) {
		throw new ApiError(httpStatus.CONFLICT, "Move or delete the subcategories first", {
			messageKey: "category.hasChildren",
		})
	}

	if (row._count.products > 0) {
		throw new ApiError(httpStatus.CONFLICT, "Remove the products from this category first", {
			messageKey: "category.hasProducts",
		})
	}

	await prisma.category.delete({ where: { id } })
}

// ─── Staff reads ─────────────────────────────────────────────────────────────

const adminView = (row: CategoryForAdmin): AdminCategoryView => ({
	id: row.id,
	parentId: row.parentId,
	sortOrder: row.sortOrder,
	isHidden: row.isHidden,
	isOptionCategory: row.isOptionCategory,
	imageAssetId: row.imageAssetId,
	iconAssetId: row.iconAssetId,
	image: toAsset(row.image),
	icon: toAsset(row.icon),
	productCount: row._count.products,
	translations: row.translations.map((t) => ({
		locale: t.locale,
		name: t.name,
		slug: t.slug ?? undefined,
		description: t.description ?? undefined,
		metaTitle: t.metaTitle ?? undefined,
		metaDescription: t.metaDescription ?? undefined,
	})),
	createdAt: row.createdAt,
})

/**
 * Flat, hidden ones included, every translation attached.
 *
 * Flat rather than a tree: the editor needs the parent picker to list every
 * category anyway, and building the tree from parentId in the client is
 * trivial. Sorted so the picker reads in a stable order.
 */
const adminList = async (): Promise<AdminCategoryView[]> => {
	const rows = await prisma.category.findMany({
		include: adminInclude,
		orderBy: { sortOrder: "asc" },
	})

	return rows.map(adminView)
}

const adminGetById = async (id: string): Promise<AdminCategoryView> => {
	const row = await prisma.category.findUnique({
		where: { id },
		include: adminInclude,
	})

	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Category not found", {
			messageKey: "category.notFound",
		})
	}

	return adminView(row)
}

export const CategoryService = {
	list,
	getBySlug,
	getById,
	create,
	duplicate,
	update,
	remove,
	adminList,
	adminGetById,
}
