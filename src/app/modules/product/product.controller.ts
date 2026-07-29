import type { Request, RequestHandler } from "express"
import { catchAsync } from "../../../shared/catchAsync"
import { httpStatus } from "../../../shared/httpStatus"
import { sendResponse } from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { ProductService } from "./product.service"

/**
 * Guest, B2C and Reseller all hit the same URL and must see different prices.
 * The role comes from the token via effectiveRole (rule R5b) — never from the
 * request body, which a customer controls.
 */
const roleFor = (req: Request) => ProductService.pricingRoleFor(req.user?.role, req.user?.status)

const list: RequestHandler = catchAsync(async (req, res) => {
	const q = req.query as unknown as {
		category?: string
		search?: string
		quantity?: number
		page?: number
		limit?: number
		sort?: string
	}

	const result = await ProductService.list({
		locale: req.locale,
		role: roleFor(req),
		category: q.category,
		search: q.search,
		quantity: Number(q.quantity ?? 1),
		page: Number(q.page ?? 1),
		limit: Number(q.limit ?? 24),
		sort: q.sort ?? "default",
	})

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: result.data,
		meta: result.meta,
	})
})

const getBySlug: RequestHandler = catchAsync(async (req, res) => {
	const quantity = Number((req.query as { quantity?: string }).quantity ?? 1)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await ProductService.getBySlug(
			req.params.slug as string,
			req.locale,
			roleFor(req),
			Number.isFinite(quantity) && quantity > 0 ? quantity : 1
		),
	})
})

const adminList: RequestHandler = catchAsync(async (req, res) => {
	const q = req.query as unknown as {
		kind?: string
		status?: string
		visibility?: string
		search?: string
		page?: number
		limit?: number
	}

	const result = await ProductService.adminList({
		locale: req.locale,
		kind: q.kind,
		status: q.status,
		visibility: q.visibility,
		search: q.search,
		page: Number(q.page ?? 1),
		limit: Number(q.limit ?? 50),
	})

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: result.data,
		meta: result.meta,
	})
})

const adminGetById: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await ProductService.adminGetById(req.params.id as string, req.locale),
	})
})

const create: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		message: t("product.created", req.locale),
		data: await ProductService.create(req.body, req.locale),
	})
})

const update: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("product.updated", req.locale),
		data: await ProductService.update(req.params.id as string, req.body, req.locale),
	})
})

const remove: RequestHandler = catchAsync(async (req, res) => {
	await ProductService.remove(req.params.id as string)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("product.deleted", req.locale),
	})
})

export const ProductController = {
	list,
	getBySlug,
	adminList,
	adminGetById,
	create,
	update,
	remove,
}
