import Decimal from "decimal.js"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"

/**
 * Turning an accepted quote into a real order.
 *
 * Without this the quote flow is a dead end: staff price a request, the
 * customer agrees, and then there is no way to actually buy it. The old shop
 * had the same hole, which is part of why the requirement was attempted four
 * times.
 *
 * The QUOTED prices are what get charged — not whatever resolvePrice() would
 * say today. A quote is an offer the shop made in writing; honouring it is the
 * entire point, so the order's line prices come from the quote and nowhere
 * else.
 */
export interface AddressInput {
	firstName: string
	lastName: string
	company?: string | null
	street1: string
	street2?: string | null
	city: string
	state?: string | null
	postcode: string
	countryCode: string
	phone?: string | null
	email?: string | null
}

export interface ConvertInput {
	quoteId: string
	userId: string
	locale: string
	billingAddress: AddressInput
	shippingAddress?: AddressInput
	paymentMethodId: string
	shippingMethodId?: string
	customerNote?: string
}

export const convertQuoteToOrder = async (input: ConvertInput) => {
	const quote = await prisma.quoteRequest.findUnique({
		where: { id: input.quoteId },
		include: { items: { include: { files: { orderBy: { sortOrder: "asc" } } } } },
	})

	if (!quote) {
		throw new ApiError(httpStatus.NOT_FOUND, "Quote request not found", {
			messageKey: "quote.notFound",
		})
	}

	// A guest quote has no account to attach an order to, and checkout requires
	// one (R7). They must register first — their quote is still readable by token.
	if (quote.userId !== input.userId) {
		throw new ApiError(httpStatus.NOT_FOUND, "Quote request not found", {
			messageKey: "quote.notFound",
		})
	}

	if (quote.convertedOrderId) {
		throw new ApiError(httpStatus.CONFLICT, "This quote has already been ordered", {
			messageKey: "quote.alreadyConverted",
		})
	}

	if (quote.status === "EXPIRED") {
		throw new ApiError(httpStatus.CONFLICT, "This quote has expired", {
			messageKey: "quote.expired",
		})
	}

	if (quote.expiresAt && quote.expiresAt < new Date()) {
		throw new ApiError(httpStatus.CONFLICT, "This quote has expired", {
			messageKey: "quote.expired",
		})
	}

	const priced = quote.items.filter((i) => i.quotedLineTotal !== null)

	if (!priced.length || priced.length !== quote.items.length) {
		throw new ApiError(httpStatus.CONFLICT, "This quote has not been fully priced yet", {
			messageKey: "quote.notPriced",
		})
	}

	const paymentMethod = await prisma.paymentMethod.findUnique({
		where: { id: input.paymentMethodId },
		include: { translations: true },
	})

	if (!paymentMethod || !paymentMethod.isActive) {
		throw new ApiError(httpStatus.CONFLICT, "That payment method is not available", {
			messageKey: "order.paymentUnavailable",
			messageVars: { reason: "INACTIVE" },
		})
	}

	const subtotal = priced.reduce(
		(sum, i) => sum.plus(new Decimal(i.quotedLineTotal!.toString())),
		new Decimal(0)
	)

	const shippingAddress = input.shippingAddress ?? input.billingAddress
	const paymentText =
		paymentMethod.translations.find((t) => t.locale === input.locale) ??
		paymentMethod.translations[0]

	const order = await prisma.$transaction(async (tx) => {
		const created = await tx.order.create({
			data: {
				userId: input.userId,
				status: "PENDING",
				paymentStatus: "UNPAID",
				locale: input.locale,
				// Tax and shipping on a quoted order are agreed with the customer
				// rather than computed — a bespoke job does not have a catalogue
				// weight to band on. Staff adjust the order afterwards if needed.
				subtotal: subtotal.toFixed(4),
				shippingTotal: "0",
				taxTotal: "0",
				grandTotal: subtotal.toFixed(4),
				paymentMethodId: paymentMethod.id,
				paymentMethodCode: paymentMethod.code,
				paymentMethodTitle: paymentText?.title ?? paymentMethod.code,
				paymentInstructions: paymentText?.instructions ?? null,
				customerNote: input.customerNote ?? null,
				internalNote: `Created from quote RFQ-${String(quote.number).padStart(6, "0")}`,
				addresses: {
					create: [
						{ type: "BILLING" as const, ...input.billingAddress },
						{ type: "SHIPPING" as const, ...shippingAddress },
					],
				},
				statusHistory: {
					create: [
						{
							toStatus: "PENDING",
							note: `Converted from quote RFQ-${String(quote.number).padStart(6, "0")}`,
							changedByUserId: input.userId,
						},
					],
				},
				items: {
					create: priced.map((i) => ({
						variantId: i.variantId,
						productId: i.productId,
						sku: i.sku,
						name: i.name,
						attributes: i.attributes,
						quantity: i.quantity,
						// The agreed price, not today's catalogue price.
						unitPrice: i.quotedUnitPrice!.toString(),
						lineTotal: i.quotedLineTotal!.toString(),
						// The drawing follows the line onto the order. It was frozen once
						// at submission; this copies that record rather than re-reading
						// the upload, which may since have been deleted.
						files: {
							create: i.files.map((f, index) => ({
								assetId: f.assetId,
								fileName: f.fileName,
								sortOrder: index,
							})),
						},
					})),
				},
			},
		})

		await tx.quoteRequest.update({
			where: { id: quote.id },
			data: { convertedOrderId: created.id, status: "ACCEPTED" },
		})

		await tx.quoteMessage.create({
			data: {
				quoteId: quote.id,
				author: "CUSTOMER",
				authorUserId: input.userId,
				body: `Accepted — order AST-${String(created.number).padStart(6, "0")} placed.`,
			},
		})

		return created
	})

	return order.id
}
