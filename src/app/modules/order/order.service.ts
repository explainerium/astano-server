import Decimal from "decimal.js"
import { Prisma, type OrderStatus, type PaymentStatus } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { getEffectiveMoq, isBelowMoq } from "../../../domain/moq/getEffectiveMoq"
import { readBankAccounts } from "../../../domain/payment/bankAccounts"
import { previousOrdersWhere } from "../../../domain/payment/orderHistory"
import { SettingService } from "../setting/setting.service"
import { evaluateMethods } from "../../../domain/payment/gatewayEligibility"
import { canSellTo, readSellingRule } from "../../../domain/shop/sellingLocations"
import { canShipTo, readShippingRule } from "../../../domain/shop/shippingLocations"
import { checkArtwork, readArtworkRules } from "../../../domain/product/artwork"
import { acceptsLateArtwork } from "../../../domain/order/artworkWindow"
import { nestOptionLines } from "../../../domain/order/nestOptionLines"
import { rememberAddresses } from "./rememberAddress"
import { ArtworkService } from "../media/artwork.service"
import { availableOf, canTake, isLow, readStockRules } from "../../../domain/stock/availability"
import { reservationFor } from "../../../domain/stock/reservation"
import { effectiveRole, type PricingRole } from "../../../domain/pricing/effectiveRole"
import { resolvePrice, type RolePriceInput } from "../../../domain/pricing/resolvePrice"
import { resolveShipping } from "../../../domain/shipping/resolveShipping"
import { resolveOrderTax } from "./orderTax"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import ApiError from "../../errors/ApiError"
import { applyBundleDiscount, loadBundleDiscounts } from "../cart/bundleDiscount"
import { loadExternalTiers } from "../product/tierSources"
import {
	notifyStaff,
	notifyStaffOfArtwork,
	notifyStaffOfOrder,
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
	items: {
		include: {
			files: {
				orderBy: { sortOrder: "asc" },
				/*
				 * The asset behind the frozen row, where it still exists.
				 *
				 * The row is the record — name and all — and survives the upload
				 * being deleted, which is why `fileName` is copied onto it. These
				 * two are for the upload box in the customer's account, which lists
				 * what is attached with its size and date the way it does everywhere
				 * else. Null once the asset is gone, and the box leaves those alone.
				 */
				include: { asset: { select: { sizeBytes: true, createdAt: true } } },
			},
			/*
			 * Reached through the variant because `OrderItem.productId` is a bare
			 * column with no relation — the order freezes what was sold and points
			 * back only informationally.
			 *
			 * Needed for one thing: how many drawings this line may still take. A
			 * line whose variant has since been deleted reports none, which is the
			 * honest answer — there is nothing left to read the rules from.
			 */
			variant: {
				select: { product: { select: { artworkMaxFiles: true, artworkRequired: true } } },
			},
		},
	},
	addresses: true,
	taxLines: true,
	statusHistory: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.OrderInclude

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>

/** AST-000123 — formatted for display, stored as a plain integer. */
const formatNumber = (n: number): string => `AST-${String(n).padStart(6, "0")}`

/**
 * One order line, main or option — both are products and both take drawings.
 *
 * Shared so an option cannot end up describing itself differently from the line
 * above it. `canAttachArtwork` is the answer to "may this customer still send
 * the file", which is two questions folded into one for the page's benefit: the
 * product has to accept drawings at all, and the order has to be open to one
 * (domain/order/artworkWindow).
 */
const lineView = (i: OrderRow["items"][number], status: OrderStatus) => {
	const artwork = readArtworkRules(i.variant?.product)

	return {
		id: i.id,
		sku: i.sku,
		name: i.name,
		attributes: i.attributes,
		quantity: i.quantity,
		unitPrice: i.unitPrice.toFixed(2),
		lineTotal: i.lineTotal.toFixed(2),
		// What production is to make this from. assetId is null once the upload
		// is deleted; the name stays so the order still records it.
		files: i.files.map((f) => ({
			id: f.id,
			assetId: f.assetId,
			name: f.fileName,
			sizeBytes: f.asset?.sizeBytes ?? null,
			uploadedAt: f.asset?.createdAt ?? null,
		})),
		artwork,
		canAttachArtwork: artwork.maxFiles > 0 && acceptsLateArtwork(status),
	}
}

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
	items: nestOptionLines(row.items).map(({ line: i, options }) => ({
		...lineView(i, row.status),
		options: options.map((o) => lineView(o, row.status)),
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
	const user = params.userId
		? await prisma.user.findUnique({ where: { id: params.userId } })
		: null

	/**
	 * Each line carries its product's own tax status and class, so a product
	 * marked "not taxed" is not taxed and a reduced-rate class reaches the
	 * customer. The rest is `orderTax.ts`, which quote acceptance calls too.
	 */
	const tax = await resolveOrderTax({
		countryCode: params.shippingCountry ?? null,
		state: params.shippingState ?? null,
		lines: lines.map((line) => ({
			net: line.lineTotal,
			taxStatus: line.item.variant.product.taxStatus,
			taxClassId: line.item.variant.product.taxClassId,
		})),
		shippingCost,
		shippingMethodTaxable: shippingTaxable,
		hasValidatedVatId: user?.vatValidated ?? false,
		settings,
	})

	const grandTotal = subtotal.plus(shippingCost).plus(new Decimal(tax.totalTax))

	// ── payment methods ─────────────────────────────────────────────────────
	const methods = await prisma.paymentMethod.findMany({ include: { translations: true }, orderBy: { sortOrder: "asc" } })

	const completedOrders = params.userId
		? await prisma.order.count({ where: previousOrdersWhere(params.userId) })
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
			historyExemptRoles: m.historyExemptRoles,
			minOrderTotal: m.minOrderTotal?.toString() ?? null,
			maxOrderTotal: m.maxOrderTotal?.toString() ?? null,
			requiresValidatedVatId: m.requiresValidatedVatId,
		})),
		{
			isLoggedIn: Boolean(params.userId),
			/*
			 * The effective role, not the stored one.
			 *
			 * `role` here is already `effectiveRole(params.role, params.status)` —
			 * the same value prices are calculated against — and the difference
			 * matters as soon as a payment method is restricted by role. Every
			 * B2B registration is approved by hand, so a RESELLER row exists from
			 * the moment somebody fills in the form; passing the stored role would
			 * have offered payment by invoice to an account nobody had approved
			 * yet, which is the precise opposite of what restricting it to
			 * resellers is for.
			 */
			role,
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
				// So "above the maximum" can name the maximum. See publicView in
				// the payment service, which sends the same pair.
				minOrderTotal: m?.minOrderTotal?.toString() ?? null,
				maxOrderTotal: m?.maxOrderTotal?.toString() ?? null,
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

		/*
		 * Reserve stock, and let the database be the one to say no.
		 *
		 * `quoteCart` checked availability, but it ran before this transaction
		 * opened and read a row anybody could have taken since. An unguarded
		 * `decrement` is not a check — under READ COMMITTED two checkouts for the
		 * last unit both pass the earlier read, both decrement, and the variant
		 * ends up at -1 with two customers promised the same item.
		 *
		 * The condition therefore travels *with* the write: the row is locked for
		 * the duration of the update, so the second transaction evaluates
		 * `stock >= needed` against the value the first one left behind and
		 * matches nothing. `count === 0` is that refusal, and it rolls the whole
		 * order back rather than shipping an oversell.
		 */
		for (const line of q.lines) {
			const variant = line.item.variant
			const reservation = reservationFor(variant, line.item.quantity, q.stockRules)
			if (reservation.kind === "untracked") continue

			const floor =
				reservation.kind === "guarded" ? { stock: { gte: reservation.minimumStock } } : {}

			const reserved = await tx.productVariant.updateMany({
				where: { id: line.item.variantId, manageStock: true, ...floor },
				data: { stock: { decrement: line.item.quantity } },
			})

			if (reserved.count === 0) {
				throw new ApiError(httpStatus.CONFLICT, "Not enough stock", {
					messageKey: "order.lineOutOfStock",
					messageVars: {
						sku: variant.sku ?? line.name,
						available: String(availableOf(variant, q.stockRules) ?? 0),
					},
				})
			}

			// Read the level back rather than subtracting here: under two
			// simultaneous checkouts the stored row is the real one, and a guess
			// would warn on the wrong order or not at all.
			const after = await tx.productVariant.findUniqueOrThrow({
				where: { id: line.item.variantId },
				select: { sku: true, stock: true, manageStock: true, allowBackorder: true, lowStockThreshold: true },
			})

			if (isLow(after, q.stockRules)) lowStock.push({ sku: after.sku, remaining: after.stock })
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

	await notifyStaffOfOrder({
		locale: params.locale,
		orderId: order.id,
		orderNumber: result.orderNumber,
		customerName: `${params.billingAddress.firstName} ${params.billingAddress.lastName}`,
		customerEmail: recipient ?? null,
		paymentTitle: result.paymentMethod?.title ?? null,
		subtotal: result.subtotal,
		shippingTotal: result.shippingTotal,
		taxTotal: result.taxTotal,
		grandTotal: result.grandTotal,
		currency: result.currency,
		items: result.items.map((i) => ({ name: i.name, quantity: i.quantity, lineTotal: i.lineTotal })),
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

/**
 * A drawing sent after the order was placed.
 *
 * The client's rule is that print files may follow the order, and until now
 * "follow" meant emailing them to the shop, where they never joined the order
 * record. This is the channel: the customer opens the order in their account
 * and attaches the file to the line it belongs to.
 *
 * The one deliberate hole in the rule that an order freezes everything, so it
 * is fenced on three sides — the order has to be theirs, it has to still be
 * open (domain/order/artworkWindow), and the product has to accept drawings at
 * all. Every refusal is a 404 rather than a 403: whether somebody else's order
 * exists is not the caller's business.
 *
 * Replaces the set rather than adding to it, the same as the cart does. A
 * customer who attached the wrong file needs a way to correct it, and an
 * add-only endpoint makes that a second endpoint nobody builds. What stops
 * that quietly rewriting history is the note below: the order's thread records
 * that files arrived, who sent them and when, so the change is visible to the
 * staff member reading it rather than inferred from a timestamp.
 */
const attachArtwork = async (
	userId: string,
	orderId: string,
	itemId: string,
	assetIds: string[],
	locale: LocaleCode
) => {
	const item = await prisma.orderItem.findFirst({
		where: { id: itemId, orderId, order: { userId } },
		include: {
			// What the line holds now, so the note can say what actually changed
			// rather than only what it ended up with.
			files: { orderBy: { sortOrder: "asc" } },
			order: { select: { id: true, number: true, status: true, locale: true } },
			variant: {
				select: { product: { select: { artworkMaxFiles: true, artworkRequired: true } } },
			},
		},
	})

	if (!item) {
		throw new ApiError(httpStatus.NOT_FOUND, "That line is not on your order", {
			messageKey: "order.lineNotFound",
		})
	}

	if (!acceptsLateArtwork(item.order.status)) {
		throw new ApiError(httpStatus.CONFLICT, "This order is no longer open for files", {
			messageKey: "order.artworkClosed",
		})
	}

	// The product's own limit, refused here rather than only in the form — the
	// form is not what protects production from a line with forty attachments.
	ArtworkService.refuse(checkArtwork(readArtworkRules(item.variant?.product), assetIds.length))

	const assets = await ArtworkService.assertOwned(assetIds, userId)

	await prisma.$transaction([
		prisma.orderItemFile.deleteMany({ where: { orderItemId: itemId } }),
		prisma.orderItemFile.createMany({
			data: assets.map((asset, index) => ({
				orderItemId: itemId,
				assetId: asset.id,
				// Copied, not read through the asset: a file the customer later
				// deletes still shows on the order as something that was supplied.
				fileName: asset.originalName,
				sortOrder: index,
			})),
		}),
	])

	const customer = await prisma.user.findUnique({ where: { id: userId } })
	const customerName =
		[customer?.firstName, customer?.lastName].filter(Boolean).join(" ") ||
		customer?.email ||
		"The customer"

	const orderNumber = formatNumber(item.order.number)

	/*
	 * Recorded on the order before anybody is told about it.
	 *
	 * This is what keeps a replaceable set honest against the rule that an order
	 * freezes everything: the rows hold what the line carries *now*, and the
	 * thread holds how it got there. A drawing swapped for a corrected one is
	 * visible to the staff member reading the order rather than inferred from a
	 * timestamp.
	 *
	 * Private — a note for staff, not a message to the customer, so it must not
	 * be mailed back to them. `authorId` stays null because the author is not a
	 * member of staff; the name is copied so the thread still says who.
	 */
	const names = assets.map((a) => a.originalName).join(", ")
	const had = item.files.length

	await prisma.orderNote.create({
		data: {
			orderId,
			authorId: null,
			authorName: customerName,
			body: !assets.length
				? `Removed the ${had} file(s) from “${item.name}”`
				: had
					? `Replaced the files on “${item.name}” (was: ${item.files.map((f) => f.fileName).join(", ")}) with: ${names}`
					: `Attached ${assets.length} file(s) to “${item.name}”: ${names}`,
			isCustomerVisible: false,
		},
	})

	// Only when something actually arrived. Clearing a line is a correction, not
	// news, and mailing it would train staff to ignore the ones that matter.
	if (assets.length) {
		await notifyStaffOfArtwork({
			// The order's own language, not the request's — the shop reads these,
			// and an order placed in German stays German.
			locale: (item.order.locale || locale) as LocaleCode,
			orderId: item.order.id,
			orderNumber,
			customerName,
			lineName: item.name,
			fileNames: assets.map((a) => a.originalName),
		})
	}

	return assets.map(ArtworkService.toFile)
}

export const OrderService = {
	preview,
	place,
	attachArtwork,
	addNote,
	listNotes,
	listMine,
	getMine,
	adminList,
	adminGet,
	updateStatus,
}
