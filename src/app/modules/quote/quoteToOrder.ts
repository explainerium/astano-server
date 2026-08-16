import Decimal from "decimal.js"
import { Prisma } from "@prisma/client"
import type { LocaleCode } from "../../../config/locales"
import { readBankAccounts } from "../../../domain/payment/bankAccounts"
import { evaluateMethods } from "../../../domain/payment/gatewayEligibility"
import { canSellTo, readSellingRule } from "../../../domain/shop/sellingLocations"
import { canShipTo, readShippingRule } from "../../../domain/shop/shippingLocations"
import { isLow, readStockRules } from "../../../domain/stock/availability"
import { reservationFor } from "../../../domain/stock/reservation"
import { notifyStaff, sendOrderConfirmation } from "../../../helpers/mailer"
import { t } from "../../../i18n"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"
import { resolveOrderTax } from "../order/orderTax"
import { SettingService } from "../setting/setting.service"

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
 *
 * Everything *around* those prices is the same as checkout, and deliberately so.
 * This used to be a shortcut: no country rules, no payment eligibility, no stock
 * taken, no email, and `taxTotal: "0"` with a note saying staff would adjust it
 * afterwards. Nothing in the dashboard can adjust an order's totals, so that
 * note was never true and a German shop invoiced every quoted order at 0% VAT.
 * An order is an order however it was reached.
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
	locale: LocaleCode
	billingAddress: AddressInput
	shippingAddress?: AddressInput
	paymentMethodId: string
	customerNote?: string
}

const formatNumber = (n: number): string => `AST-${String(n).padStart(6, "0")}`
const formatQuoteNumber = (n: number): string => `RFQ-${String(n).padStart(6, "0")}`

export const convertQuoteToOrder = async (input: ConvertInput) => {
	const quote = await prisma.quoteRequest.findUnique({
		where: { id: input.quoteId },
		include: {
			items: {
				include: {
					files: { orderBy: { sortOrder: "asc" } },
					// The two settings that decide how a line is taxed live on the
					// product, not on the frozen quote row — a quote records what was
					// asked for, not what the tax office thinks of it.
					variant: { include: { product: { select: { taxStatus: true, taxClassId: true } } } },
				},
			},
		},
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

	const shippingAddress = input.shippingAddress ?? input.billingAddress

	/*
	 * The same two questions checkout asks, for the same reason.
	 *
	 * A selling restriction the server does not enforce is a preference rather
	 * than a rule, and this path bypassed both — so a country the shop had
	 * switched off could still be ordered to, provided the customer went via a
	 * quote.
	 */
	const settings = await SettingService.getMap()
	const selling = readSellingRule(settings)

	if (!canSellTo(selling, shippingAddress.countryCode)) {
		throw new ApiError(httpStatus.CONFLICT, "We do not sell to that country", {
			messageKey: "order.countryNotSold",
		})
	}

	if (!canShipTo(readShippingRule(settings), selling, shippingAddress.countryCode)) {
		throw new ApiError(httpStatus.CONFLICT, "We do not deliver to that country", {
			messageKey: "order.notDeliverable",
		})
	}

	const subtotal = priced.reduce(
		(sum, i) => sum.plus(new Decimal(i.quotedLineTotal!.toString())),
		new Decimal(0)
	)

	const [user, paymentMethod, completedOrders] = await Promise.all([
		prisma.user.findUnique({ where: { id: input.userId } }),
		prisma.paymentMethod.findUnique({
			where: { id: input.paymentMethodId },
			include: { translations: true },
		}),
		prisma.order.count({ where: { userId: input.userId, status: "COMPLETED" } }),
	])

	if (!paymentMethod || !paymentMethod.isActive) {
		throw new ApiError(httpStatus.CONFLICT, "That payment method is not available", {
			messageKey: "order.paymentUnavailable",
			messageVars: { reason: "INACTIVE" },
		})
	}

	/*
	 * Shipping is not charged on a quoted order.
	 *
	 * A bespoke job has no catalogue weight to band on, and the delivery terms
	 * are part of what was agreed in the thread. Stated here rather than left as
	 * a zero somebody has to infer — and the tax below is resolved against the
	 * goods alone, so the two agree.
	 */
	const shippingCost = new Decimal(0)

	const tax = await resolveOrderTax({
		countryCode: shippingAddress.countryCode,
		state: shippingAddress.state,
		lines: priced.map((item) => ({
			net: item.quotedLineTotal!.toString(),
			// A line whose product has since been deleted is taxed at the standard
			// rate rather than not at all — the safer of the two guesses, and the
			// one the customer was quoted under.
			taxStatus: item.variant?.product.taxStatus ?? "TAXABLE",
			taxClassId: item.variant?.product.taxClassId ?? null,
		})),
		shippingCost,
		shippingMethodTaxable: false,
		hasValidatedVatId: user?.vatValidated ?? false,
		settings,
	})

	if (tax.unconfigured) {
		// Same refusal as checkout: better than invoicing a customer at 0% because
		// nobody entered a rate for their country.
		throw new ApiError(httpStatus.CONFLICT, "No tax rate is configured for that country", {
			messageKey: "order.taxUnconfigured",
			messageVars: { country: shippingAddress.countryCode },
		})
	}

	const grandTotal = subtotal.plus(shippingCost).plus(new Decimal(tax.totalTax))

	/*
	 * The method's own rules, evaluated rather than assumed.
	 *
	 * `isActive` alone let a customer pay a quoted order by invoice while the
	 * checkout would have refused them for having no order history — the rules
	 * exist to be applied on every path that takes money.
	 */
	const [verdict] = evaluateMethods(
		[
			{
				id: paymentMethod.id,
				code: paymentMethod.code,
				isActive: paymentMethod.isActive,
				sortOrder: paymentMethod.sortOrder,
				allowedCountries: paymentMethod.allowedCountries,
				allowedRoles: paymentMethod.allowedRoles,
				requiresLogin: paymentMethod.requiresLogin,
				minCompletedOrders: paymentMethod.minCompletedOrders,
				minOrderTotal: paymentMethod.minOrderTotal?.toString() ?? null,
				maxOrderTotal: paymentMethod.maxOrderTotal?.toString() ?? null,
				requiresValidatedVatId: paymentMethod.requiresValidatedVatId,
			},
		],
		{
			isLoggedIn: true,
			role: user?.role ?? null,
			billingCountry: input.billingAddress.countryCode,
			completedOrders,
			orderTotal: grandTotal,
			hasValidatedVatId: user?.vatValidated ?? false,
		}
	)

	if (!verdict?.eligible) {
		throw new ApiError(httpStatus.CONFLICT, "That payment method is not available", {
			messageKey: "order.paymentUnavailable",
			messageVars: { reason: verdict?.reason ?? "UNKNOWN" },
		})
	}

	// Not `t` — this file now imports the translator under that name, and one of
	// the two silently shadowing the other is a bug waiting to be written.
	const paymentText =
		paymentMethod.translations.find((row) => row.locale === input.locale) ??
		paymentMethod.translations[0]

	// Copied, not referenced — the customer is being told where to send money,
	// and the shop's details may change before they do.
	const frozenAccounts = readBankAccounts(paymentMethod.config)

	/** Filled as stock is decremented, mailed once the order has committed. */
	const lowStock: { sku: string | null; remaining: number }[] = []
	const stockRules = readStockRules(settings)

	const order = await prisma.$transaction(async (tx) => {
		const created = await tx.order.create({
			data: {
				userId: input.userId,
				status: "PENDING",
				paymentStatus: "UNPAID",
				locale: input.locale,
				subtotal: subtotal.toFixed(4),
				shippingTotal: shippingCost.toFixed(4),
				taxTotal: tax.totalTax,
				grandTotal: grandTotal.toFixed(4),
				paymentMethodId: paymentMethod.id,
				paymentMethodCode: paymentMethod.code,
				paymentMethodTitle: paymentText?.title ?? paymentMethod.code,
				paymentInstructions: paymentText?.instructions ?? null,
				paymentAccounts: frozenAccounts.length
					? (frozenAccounts as unknown as Prisma.InputJsonValue)
					: Prisma.JsonNull,
				vatNumber: user?.vatNumber ?? null,
				vatValidated: user?.vatValidated ?? false,
				reverseCharged: tax.reverseCharged,
				customerNote: input.customerNote ?? null,
				internalNote: `Created from quote ${formatQuoteNumber(quote.number)}`,
				addresses: {
					create: [
						{ type: "BILLING" as const, ...input.billingAddress },
						{ type: "SHIPPING" as const, ...shippingAddress },
					],
				},
				// One row per rate applied, so the invoice can show the breakdown
				// exactly as it was calculated.
				taxLines: {
					create: tax.lines.map((l) => ({
						name: l.name,
						ratePercent: l.ratePercent,
						taxableBase: l.taxableBase,
						amount: l.amount,
					})),
				},
				statusHistory: {
					create: [
						{
							toStatus: "PENDING",
							note: `Converted from quote ${formatQuoteNumber(quote.number)}`,
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

		/*
		 * Reserve stock, exactly as checkout does.
		 *
		 * Skipping it here meant the same last unit could be sold twice — once
		 * through the basket and once by accepting a quote. The condition travels
		 * with the write so the database, not an earlier read, is what refuses.
		 */
		for (const item of priced) {
			if (!item.variantId) continue

			const variant = await tx.productVariant.findUnique({
				where: { id: item.variantId },
				select: { manageStock: true, allowBackorder: true },
			})

			if (!variant) continue

			// The same rule checkout reserves by — see domain/stock/reservation.ts.
			const reservation = reservationFor(variant, item.quantity, stockRules)
			if (reservation.kind === "untracked") continue

			const floor =
				reservation.kind === "guarded" ? { stock: { gte: reservation.minimumStock } } : {}

			const reserved = await tx.productVariant.updateMany({
				where: { id: item.variantId, manageStock: true, ...floor },
				data: { stock: { decrement: item.quantity } },
			})

			if (reserved.count === 0) {
				throw new ApiError(httpStatus.CONFLICT, "Not enough stock", {
					messageKey: "order.lineOutOfStock",
					messageVars: { sku: item.sku || item.name, available: "0" },
				})
			}

			const after = await tx.productVariant.findUniqueOrThrow({
				where: { id: item.variantId },
				select: { sku: true, stock: true, manageStock: true, allowBackorder: true, lowStockThreshold: true },
			})

			if (isLow(after, stockRules)) lowStock.push({ sku: after.sku, remaining: after.stock })
		}

		await tx.quoteRequest.update({
			where: { id: quote.id },
			data: { convertedOrderId: created.id, status: "ACCEPTED" },
		})

		await tx.quoteMessage.create({
			data: {
				quoteId: quote.id,
				author: "CUSTOMER",
				authorUserId: input.userId,
				body: `Accepted — order ${formatNumber(created.number)} placed.`,
			},
		})

		return created
	})

	/*
	 * The same two mails checkout sends, for an order that is just as real.
	 *
	 * A customer who accepted a quote used to receive nothing at all — no
	 * confirmation, no bank details to pay into — and no member of staff was told
	 * an order had arrived. Fire-and-forget against an order already written:
	 * `dispatch` hands off to the transport without waiting, so a slow mail
	 * server cannot fail something that has already committed.
	 */
	const orderNumber = formatNumber(order.number)
	const recipient = input.billingAddress.email ?? user?.email ?? quote.contactEmail

	if (recipient) {
		await sendOrderConfirmation({
			to: recipient,
			locale: input.locale,
			orderNumber,
			customerName: `${input.billingAddress.firstName} ${input.billingAddress.lastName}`,
			subtotal: subtotal.toFixed(2),
			shippingTotal: shippingCost.toFixed(2),
			taxTotal: tax.totalTax,
			grandTotal: grandTotal.toFixed(2),
			currency: quote.quotedCurrency,
			items: priced.map((i) => ({
				name: i.name,
				quantity: i.quantity,
				lineTotal: new Decimal(i.quotedLineTotal!.toString()).toFixed(2),
			})),
			paymentTitle: paymentText?.title ?? paymentMethod.code,
			paymentInstructions: paymentText?.instructions ?? null,
			bankAccounts: frozenAccounts,
		})
	}

	await notifyStaff({
		kind: "staff-new-order",
		locale: input.locale,
		subject: t("staff.newOrder.subject", input.locale, { number: orderNumber }),
		title: t("staff.newOrder.title", input.locale, { number: orderNumber }),
		intro: t("staff.newOrder.intro", input.locale, {
			name: `${input.billingAddress.firstName} ${input.billingAddress.lastName}`,
			total: `${grandTotal.toFixed(2)} ${quote.quotedCurrency}`,
		}),
	})

	if (lowStock.length) {
		await notifyStaff({
			kind: "staff-low-stock",
			locale: input.locale,
			subject: t("staff.lowStock.subject", input.locale, {
				skus: lowStock.map((l) => l.sku ?? "—").join(", "),
			}),
			title: t("staff.lowStock.title", input.locale),
			intro: t("staff.lowStock.intro", input.locale, {
				number: orderNumber,
				lines: lowStock.map((l) => `${l.sku ?? "—"} (${l.remaining})`).join(", "),
			}),
		})
	}

	return order.id
}
