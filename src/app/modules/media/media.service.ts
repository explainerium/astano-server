import crypto from "crypto"
import path from "path"
import sharp from "sharp"
import type { Prisma } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { storage } from "../../../helpers/storage"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"
import {
	ALLOWED_FILE_EXTENSIONS,
	ALLOWED_IMAGE_TYPES,
	IMAGE_DERIVATIVES,
	MAX_FILE_BYTES,
	MAX_IMAGE_BYTES,
	megabytes,
	SIGNED_URL_TTL_SECONDS,
	UNFILED,
	WEBP_QUALITY,
} from "./media.constant"

const assetInclude = { translations: true, folder: true } satisfies Prisma.AssetInclude
type AssetRow = Prisma.AssetGetPayload<{ include: typeof assetInclude }>

const view = (row: AssetRow, locale: LocaleCode) => {
	const t =
		row.translations.find((x) => x.locale === locale) ??
		row.translations.find((x) => x.locale === DEFAULT_LOCALE)

	const derivatives = (row.derivatives ?? {}) as Record<string, string>

	return {
		id: row.id,
		visibility: row.visibility,
		mimeType: row.mimeType,
		sizeBytes: row.sizeBytes,
		width: row.width,
		height: row.height,
		originalName: row.originalName,
		folderId: row.folderId,
		folderName: row.folder?.name ?? null,
		alt: t?.alt ?? null,
		caption: t?.caption ?? null,
		url: row.visibility === "PUBLIC" ? storage.publicUrl(row.storageKey) : null,
		derivatives:
			row.visibility === "PUBLIC"
				? Object.fromEntries(
						Object.entries(derivatives).map(([name, key]) => [name, storage.publicUrl(key)])
					)
				: {},
		createdAt: row.createdAt,
	}
}

/** Random key, never the uploaded filename — that is attacker-controlled. */
const buildKey = (extension: string): string => {
	const now = new Date()
	const yyyy = now.getUTCFullYear()
	const mm = String(now.getUTCMonth() + 1).padStart(2, "0")
	return `${yyyy}/${mm}/${crypto.randomBytes(16).toString("hex")}${extension}`
}

/**
 * Uploads a product image: validates it really is an image, strips metadata,
 * and generates every derivative size.
 */
const uploadImage = async (
	file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
	opts: { folderId?: string | null; alt?: string; locale: LocaleCode }
) => {
	if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype as (typeof ALLOWED_IMAGE_TYPES)[number])) {
		throw new ApiError(httpStatus.UNSUPPORTED_MEDIA_TYPE, "Unsupported image type", {
			messageKey: "media.badImageType",
			messageVars: { types: "JPEG, PNG, WebP, AVIF, GIF" },
		})
	}

	if (file.size > MAX_IMAGE_BYTES) {
		throw new ApiError(httpStatus.PAYLOAD_TOO_LARGE, "Image too large", {
			messageKey: "media.tooLarge",
			messageVars: { limit: megabytes(MAX_IMAGE_BYTES) },
		})
	}

	// Decode before trusting the declared type. A .jpg header on a PHP file is
	// the oldest upload trick there is; sharp simply fails on anything that is
	// not really an image.
	let meta: sharp.Metadata
	try {
		meta = await sharp(file.buffer).metadata()
	} catch {
		throw new ApiError(httpStatus.BAD_REQUEST, "That file is not a readable image", {
			messageKey: "media.notAnImage",
		})
	}

	const baseKey = buildKey(".webp")

	// rotate() applies the EXIF orientation, then metadata is dropped — camera
	// uploads otherwise appear sideways and carry GPS coordinates.
	const master = sharp(file.buffer).rotate()

	const original = await master.clone().webp({ quality: WEBP_QUALITY }).toBuffer()
	await storage.put({
		key: baseKey,
		body: original,
		contentType: "image/webp",
		visibility: "PUBLIC",
	})

	const derivatives: Record<string, string> = {}
	for (const size of IMAGE_DERIVATIVES) {
		// Never upscale: a 150px source blown up to 1600 is worse than nothing.
		if (meta.width && meta.width <= size.width) continue

		const key = baseKey.replace(/\.webp$/, `-${size.name}.webp`)
		const buffer = await master
			.clone()
			.resize({ width: size.width, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toBuffer()

		await storage.put({ key, body: buffer, contentType: "image/webp", visibility: "PUBLIC" })
		derivatives[size.name] = key
	}

	const row = await prisma.asset.create({
		data: {
			storageKey: baseKey,
			visibility: "PUBLIC",
			mimeType: "image/webp",
			sizeBytes: original.byteLength,
			width: meta.width ?? null,
			height: meta.height ?? null,
			originalName: file.originalname,
			derivatives,
			folderId: opts.folderId ?? null,
			...(opts.alt
				? { translations: { create: [{ locale: opts.locale, alt: opts.alt }] } }
				: {}),
		},
		include: assetInclude,
	})

	return view(row, opts.locale)
}

/**
 * Uploads a customer design file to the PRIVATE bucket. These are the actual
 * production input — losing one loses an order (risk #10) — so they are never
 * transformed, never public, and only reachable through a signed URL.
 */
const uploadFile = async (
	file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
	opts: { locale: LocaleCode; uploadedById?: string }
) => {
	const extension = path.extname(file.originalname).toLowerCase()

	if (!ALLOWED_FILE_EXTENSIONS.includes(extension as (typeof ALLOWED_FILE_EXTENSIONS)[number])) {
		throw new ApiError(httpStatus.UNSUPPORTED_MEDIA_TYPE, "Unsupported file type", {
			messageKey: "media.badFileType",
			messageVars: { types: ALLOWED_FILE_EXTENSIONS.join(", ") },
		})
	}

	if (file.size > MAX_FILE_BYTES) {
		throw new ApiError(httpStatus.PAYLOAD_TOO_LARGE, "File too large", {
			messageKey: "media.tooLarge",
			messageVars: { limit: megabytes(MAX_FILE_BYTES) },
		})
	}

	const key = buildKey(extension)

	await storage.put({
		key,
		body: file.buffer,
		contentType: file.mimetype || "application/octet-stream",
		visibility: "PRIVATE",
	})

	const row = await prisma.asset.create({
		data: {
			storageKey: key,
			visibility: "PRIVATE",
			mimeType: file.mimetype || "application/octet-stream",
			sizeBytes: file.size,
			originalName: file.originalname,
			// Recorded so "may this customer attach this file" has an answer. Without
			// it any signed-in account could quote another customer's asset id and
			// pull their drawings onto its own order.
			uploadedById: opts.uploadedById ?? null,
		},
		include: assetInclude,
	})

	return view(row, opts.locale)
}

const list = async (params: {
	locale: LocaleCode
	folderId?: string
	visibility?: "PUBLIC" | "PRIVATE"
	search?: string
	page: number
	limit: number
}) => {
	const where: Prisma.AssetWhereInput = {
		// UNFILED means "folderId IS NULL", not "no filter" — an absent folderId
		// already means the latter.
		...(params.folderId
			? { folderId: params.folderId === UNFILED ? null : params.folderId }
			: {}),
		...(params.visibility ? { visibility: params.visibility } : {}),
		...(params.search
			? { originalName: { contains: params.search, mode: "insensitive" } }
			: {}),
	}

	const [rows, total] = await Promise.all([
		prisma.asset.findMany({
			where,
			include: assetInclude,
			orderBy: { createdAt: "desc" },
			skip: (params.page - 1) * params.limit,
			take: params.limit,
		}),
		prisma.asset.count({ where }),
	])

	return {
		data: rows.map((r) => view(r, params.locale)),
		meta: {
			page: params.page,
			limit: params.limit,
			total,
			totalPages: Math.ceil(total / params.limit) || 1,
		},
	}
}

const getSignedDownload = async (id: string): Promise<string> => {
	const row = await prisma.asset.findUnique({ where: { id } })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "File not found", {
			messageKey: "media.notFound",
		})
	}

	if (row.visibility === "PUBLIC") return storage.publicUrl(row.storageKey)

	return storage.signedUrl(row.storageKey, SIGNED_URL_TTL_SECONDS)
}

const updateMeta = async (
	id: string,
	payload: { folderId?: string | null; alt?: string; caption?: string; locale: string },
	locale: LocaleCode
) => {
	const existing = await prisma.asset.findUnique({ where: { id } })
	if (!existing) {
		throw new ApiError(httpStatus.NOT_FOUND, "File not found", {
			messageKey: "media.notFound",
		})
	}

	await prisma.$transaction(async (tx) => {
		if (payload.folderId !== undefined) {
			await tx.asset.update({ where: { id }, data: { folderId: payload.folderId } })
		}

		if (payload.alt !== undefined || payload.caption !== undefined) {
			await tx.assetTranslation.upsert({
				where: { assetId_locale: { assetId: id, locale: payload.locale } },
				create: {
					assetId: id,
					locale: payload.locale,
					alt: payload.alt ?? null,
					caption: payload.caption ?? null,
				},
				update: {
					...(payload.alt !== undefined ? { alt: payload.alt } : {}),
					...(payload.caption !== undefined ? { caption: payload.caption } : {}),
				},
			})
		}
	})

	const row = await prisma.asset.findUnique({ where: { id }, include: assetInclude })
	return view(row!, locale)
}

const remove = async (id: string): Promise<void> => {
	const row = await prisma.asset.findUnique({
		where: { id },
		include: {
			_count: { select: { products: true, featuredFor: true, categoryImageFor: true, variantImageFor: true } },
		},
	})

	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "File not found", {
			messageKey: "media.notFound",
		})
	}

	const uses =
		row._count.products +
		row._count.featuredFor +
		row._count.categoryImageFor +
		row._count.variantImageFor

	// Deleting an image still shown on a product page would leave a broken
	// picture nobody notices until a customer does.
	if (uses > 0) {
		throw new ApiError(httpStatus.CONFLICT, "This file is still in use", {
			messageKey: "media.inUse",
			messageVars: { count: String(uses) },
		})
	}

	const derivatives = (row.derivatives ?? {}) as Record<string, string>
	for (const key of [row.storageKey, ...Object.values(derivatives)]) {
		await storage.delete(key, row.visibility)
	}

	await prisma.asset.delete({ where: { id } })
}

// ── Folders (the 37-folder admin library from the old site, §7.1) ────────────

const listFolders = async () => {
	const rows = await prisma.mediaFolder.findMany({
		include: { _count: { select: { assets: true } } },
		orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
	})

	return rows.map((r) => ({
		id: r.id,
		parentId: r.parentId,
		name: r.name,
		sortOrder: r.sortOrder,
		assetCount: r._count.assets,
	}))
}

const createFolder = async (payload: { name: string; parentId?: string | null }) => {
	const row = await prisma.mediaFolder.create({
		data: { name: payload.name, parentId: payload.parentId ?? null },
	})
	return { id: row.id, parentId: row.parentId, name: row.name, sortOrder: row.sortOrder }
}

const removeFolder = async (id: string): Promise<void> => {
	const row = await prisma.mediaFolder.findUnique({
		where: { id },
		include: { _count: { select: { assets: true, children: true } } },
	})

	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Folder not found", {
			messageKey: "media.folderNotFound",
		})
	}

	if (row._count.assets > 0 || row._count.children > 0) {
		throw new ApiError(httpStatus.CONFLICT, "Folder is not empty", {
			messageKey: "media.folderNotEmpty",
		})
	}

	await prisma.mediaFolder.delete({ where: { id } })
}

export const MediaService = {
	uploadImage,
	uploadFile,
	list,
	getSignedDownload,
	updateMeta,
	remove,
	listFolders,
	createFolder,
	removeFolder,
}
