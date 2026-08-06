import type { RequestHandler } from "express"
import { httpStatus } from "../../../shared/httpStatus"
import catchAsync from "../../../shared/catchAsync"
import sendResponse from "../../../shared/sendResponse"
import { t } from "../../../i18n"
import { PricingService } from "./pricing.service"
import type { TierSource } from "../../../domain/pricing/resolvePrice"

const categoryTiers: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PricingService.listCategoryTiers(req.params.id as string),
	})
})

const saveCategoryTiers: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PricingService.setCategoryTiers(
			req.params.id as string,
			req.body.role,
			req.body.tiers
		),
	})
})

const customerTiers: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PricingService.listCustomerTiers(req.params.id as string),
	})
})

const saveCustomerTiers: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PricingService.setCustomerTiers(
			req.params.id as string,
			req.body.productId ?? null,
			req.body.note,
			req.body.tiers
		),
	})
})

const tierPriority: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("common.ok", req.locale),
		data: await PricingService.getTierPriority(),
	})
})

const saveTierPriority: RequestHandler = catchAsync(async (req, res) => {
	sendResponse(res, {
		statusCode: httpStatus.OK,
		message: t("setting.saved", req.locale),
		data: await PricingService.setTierPriority(req.body.order as TierSource[]),
	})
})

export const PricingController = {
	categoryTiers,
	saveCategoryTiers,
	customerTiers,
	saveCustomerTiers,
	tierPriority,
	saveTierPriority,
}
