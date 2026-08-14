import Decimal from "decimal.js"
import { Prisma, type OrderStatus, type PaymentStatus } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { getEffectiveMoq, isBelowMoq } from "../../../domain/moq/getEffectiveMoq"
import { readBankAccounts } from "../../../domain/payment/bankAccounts"
import { SettingService } from "../setting/setting.service"
import { evaluateMethods } from "../../../domain/payment/gatewayEligibility"
import { canSellTo, readSellingRule } from "../../../domain/shop/sellingLocations"
import { canShipTo, readShippingRule } from "../../../domain/shop/shippingLocations"
import { checkArtwork, readArtworkRules } from "../../../domain/product/artwork"
import { rememberAddresses } from "./rememberAddress"
import { ArtworkService } from "../media/artwork.service"
import { availableOf, canTake, isLow, readStockRules } from "../../../domain/stock/availability"
import { effectiveRole, type PricingRole } from "../../../domain/pricing/effectiveRole"
import { resolvePrice, type RolePriceInput } from "../../../domain/pricing/resolvePrice"
import { resolveShipping } from "../../../domain/shipping/resolveShipping"
import { resolveTax, type TaxRateInput } from "../../../domain/tax/resolveTax"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"
import { applyBundleDiscount, loadBundleDiscounts } from "../cart/bundleDiscount"
import { loadExternalTiers } from "../product/tierSources"
import {
	notifyStaff,
	sendCustomerNote,
	sendOrderConfirmation,
	sendOrderStatusChanged,
} from "../../../helpers/mailer"
import { t } from "../../../i18n"

// ── helpers ──────────────────────────────────────────────────────────────────

const pick = <T extends { locale: string }>(rows: T[], locale: LocaleCode): T | undefined =>
	rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === DEFAULT_LOCALE) ?? rows[0]

const toPriceInputs = (
	prices: { role: string; basePrice: unknown; salePrice: unknown; saleStartsAt: Date | null; saleEndsAt: Date | null }[],
	tiers: { role: string; minQuantity: number; type: string; value: unknown }[]
): RolePriceInput[] =>
	prices.map((p) => ({
		role: p.role as PricingRole,
		basePrice: p.basePrice as string,
		salePrice: (p.salePrice ?? null) as string | null,
		saleStartsAt: p.saleStartsAt,
		saleEndsAt: p.saleEndsAt,
		tiers: tiers
			.filter((t) => t.role === p.role)
			.map((t) => ({
				minQuantity: t.minQuantity,
				type: t.type as "FIXED_PRICE" | "PERCENTAGE" | "FIXED_AMOUNT",
				value: t.value as string,
			})),
	}))

const cartInclude = {
	items: {
		include: {
			files: {
				include: { asset: { select: { id: true, originalName: true } } },
				orderBy: { sortOrder: "asc" },
			},
			variant: {
				include: {
					prices: true,
					priceTiers: true,
					translations: true,
					attributeValues: { include: { attributeValue: { include: { translations: true } } } },
					product: {
						include: { translations: true, prices: true, priceTiers: true, taxClass: { include: { rates: true } } },
					},
				},
			},
		},
		orderBy: { createdAt: "asc" },
	},
} satisfies Prisma.CartInclude

const orderInclude = {
	items: { include: { files: { orderBy: { sortOrder: "asc" } } } },
	addresses: true,
	taxLines: true,
	statusHistory: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.OrderInclude

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>

/** AST-000123 — formatted for display, stored as a plain integer. */
const formatNumber = (n: number): string => `AST-${String(n).padStart(6, "0")}`

const view = (row: OrderRow, opts: { staff?: boolean } = {}) => ({
	id: row.id,
	orderNumber: formatNumber(row.number),
	status: row.status,
	paymentStatus: row.paymentStatus,
	locale: row.locale,
	currency: row.currency,
	subtotal: row.subtotal.toFixed(2),
	shippingTotal: row.shippingTotal.toFixed(2),
	taxTotal: row.taxTotal.toFixed(2),
	discountTotal: row.discountTotal.toFixed(2),
	grandTotal: row.grandTotal.toFixed(2),
	totalWeightKg: row.totalWeightKg?.toString() ?? null,
	shippingMethod: row.shippingMethodTitle
		? { code: row.shippingMethodCode, title: row.shippingMethodTitle }
		: null,
	paymentMethod: row.paymentMethodTitle
		? {
				code: row.paymentMethodCode,
				title: row.paymentMethodTitle,
				instructions: row.paymentInstructions,
				// Read from the order, not from the method. These are what this
				// customer was told; the shop's current details may differ.
				bankAccounts: readBankAccounts({ bankAccounts: row.paymentAccounts }),
			}
		: null,
	vatNumber: row.vatNumber,
	reverseCharged: row.reverseCharged,
	customerNote: row.customerNote,
	// Internal notes are staff-only and must never leak to the customer.
	...(opts.staff ? { internalNote: row.internalNote } : {}),
	placedAt: row.placedAt,
	paidAt: row.paidAt,
	addresses: Object.fromEntries(
		row.addresses.map((a) => [
			a.type.toLowerCase(),
			{
				firstName: a.firstName,
				lastName: a.lastName,
				company: a.company,
				street1: a.street1,
				street2: a.street2,
				city: a.city,
				state: a.state,
				postcode: a.postcode,
				countryCode: a.countryCode,
				phone: a.phone,
				email: a.email,
			},
		])
	),
	items: row.items
		.filter((i) => !i.parentItemId)
		.map((i) => ({
			id: i.id,
			sku: i.sku,
			name: i.name,
			attributes: i.attributes,
			quantity: i.quantity,
			unitPrice: i.unitPrice.toFixed(2),
			lineTotal: i.lineTotal.toFixed(2),
			// What production is to make this from. assetId is null once the
			// upload is deleted; the name stays so the order still records it.
			files: i.files.map((f) => ({ id: f.id, assetId: f.assetId, name: f.fileName })),
			options: row.items
				.filter((o) => o.parentItemId === i.id)
				.map((o) => ({
					id: o.id,
					sku: o.sku,
					name: o.name,
					quantity: o.quantity,
					unitPrice: o.unitPrice.toFixed(2),
					lineTotal: o.lineTotal.toFixed(2),
					files: o.files.map((f) => ({ id: f.id, assetId: f.assetId, name: f.fileName })),
				})),
		})),
	taxLines: row.taxLines.map((t) => ({
		name: t.name,
		ratePercent: t.ratePercent.toFixed(2),
		taxableBase: t.taxableBase.toFixed(2),
		amount: t.amount.toFixed(2),
	})),
	...(opts.staff
		? {
				statusHistory: row.statusHistory.map((h) => ({
					from: h.fromStatus,
					to: h.toStatus,
					note: h.note,
					at: h.createdAt,
				})),
			}
		: {}),
})

// ── quote: the shared calculation behind preview and place ───────────────────

interface QuoteParams {
	userId?: string
	role?: string
	status?: string
	locale: LocaleCode
	shippingCountry?: string
	shippingState?: string
	shippingMethodId?: string
	paymentMethodId?: string
	vatNumber?: string
}

/**
 * Prices the whole order: lines, shipping, tax, and which payment methods are
 * available. Used by both preview and place, so the number a customer is shown
 * is computed by the same code that charges them.
 */
const quoteCart = async (params: QuoteParams) => {
	const cart = await prisma.cart.findFirst({
		where: { userId: params.userId },
		include: cartInclude,
		orderBy: { updatedAt: "desc" },
	})

	if (!cart || cart.items.length === 0) {
		throw new ApiError(httpStatus.BAD_REQUEST, "Your cart is empty", {
			messageKey: "order.emptyCart",
		})
	}

	const role = effectiveRole((params.role ?? null) as never, (params.status ?? null) as never)

	/*
	 * One read for the whole quote.
	 *
	 * Stock floors, shipping locations and the tax switch are all settings, and
	 * fetching them separately meant three round trips to say one thing about
	 * the state of the shop — and, worse, three chances for a save mid-checkout
	 * to be half-applied to the same basket.
	 */
	const settings = await SettingService.getMap()
	const stockRules = readStockRules(settings)

	// The same discounts the cart applied. Without this the basket would show
	// one total and the invoice another.
	const bundleDiscounts = await loadBundleDiscounts(cart.items)

	/**
	 * And the same ladders. Checkout re-prices from scratch rather than trusting
	 * the cart's numbers, so it has to load every source the cart loaded — a
	 * category or customer ladder honoured in the basket and forgotten at
	 * checkout is the disagreement risk #1 exists to prevent.
	 */
	const externalTiers = await loadExternalTiers({
		productIds: [...new Set(cart.items.map((i) => i.variant.productId))],
		role,
		userId: params.userId,
		cartId: cart.id,
		withCategoryQuantities: true,
	})

	const lines: {
		item: (typeof cart.items)[number]
		name: string
		attributes: string[]
		unitPrice: Decimal
		lineTotal: Decimal
		weightKg: Decimal
	}[] = []

	let subtotal = new Decimal(0)
	let totalWeight = new Decimal(0)

	for (const item of cart.items) {
		const product = item.variant.product

		/**
		 * How this line is named back to the customer when something is wrong
		 * with it.
		 *
		 * SKU first — it is what is printed on their cart line — then the product
		 * name for the products that have none. Every message below interpolates
		 * a bare identifier ("{sku} is no longer available"), never the literal
		 * word "SKU", so either reads correctly.
		 */
		const label =
			item.variant.sku ?? pick(product.translations, params.locale)?.name ?? "This item"

		// Re-validate at checkout. A cart can sit for weeks while the product is
		// unpublished, sold out, its MOQ raised, or turned quote-only.
		if (!item.variant.isActive || product.status !== "PUBLISHED") {
			throw new ApiError(httpStatus.CONFLICT, "A product in your cart is no longer available", {
				messageKey: "order.lineUnavailable",
				messageVars: { sku: label },
			})
		}

		if (product.quoteEnabled) {
			throw new ApiError(httpStatus.CONFLICT, "A product in your cart is quote-only", {
				messageKey: "order.lineQuoteOnly",
				messageVars: { sku: label },
			})
		}

		const moq = getEffectiveMoq({ productMoq: product.moq, variantMoq: item.variant.moq })
		if (isBelowMoq(item.quantity, moq)) {
			throw new ApiError(httpStatus.CONFLICT, "A line is below its minimum order quantity", {
				messageKey: "order.lineBelowMoq",
				messageVars: { sku: label, moq: String(moq) },
			})
		}

		/*
		 * What is attached must be allowed — but nothing has to be attached.
		 *
		 * A line carrying more files than the product accepts, or files on a
		 * product that accepts none, is data that should never have been written
		 * and is still refused. A line with *no* file is not: the client's rule
		 * is that print files may follow the order, so an order missing one is
		 * an order waiting on artwork, not an invalid one.
		 *
		 * This used to throw, and the checkout would not let the customer past.
		 */
		const artworkProblem = checkArtwork(readArtworkRules(product), item.files.length)
		if (artworkProblem) ArtworkService.refuse(artworkProblem)

		if (!canTake(item.variant, item.quantity, stockRules)) {
			throw new ApiError(httpStatus.CONFLICT, "Not enough stock", {
				messageKey: "order.lineOutOfStock",
				messageVars: { sku: label, available: String(availableOf(item.variant, stockRules) ?? 0) },
			})
		}

		const price = resolvePrice({
			role,
			quantity: item.quantity,
			productPrices: toPriceInputs(product.prices, product.priceTiers),
			variantPrices: toPriceInputs(item.variant.prices, item.variant.priceTiers),
			...externalTiers(product.id),
		})

		const discount = bundleDiscounts.get(item.id)
		const unitPrice = price.unitPrice && discount ? applyBundleDiscount(price.unitPrice, discount) : price.unitPrice
		const lineTotal = unitPrice ? unitPrice.mul(item.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : null

		if (!unitPrice || !lineTotal) {
			throw new ApiError(httpStatus.CONFLICT, "A product in your cart has no price", {
				messageKey: "order.lineNoPrice",
				messageVars: { sku: label },
			})
		}

		const t = pick(product.translations, params.locale)
		const weight = new Decimal(item.variant.weightKg ?? 0).mul(item.quantity)

		lines.push({
			item,
			name: t?.name ?? label,
			attributes: item.variant.attributeValues.map(
				(av) => pick(av.attributeValue.translations, params.locale)?.label ?? av.attributeValue.code
			),
			unitPrice,
			lineTotal,
			weightKg: weight,
		})

		subtotal = subtotal.plus(lineTotal)
		totalWeight = totalWeight.plus(weight)
	}

	// ── shipping ────────────────────────────────────────────────────────────
	let shippingCost = new Decimal(0)
	let shippingTaxable = true
	let chosenShipping: { id: string; code: string; title: string } | null = null
	let shippingOptions: unknown[] = []

	/*
	 * Checked before the zones are consulted, not instead of them.
	 *
	 * A zone says what delivery costs; this says whether it is offered at all.
	 * Reading it here means a country the shop has switched off gets no options
	 * even where a zone still claims it — which is the point of having the
	 * setting, and stops the two disagreeing.
	 */
	const shippingRule = readShippingRule(settings)
	const sellingRule = readSellingRule(settings)

	if (params.shippingCountry && canShipTo(shippingRule, sellingRule, params.shippingCountry)) {
		const zoneCountry = await prisma.shippingZoneCountry.findUnique({
			where: { countryCode: params.shippingCountry.toUpperCase() },
			include: {
				zone: {
					include: {
						translations: true,
						methods: {
							where: { isActive: true },
							include: { translations: true, rates: true },
							orderBy: { sortOrder: "asc" },
						},
					},
				},
			},
		})

		if (zoneCountry?.zone.isActive) {
			const quotes = resolveShipping({
				weightKg: totalWeight,
				subtotal,
				methods: zoneCountry.zone.methods.map((m) => ({
					id: m.id,
					code: m.code,
					name: pick(m.translations, params.locale)?.name ?? m.code,
					type: m.type,
					flatCost: m.flatCost?.toString() ?? null,
					freeAboveSubtotal: m.freeAboveSubtotal?.toString() ?? null,
					taxable: m.taxable,
					sortOrder: m.sortOrder,
					bands: m.rates.map((r) => ({
						minValue: r.minValue.toString(),
						maxValue: r.maxValue?.toString() ?? null,
						cost: r.cost.toString(),
					})),
				})),
			})

			shippingOptions = quotes

			if (params.shippingMethodId) {
				const chosen = quotes.find((q) => q.methodId === params.shippingMethodId)
				if (!chosen || chosen.unavailableReason) {
					throw new ApiError(httpStatus.CONFLICT, "That delivery method is not available", {
						messageKey: "order.shippingUnavailable",
					})
				}
				shippingCost = new Decimal(chosen.cost)
				shippingTaxable = chosen.taxable
				chosenShipping = { id: chosen.methodId, code: chosen.code, title: chosen.name }
			}
		} else if (params.shippingMethodId) {
			throw new ApiError(httpStatus.CONFLICT, "We do not deliver to that country", {
				messageKey: "order.notDeliverable",
			})
		}
	}
	/*
	 * No destination, no delivery options — deliberately.
	 *
	 * Cost depends on the zone and the weight, so a method listed before the
	 * address could only show a price it does not have. Payment is different and
	 * is listed straight away: what a customer may pay with barely depends on
	 * where the parcel goes, so making them fill a form to find out is a needless
	 * gate. `hasDestination` below is what lets the checkout tell "nothing yet"
	 * apart from "nothing that reaches you".
	 */

	// ── tax ─────────────────────────────────────────────────────────────────
	// One tax class per order, taken from the default class. Per-product classes
	// are supported by the schema and land with mixed-rate baskets; for now the
	// common case is one rate for the whole order.
	const taxClass = await prisma.taxClass.findFirst({
		where: { isDefault: true },
		include: { rates: true },
	})

	const user = params.userId
		? await prisma.user.findUnique({ where: { id: params.userId } })
		: null

	/*
	 * The master switch, and what "off" has to mean.
	 *
	 * Explicitly **not** `unconfigured`. That state exists to refuse an order
	 * rather than invoice it at 0 % because nobody entered a rate — an accident.
	 * A shop that has deliberately turned tax off has not had an accident, so
	 * checkout must proceed. Routing this through resolveTax with no country
	 * would produce the refusing state instead, which is why it is spelt out.
	 */
	const taxEnabled = settings["tax.enabled"] !== false

	const tax = !taxEnabled
		? { lines: [], totalTax: "0.00", reverseCharged: false, unconfigured: false }
		: resolveTax({
		countryCode: params.shippingCountry ?? null,
		state: params.shippingState ?? null,
		netAmount: subtotal,
		shippingAmount: shippingCost,
		shippingTaxable,
		hasValidatedVatId: user?.vatValidated ?? false,
		rates: (taxClass?.rates ?? []).map(
			(r): TaxRateInput => ({
				countryCode: r.countryCode,
				state: r.state,
				name: r.name,
				rate: r.rate.toString(),
				appliesToShipping: r.appliesToShipping,
				priority: r.priority,
				reverseChargeWithVatId: r.reverseChargeWithVatId,
				isActive: r.isActive,
			})
		),
	})

	const grandTotal = subtotal.plus(shippingCost).plus(new Decimal(tax.totalTax))

	// ── payment methods ─────────────────────────────────────────────────────
	const methods = await prisma.paymentMethod.findMany({ include: { translations: true }, orderBy: { sortOrder: "asc" } })

	const completedOrders = params.userId
		? await prisma.order.count({ where: { userId: params.userId, status: "COMPLETED" } })
		: 0

	const eligibility = evaluateMethods(
		methods.map((m) => ({
			id: m.id,
			code: m.code,
			isActive: m.isActive,
			sortOrder: m.sortOrder,
			allowedCountries: m.allowedCountries,
			allowedRoles: m.allowedRoles,
			requiresLogin: m.requiresLogin,
			minCompletedOrders: m.minCompletedOrders,
			minOrderTotal: m.minOrderTotal?.toString() ?? null,
			maxOrderTotal: m.maxOrderTotal?.toString() ?? null,
			requiresValidatedVatId: m.requiresValidatedVatId,
		})),
		{
			isLoggedIn: Boolean(params.userId),
			role: params.role ?? null,
			billingCountry: params.shippingCountry ?? null,
			completedOrders,
			orderTotal: grandTotal,
			hasValidatedVatId: user?.vatValidated ?? false,
		}
	)

	const methodsById = new Map(methods.map((m) => [m.id, m]))

	return {
		cart,
		role,
		lines,
		subtotal,
		shippingCost,
		shippingTaxable,
		chosenShipping,
		shippingOptions,
		tax,
		grandTotal,
		totalWeight,
		eligibility,
		methodsById,
		user,
		stockRules,
	}
}

const preview = async (params: QuoteParams) => {
	const q = await quoteCart(params)

	return {
		subtotal: q.subtotal.toFixed(2),
		shippingTotal: q.shippingCost.toFixed(2),
		taxTotal: q.tax.totalTax,
		grandTotal: q.grandTotal.toFixed(2),
		totalWeightKg: q.totalWeight.toFixed(3),
		currency: "EUR",
		reverseCharged: q.tax.reverseCharged,
		taxUnconfigured: q.tax.unconfigured,
		taxLines: q.tax.lines,
		/**
		 * Whether a delivery country was supplied.
		 *
		 * Lets the checkout distinguish "you have not told us where yet" from "we
		 * do not deliver there" — both leave shippingOptions empty, and showing a
		 * red "we cannot deliver to you" on a page nobody has typed an address
		 * into is alarming and wrong.
		 */
		hasDestination: Boolean(params.shippingCountry),
		shippingOptions: q.shippingOptions,
		paymentMethods: q.eligibility.map((e) => {
			const m = q.methodsById.get(e.methodId)
			const t = m ? pick(m.translations, params.locale) : undefined
			return {
				id: e.methodId,
				code: e.code,
				title: t?.title ?? e.code,
				description: t?.description ?? null,
				eligible: e.eligible,
				...(e.reason ? { reason: e.reason } : {}),
			}
		}),
	}
}

// ── placing the order ────────────────────────────────────────────────────────

interface AddressInput {
	firstName: string
	lastName: string
	company?: string
	street1: string
	street2?: string
	city: string
	state?: string
	postcode: string
	countryCode: string
	phone?: string
	email?: string
}

const place = async (
	params: QuoteParams & {
		userId: string
		billingAddress: AddressInput
		shippingAddress?: AddressInput
		shippingMethodId: string
		paymentMethodId: string
		customerNote?: string
	}
) => {
	const shippingAddress = params.shippingAddress ?? params.billingAddress

	/*
	 * Checked here, not only in the country dropdown.
	 *
	 * The checkout filters its list with the same rule, so this should never
	 * fire for anyone using the site normally. It fires for a request that did
	 * not come from the site — and a selling restriction the server does not
	 * enforce is a preference, not a rule.
	 */
	const placeSettings = await SettingService.getMap()
	const selling = readSellingRule(placeSettings)

	if (!canSellTo(selling, shippingAddress.countryCode)) {
		throw new ApiError(httpStatus.CONFLICT, "We do not sell to that country", {
			messageKey: "order.countryNotSold",
		})
	}

	// Selling and shipping are separate answers, so both are asked. A country
	// the shop sells to but does not deliver to has no shipping method, and
	// without this the order would be refused for the wrong reason.
	if (!canShipTo(readShippingRule(placeSettings), selling, shippingAddress.countryCode)) {
		throw new ApiError(httpStatus.CONFLICT, "We do not deliver to that country", {
			messageKey: "order.notDeliverable",
		})
	}

	const q = await quoteCart({
		...params,
		shippingCountry: shippingAddress.countryCode,
		shippingState: shippingAddress.state,
	})

	/** Filled as stock is decremented, mailed once the order has committed. */
	const lowStock: { sku: string | null; remaining: number }[] = []

	const verdict = q.eligibility.find((e) => e.methodId === params.paymentMethodId)
	if (!verdict || !verdict.eligible) {
		throw new ApiError(httpStatus.CONFLICT, "That payment method is not available", {
			messageKey: "order.paymentUnavailable",
			messageVars: { reason: verdict?.reason ?? "UNKNOWN" },
		})
	}

	if (q.tax.unconfigured) {
		// Better to refuse than to invoice a customer at 0% because nobody
		// entered a rate for their country.
		throw new ApiError(httpStatus.CONFLICT, "No tax rate is configured for that country", {
			messageKey: "order.taxUnconfigured",
			messageVars: { country: shippingAddress.countryCode },
		})
	}

	const paymentMethod = q.methodsById.get(params.paymentMethodId)!
	const paymentText = pick(paymentMethod.translations, params.locale)
	const frozenAccounts = readBankAccounts(paymentMethod.config)

	const order = await prisma.$transaction(async (tx) => {
		const created = await tx.order.create({
			data: {
				userId: params.userId,
				status: "PENDING",
				paymentStatus: "UNPAID",
				locale: params.locale,
				subtotal: q.subtotal.toFixed(4),
				shippingTotal: q.shippingCost.toFixed(4),
				taxTotal: q.tax.totalTax,
				grandTotal: q.grandTotal.toFixed(4),
				totalWeightKg: q.totalWeight.toFixed(3),
				shippingMethodId: q.chosenShipping?.id ?? null,
				shippingMethodCode: q.chosenShipping?.code ?? null,
				shippingMethodTitle: q.chosenShipping?.title ?? null,
				paymentMethodId: paymentMethod.id,
				paymentMethodCode: paymentMethod.code,
				paymentMethodTitle: paymentText?.title ?? paymentMethod.code,
				paymentInstructions: paymentText?.instructions ?? null,
				// Copied, not referenced — see Order.paymentAccounts. An empty list
				// stores as JSON null so a bank-transfer order placed before any
				// account was entered is distinguishable from one with none.
				paymentAccounts: frozenAccounts.length
					? (frozenAccounts as unknown as Prisma.InputJsonValue)
					: Prisma.JsonNull,
				vatNumber: params.vatNumber ?? q.user?.vatNumber ?? null,
				vatValidated: q.user?.vatValidated ?? false,
				reverseCharged: q.tax.reverseCharged,
				customerNote: params.customerNote ?? null,
				addresses: {
					create: [
						{ type: "BILLING", ...params.billingAddress },
						{ type: "SHIPPING", ...shippingAddress },
					],
				},
				taxLines: {
					create: q.tax.lines.map((l) => ({
						name: l.name,
						ratePercent: l.ratePercent,
						taxableBase: l.taxableBase,
						amount: l.amount,
					})),
				},
				statusHistory: {
					create: [{ toStatus: "PENDING", note: "Order placed", changedByUserId: params.userId }],
				},
			},
		})

		// Parent lines first, then options, so a parent id exists to point at.
		const idMap = new Map<string, string>()

		for (const line of q.lines.filter((l) => !l.item.parentItemId)) {
			const row = await tx.orderItem.create({
				data: {
					orderId: created.id,
					variantId: line.item.variantId,
					productId: line.item.variant.productId,
					// Empty, not null: the snapshot column is non-null and a real SKU is
					// never blank, so "" is unambiguous shorthand for "had none at the
					// time". The invoice renders it into an empty element, which is what
					// no SKU should look like.
					sku: line.item.variant.sku ?? "",
					name: line.name,
					attributes: line.attributes,
					quantity: line.item.quantity,
					unitPrice: line.unitPrice.toFixed(4),
					lineTotal: line.lineTotal.toFixed(4),
					weightKg: line.weightKg.toFixed(3),
					// Frozen with the line. assetId goes null if the upload is ever
					// deleted; the name stays, so the order still records what was sent.
					files: {
						create: line.item.files.map((f, index) => ({
							assetId: f.assetId,
							fileName: f.asset.originalName,
							sortOrder: index,
						})),
					},
				},
			})
			idMap.set(line.item.id, row.id)
		}

		for (const line of q.lines.filter((l) => l.item.parentItemId)) {
			await tx.orderItem.create({
				data: {
					orderId: created.id,
					variantId: line.item.variantId,
					productId: line.item.variant.productId,
					// Empty, not null: the snapshot column is non-null and a real SKU is
					// never blank, so "" is unambiguous shorthand for "had none at the
					// time". The invoice renders it into an empty element, which is what
					// no SKU should look like.
					sku: line.item.variant.sku ?? "",
					name: line.name,
					attributes: line.attributes,
					quantity: line.item.quantity,
					unitPrice: line.unitPrice.toFixed(4),
					lineTotal: line.lineTotal.toFixed(4),
					weightKg: line.weightKg.toFixed(3),
					// Frozen with the line. assetId goes null if the upload is ever
					// deleted; the name stays, so the order still records what was sent.
					files: {
						create: line.item.files.map((f, index) => ({
							assetId: f.assetId,
							fileName: f.asset.originalName,
							sortOrder: index,
						})),
					},
					parentItemId: idMap.get(line.item.parentItemId!) ?? null,
				},
			})
		}

		// Reserve stock now. Inside the same transaction as the order, so two
		// simultaneous checkouts cannot both take the last item.
		for (const line of q.lines) {
			if (line.item.variant.manageStock) {
				const after = await tx.productVariant.update({
					where: { id: line.item.variantId },
					data: { stock: { decrement: line.item.quantity } },
					select: { sku: true, stock: true, manageStock: true, allowBackorder: true, lowStockThreshold: true },
				})

				// Read the level back from the update rather than subtracting here:
				// under two simultaneous checkouts the returned row is the real one,
				// and a guess would warn on the wrong order or not at all.
				if (isLow(after, q.stockRules)) lowStock.push({ sku: after.sku, remaining: after.stock })
			}
		}

		await tx.cartItem.deleteMany({ where: { cartId: q.cart.id } })

		return created
	})

	const full = await prisma.order.findUnique({ where: { id: order.id }, include: orderInclude })
	const result = view(full!)

	/*
	 * Stock the address book from the order, so the next checkout fills itself
	 * in. Outside the transaction and unable to throw: the order is written, and
	 * a convenience row failing to save is not a reason to tell the customer
	 * their order did not go through.
	 */
	await rememberAddresses({
		userId: params.userId,
		billing: params.billingAddress,
		// Only when they actually asked to deliver elsewhere; when they did not,
		// `shippingAddress` is a copy of the billing one and would store twice.
		...(params.shippingAddress ? { shipping: params.shippingAddress } : {}),
	})

	// Fire-and-forget: a slow or unreachable mail server must never fail an
	// order that has already been written and paid for.
	const recipient = params.billingAddress.email ?? q.user?.email
	if (recipient) {
		await sendOrderConfirmation({
			to: recipient,
			locale: params.locale,
			orderNumber: result.orderNumber,
			customerName: `${params.billingAddress.firstName} ${params.billingAddress.lastName}`,
			subtotal: result.subtotal,
			shippingTotal: result.shippingTotal,
			taxTotal: result.taxTotal,
			grandTotal: result.grandTotal,
			currency: result.currency,
			items: result.items.map((i) => ({ name: i.name, quantity: i.quantity, lineTotal: i.lineTotal })),
			paymentTitle: result.paymentMethod?.title ?? null,
			paymentInstructions: result.paymentMethod?.instructions ?? null,
			bankAccounts: result.paymentMethod?.bankAccounts ?? [],
		})
	}

	await notifyStaff({
		kind: "staff-new-order",
		locale: params.locale,
		subject: t("staff.newOrder.subject", params.locale, { number: result.orderNumber }),
		title: t("staff.newOrder.title", params.locale, { number: result.orderNumber }),
		intro: t("staff.newOrder.intro", params.locale, {
			name: `${params.billingAddress.firstName} ${params.billingAddress.lastName}`,
			total: `${result.grandTotal} ${result.currency}`,
		}),
	})

	/*
	 * Separate mail from the order notification, and only when something
	 * actually crossed its mark. Folding it into the order email would put a
	 * restocking job in a message read for a different reason, and send it on
	 * every order rather than the few that need it.
	 */
	if (lowStock.length) {
		const skus = lowStock.map((l) => l.sku ?? "—").join(", ")

		await notifyStaff({
			kind: "staff-low-stock",
			locale: params.locale,
			subject: t("staff.lowStock.subject", params.locale, { skus }),
			title: t("staff.lowStock.title", params.locale),
			intro: t("staff.lowStock.intro", params.locale, {
				number: result.orderNumber,
				lines: lowStock.map((l) => `${l.sku ?? "—"} (${l.remaining})`).join(", "),
			}),
		})
	}

	return result
}

// ── reads ────────────────────────────────────────────────────────────────────

const listMine = async (userId: string, page: number, limit: number) => {
	const where = { userId }

	const [rows, total] = await Promise.all([
		prisma.order.findMany({
			where,
			include: orderInclude,
			orderBy: { placedAt: "desc" },
			skip: (page - 1) * limit,
			take: limit,
		}),
		prisma.order.count({ where }),
	])

	return {
		data: rows.map((r) => view(r)),
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
	}
}

const getMine = async (userId: string, id: string) => {
	const row = await prisma.order.findFirst({ where: { id, userId }, include: orderInclude })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Order not found", { messageKey: "order.notFound" })
	}
	return view(row)
}

const adminList = async (params: {
	status?: OrderStatus
	search?: string
	page: number
	limit: number
}) => {
	const where: Prisma.OrderWhereInput = {
		...(params.status ? { status: params.status } : {}),
		...(params.search
			? {
					OR: [
						{ addresses: { some: { lastName: { contains: params.search, mode: "insensitive" } } } },
						{ addresses: { some: { company: { contains: params.search, mode: "insensitive" } } } },
						{ addresses: { some: { email: { contains: params.search, mode: "insensitive" } } } },
						{ items: { some: { sku: { contains: params.search, mode: "insensitive" } } } },
					],
				}
			: {}),
	}

	const [rows, total] = await Promise.all([
		prisma.order.findMany({
			where,
			include: orderInclude,
			orderBy: { placedAt: "desc" },
			skip: (params.page - 1) * params.limit,
			take: params.limit,
		}),
		prisma.order.count({ where }),
	])

	return {
		data: rows.map((r) => view(r, { staff: true })),
		meta: {
			page: params.page,
			limit: params.limit,
			total,
			totalPages: Math.ceil(total / params.limit) || 1,
		},
	}
}

const adminGet = async (id: string) => {
	const row = await prisma.order.findUnique({ where: { id }, include: orderInclude })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Order not found", { messageKey: "order.notFound" })
	}
	return view(row, { staff: true })
}

const updateStatus = async (
	id: string,
	payload: { status: OrderStatus; paymentStatus?: PaymentStatus; note?: string },
	staffUserId: string
) => {
	const existing = await prisma.order.findUnique({ where: { id }, include: { items: true } })
	if (!existing) {
		throw new ApiError(httpStatus.NOT_FOUND, "Order not found", { messageKey: "order.notFound" })
	}

	await prisma.$transaction(async (tx) => {
		await tx.order.update({
			where: { id },
			data: {
				status: payload.status,
				...(payload.paymentStatus ? { paymentStatus: payload.paymentStatus } : {}),
				...(payload.paymentStatus === "PAID" && !existing.paidAt ? { paidAt: new Date() } : {}),
			},
		})

		await tx.orderStatusHistory.create({
			data: {
				orderId: id,
				fromStatus: existing.status,
				toStatus: payload.status,
				note: payload.note ?? null,
				changedByUserId: staffUserId,
			},
		})

		// Cancelling returns the reserved stock. Only on the transition into
		// CANCELLED — cancelling twice must not credit stock twice.
		const releasing =
			(payload.status === "CANCELLED" || payload.status === "REFUNDED") &&
			existing.status !== "CANCELLED" &&
			existing.status !== "REFUNDED"

		if (releasing) {
			for (const item of existing.items) {
				if (item.variantId) {
					await tx.productVariant.updateMany({
						where: { id: item.variantId, manageStock: true },
						data: { stock: { increment: item.quantity } },
					})
				}
			}
		}
	})

	const updated = await prisma.order.findUnique({ where: { id }, include: { addresses: true, user: true } })
	const email = updated?.addresses.find((a) => a.type === "BILLING")?.email ?? updated?.user?.email

	// Only tell the customer when the status actually moved.
	if (email && payload.status !== existing.status) {
		await sendOrderStatusChanged({
			to: email,
			locale: (updated?.locale ?? "en") as never,
			orderNumber: formatNumber(updated?.number ?? 0),
			customerName: updated?.addresses.find((a) => a.type === "BILLING")?.firstName ?? "",
			status: payload.status,
		})
	}

	return adminGet(id)
}

/**
 * Adds a note to an order, and emails it if it is meant for the customer.
 *
 * The author's name is copied onto the row rather than joined at read time.
 * Staff accounts get deleted, and "note added by (nobody)" is worse than a name
 * that is now historical — the point of a thread is knowing who said it.
 */
const addNote = async (
	orderId: string,
	payload: { body: string; isCustomerVisible: boolean },
	staffUserId: string
) => {
	const [order, staff] = await Promise.all([
		prisma.order.findUnique({
			where: { id: orderId },
			include: { addresses: true, user: true },
		}),
		prisma.user.findUnique({ where: { id: staffUserId } }),
	])

	if (!order) {
		throw new ApiError(httpStatus.NOT_FOUND, "Order not found", { messageKey: "order.notFound" })
	}

	const note = await prisma.orderNote.create({
		data: {
			orderId,
			authorId: staffUserId,
			authorName: [staff?.firstName, staff?.lastName].filter(Boolean).join(" ") || "Staff",
			body: payload.body,
			isCustomerVisible: payload.isCustomerVisible,
		},
	})

	if (payload.isCustomerVisible) {
		const billing = order.addresses.find((a) => a.type === "BILLING")
		const to = billing?.email ?? order.user?.email

		// Stored first, mailed second. A note that exists but did not send is
		// recoverable; one that sent but was never recorded is not.
		if (to) {
			await sendCustomerNote({
				to,
				locale: (order.locale || "en") as LocaleCode,
				orderNumber: formatNumber(order.number),
				customerName: billing?.firstName ?? "",
				note: payload.body,
			})
		}
	}

	return note
}

const listNotes = async (orderId: string) =>
	prisma.orderNote.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } })

export const OrderService = {
	preview,
	place,
	addNote,
	listNotes,
	listMine,
	getMine,
	adminList,
	adminGet,
	updateStatus,
}
