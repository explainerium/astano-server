import type { Prisma } from "@prisma/client"
import type { LocaleCode } from "../../../config/locales"
import { DEFAULT_LOCALE } from "../../../config/locales"
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
	productCount: number
	translations: TranslationInput[]
	createdAt: Date
}

type CategoryWithTranslations = Prisma.CategoryGetPayload<{
	include: { translations: true; _count: { select: { products: true } } }
}>

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
		include: { translations: true, _count: { select: { products: true } } },
		orderBy: { sortOrder: "asc" },
	})

	const flat = rows.map((r) => view(r, locale))
	return opts.tree ? buildTree(flat) : flat
}

const getBySlug = async (slug: string, locale: LocaleCode): Promise<CategoryView> => {
	const row = await prisma.category.findFirst({
		where: { translations: { some: { slug } }, isHidden: false },
		include: { translations: true, _count: { select: { products: true } } },
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
		include: { translations: true, _count: { select: { products: true } } },
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
			translations: { create: translations },
		},
		include: { translations: true, _count: { select: { products: true } } },
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

const adminView = (row: CategoryWithTranslations): AdminCategoryView => ({
	id: row.id,
	parentId: row.parentId,
	sortOrder: row.sortOrder,
	isHidden: row.isHidden,
	isOptionCategory: row.isOptionCategory,
	imageAssetId: row.imageAssetId,
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
		include: { translations: true, _count: { select: { products: true } } },
		orderBy: { sortOrder: "asc" },
	})

	return rows.map(adminView)
}

const adminGetById = async (id: string): Promise<AdminCategoryView> => {
	const row = await prisma.category.findUnique({
		where: { id },
		include: { translations: true, _count: { select: { products: true } } },
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
	update,
	remove,
	adminList,
	adminGetById,
}
