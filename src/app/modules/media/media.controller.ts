import fs from "fs"
import path from "path"
import type { Request, RequestHandler, Response } from "express"
import { env } from "../../../config"
import { verifyLocalSignature } from "../../../helpers/storage"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import ApiError from "../../errors/ApiError"
import { ArtworkService } from "./artwork.service"
import { MediaService } from "./media.service"

const requireFile = (req: Request) => {
	const file = req.file
	if (!file) {
		throw new ApiError(httpStatus.BAD_REQUEST, "No file was uploaded", {
			messageKey: "media.noFile",
		})
	}
	return file
}

const uploadImage: RequestHandler = catchAsync(async (req, res) => {
	const file = requireFile(req)

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("media.uploaded", req.locale),
		data: await MediaService.uploadImage(file, {
			folderId: (req.body?.folderId as string) || null,
			alt: req.body?.alt as string | undefined,
			locale: req.locale,
		}),
	})
})

const uploadFile: RequestHandler = catchAsync(async (req, res) => {
	const file = requireFile(req)

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("media.uploaded", req.locale),
		data: await MediaService.uploadFile(file, { locale: req.locale, uploadedById: req.user?.sub }),
	})
})

const list: RequestHandler = catchAsync(async (req, res) => {
	const q = req.query as unknown as {
		folderId?: string
		visibility?: "PUBLIC" | "PRIVATE"
		search?: string
		page?: number
		limit?: number
	}

	const result = await MediaService.list({
		locale: req.locale,
		folderId: q.folderId,
		visibility: q.visibility,
		search: q.search,
		page: Number(q.page ?? 1),
		limit: Number(q.limit ?? 40),
	})

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: result.data,
		meta: result.meta,
	})
})

const signedUrl: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		/*
		 * Routed through the ownership check rather than straight to storage.
		 * Any signed-in customer can send any asset id, and a competitor's
		 * drawing is exactly the sort of thing worth guessing for.
		 */
		data: {
			url: await ArtworkService.downloadUrl(req.params.id as string, {
				userId: req.user?.sub,
				isStaff: req.user?.role === "ADMIN" || req.user?.role === "SHOP_MANAGER",
			}),
		},
	})
})

const updateMeta: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("media.updated", req.locale),
		data: await MediaService.updateMeta(
			req.params.id as string,
			{ ...req.body, locale: (req.body?.locale as string) ?? req.locale },
			req.locale
		),
	})
})

const remove: RequestHandler = catchAsync(async (req, res) => {
	await MediaService.remove(req.params.id as string)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("media.deleted", req.locale),
	})
})

const listFolders: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await MediaService.listFolders(),
	})
})

const createFolder: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("media.folderCreated", req.locale),
		data: await MediaService.createFolder(req.body),
	})
})

const removeFolder: RequestHandler = catchAsync(async (req, res) => {
	await MediaService.removeFolder(req.params.id as string)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("media.folderDeleted", req.locale),
	})
})

/**
 * Serves a PRIVATE object from local disk after checking the signature.
 *
 * Only used by the local driver — with R2 the presigned URL points at
 * Cloudflare and never reaches this server. Keeping the route means the
 * authorisation path is exercised in development instead of first meeting
 * reality in production.
 */
const downloadLocal = (req: Request, res: Response): void => {
	const key = decodeURIComponent(req.params.key as string)
	const expires = Number(req.query.expires)
	const signature = String(req.query.signature ?? "")

	if (!verifyLocalSignature(key, expires, signature)) {
		res.status(httpStatus.FORBIDDEN).json({
			success: false,
			statusCode: httpStatus.FORBIDDEN,
			message: t("media.linkExpired", req.locale),
		})
		return
	}

	const base = path.join(process.cwd(), "storage", "private")
	const full = path.resolve(base, key)

	// Second traversal guard: the signature covers the key, but a signed key is
	// still not permission to leave the directory.
	if (!full.startsWith(base + path.sep) || !fs.existsSync(full)) {
		res.status(httpStatus.NOT_FOUND).json({
			success: false,
			statusCode: httpStatus.NOT_FOUND,
			message: t("media.notFound", req.locale),
		})
		return
	}

	res.sendFile(full)
}

/** Public media, local driver only — R2 serves these from its own domain. */
const servePublicLocal = (req: Request, res: Response): void => {
	if (env.STORAGE_DRIVER !== "local") {
		res.status(httpStatus.NOT_FOUND).end()
		return
	}

	// Mounted with app.use("/media"), so req.path is already the key.
	const key = decodeURIComponent(req.path.replace(/^\/+/, ""))
	const base = path.join(process.cwd(), "storage", "public")
	const full = path.resolve(base, key)

	if (!full.startsWith(base + path.sep) || !fs.existsSync(full)) {
		res.status(httpStatus.NOT_FOUND).end()
		return
	}

	res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
	res.sendFile(full)
}

export const MediaController = {
	uploadImage,
	uploadFile,
	list,
	signedUrl,
	updateMeta,
	remove,
	listFolders,
	createFolder,
	removeFolder,
	downloadLocal,
	servePublicLocal,
}
