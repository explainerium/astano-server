import Decimal from "decimal.js"
import type { Prisma, QuoteStatus } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { applyMoqFloor, getEffectiveMoq, isBelowMoq } from "../../../domain/moq/getEffectiveMoq"
import { t } from "../../../i18n"
import { notifyStaff, sendQuoteAnswered, sendQuoteSubmitted } from "../../../helpers/mailer"
import { storage } from "../../../helpers/storage"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { generateToken, hashToken } from "../../../shared/token"
import ApiError from "../../errors/ApiError"
import { GUEST_BASKET_TTL_DAYS } from "./quote.constant"

const basketInclude = {
	items: {
		include: {
			variant: {
				include: {
					image: true,
					attributeValues: { include: { attributeValue: { include: { translations: true } } } },
					product: { include: { translations: true, featuredAsset: true } },
				},
			},
		},
		orderBy: { createdAt: "asc" },
	},
} satisfies Prisma.QuoteBasketInclude

type BasketRow = Prisma.QuoteBasketGetPayload<{ include: typeof basketInclude }>

const quoteInclude = {
	items: true,
	messages: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.QuoteRequestInclude

type QuoteRow = Prisma.QuoteRequestGetPayload<{ include: typeof quoteInclude }>

const pick = <T extends { locale: string }>(rows: T[], locale: LocaleCode): T | undefined =>
	rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === DEFAULT_LOCALE) ?? rows[0]

const formatNumber = (n: number): string => `RFQ-${String(n).padStart(6, "0")}`

// ── basket ───────────────────────────────────────────────────────────────────

const basketView = (basket: BasketRow, locale: LocaleCode) => {
	const items = basket.items.map((i) => {
		const product = i.variant.product
		const t = pick(product.translations, locale)
		const moq = getEffectiveMoq({ productMoq: product.moq, variantMoq: i.variant.moq })
		const image = i.variant.image ?? product.featuredAsset

		return {
			id: i.id,
			variantId: i.variantId,
			sku: i.variant.sku,
			name: t?.name ?? "(untitled)",
			slug: t?.slug ?? product.id,
			attributes: i.variant.attributeValues.map(
				(av) => pick(av.attributeValue.translations, locale)?.label ?? av.attributeValue.code
			),
			image: image ? { id: image.id, url: storage.publicUrl(image.storageKey) } : null,
			quantity: i.quantity,
			note: i.note,
			moq,
			belowMoq: isBelowMoq(i.quantity, moq),
			/// No price is shown. That is the entire point of a quote basket —
			/// these products have no price until a human sets one.
			quoteOnly: product.quoteEnabled,
		}
	})

	const belowMoq = items.some((i) => i.belowMoq)

	return {
		id: basket.id,
		items,
		itemCount: items.reduce((n, i) => n + i.quantity, 0),
		lineCount: items.length,
		issues: belowMoq ? ["BELOW_MOQ"] : [],
		/// R4: a line under its minimum BLOCKS submission — the third of the
		/// three MOQ gates (add, update, submit).
		submitReady: items.length > 0 && !belowMoq,
	}
}

export interface BasketOwner {
	userId?: string
	token?: string
}

const expiry = (): Date => new Date(Date.now() + GUEST_BASKET_TTL_DAYS * 24 * 60 * 60 * 1000)

/** Same ownership dance as the cart: guest token, merged into the account on sign-in. */
const resolveBasket = async (
	owner: BasketOwner
): Promise<{ basket: BasketRow; token: string | null }> => {
	if (owner.userId) {
		let mine = await prisma.quoteBasket.findFirst({
			where: { userId: owner.userId },
			include: basketInclude,
			orderBy: { updatedAt: "desc" },
		})

		if (owner.token) {
			const guest = await prisma.quoteBasket.findUnique({
				where: { token: owner.token },
				include: basketInclude,
			})

			if (guest && !guest.userId) {
				if (!mine) {
					await prisma.quoteBasket.update({
						where: { id: guest.id },
						data: { userId: owner.userId, token: null, expiresAt: null },
					})
				} else {
					await prisma.$transaction(async (tx) => {
						for (const item of guest.items) {
							const existing = mine!.items.find((i) => i.variantId === item.variantId)
							if (existing) {
								await tx.quoteBasketItem.update({
									where: { id: existing.id },
									data: { quantity: existing.quantity + item.quantity },
								})
							} else {
								await tx.quoteBasketItem.create({
									data: {
										basketId: mine!.id,
										variantId: item.variantId,
										quantity: item.quantity,
										note: item.note,
									},
								})
							}
						}
						await tx.quoteBasket.delete({ where: { id: guest.id } })
					})
				}

				mine = await prisma.quoteBasket.findFirst({
					where: { userId: owner.userId },
					include: basketInclude,
					orderBy: { updatedAt: "desc" },
				})
			}
		}

		if (!mine) {
			mine = await prisma.quoteBasket.create({
				data: { userId: owner.userId },
				include: basketInclude,
			})
		}

		return { basket: mine, token: null }
	}

	if (owner.token) {
		const existing = await prisma.quoteBasket.findUnique({
			where: { token: owner.token },
			include: basketInclude,
		})
		if (existing && !existing.userId) return { basket: existing, token: owner.token }
	}

	const token = generateToken()
	const basket = await prisma.quoteBasket.create({
		data: { token, expiresAt: expiry() },
		include: basketInclude,
	})

	return { basket, token }
}

const reload = async (id: string, locale: LocaleCode) => {
	const fresh = await prisma.quoteBasket.findUnique({ where: { id }, include: basketInclude })
	return basketView(fresh!, locale)
}

const getBasket = async (owner: BasketOwner, locale: LocaleCode) => {
	const { basket, token } = await resolveBasket(owner)
	return { basket: basketView(basket, locale), token }
}

const addItem = async (
	owner: BasketOwner,
	payload: { variantId: string; quantity: number; note?: string },
	locale: LocaleCode
) => {
	const { basket, token } = await resolveBasket(owner)

	const variant = await prisma.productVariant.findUnique({
		where: { id: payload.variantId },
		include: { product: true },
	})

	if (!variant || !variant.isActive || variant.product.status !== "PUBLISHED") {
		throw new ApiError(httpStatus.NOT_FOUND, "That product is not available", {
			messageKey: "quote.variantUnavailable",
		})
	}

	// Deliberately NOT restricted to quote-only products. A customer may
	// reasonably want a quote on a large quantity of a normal product, and the
	// frontend decides which button to show.

	const moq = getEffectiveMoq({ productMoq: variant.product.moq, variantMoq: variant.moq })

	// R4, gate 1 of 3: reject on add.
	if (isBelowMoq(payload.quantity, moq)) {
		throw new ApiError(httpStatus.BAD_REQUEST, "Below the minimum order quantity", {
			messageKey: "quote.belowMoq",
			messageVars: { moq: String(moq), quantity: String(payload.quantity) },
		})
	}

	const existing = basket.items.find((i) => i.variantId === payload.variantId)

	if (existing) {
		await prisma.quoteBasketItem.update({
			where: { id: existing.id },
			data: {
				quantity: existing.quantity + payload.quantity,
				...(payload.note !== undefined ? { note: payload.note } : {}),
			},
		})
	} else {
		await prisma.quoteBasketItem.create({
			data: {
				basketId: basket.id,
				variantId: payload.variantId,
				quantity: payload.quantity,
				note: payload.note ?? null,
			},
		})
	}

	await prisma.quoteBasket.update({
		where: { id: basket.id },
		data: { expiresAt: basket.userId ? null : expiry() },
	})

	return { basket: await reload(basket.id, locale), token }
}

const updateItem = async (
	owner: BasketOwner,
	itemId: string,
	payload: { quantity: number; note?: string },
	locale: LocaleCode
) => {
	const { basket, token } = await resolveBasket(owner)

	const item = basket.items.find((i) => i.id === itemId)
	if (!item) {
		throw new ApiError(httpStatus.NOT_FOUND, "That line is not in your basket", {
			messageKey: "quote.itemNotFound",
		})
	}

	if (payload.quantity === 0) {
		await prisma.quoteBasketItem.delete({ where: { id: itemId } })
		return { basket: await reload(basket.id, locale), token, adjusted: false }
	}

	const moq = getEffectiveMoq({
		productMoq: item.variant.product.moq,
		variantMoq: item.variant.moq,
	})

	// R4, gate 2 of 3: raise on update, and say so.
	const { quantity, adjusted } = applyMoqFloor(payload.quantity, moq)

	await prisma.quoteBasketItem.update({
		where: { id: itemId },
		data: { quantity, ...(payload.note !== undefined ? { note: payload.note } : {}) },
	})

	return { basket: await reload(basket.id, locale), token, adjusted }
}

const removeItem = async (owner: BasketOwner, itemId: string, locale: LocaleCode) => {
	const { basket, token } = await resolveBasket(owner)

	if (!basket.items.some((i) => i.id === itemId)) {
		throw new ApiError(httpStatus.NOT_FOUND, "That line is not in your basket", {
			messageKey: "quote.itemNotFound",
		})
	}

	await prisma.quoteBasketItem.delete({ where: { id: itemId } })
	return { basket: await reload(basket.id, locale), token }
}

const clearBasket = async (owner: BasketOwner, locale: LocaleCode) => {
	const { basket, token } = await resolveBasket(owner)
	await prisma.quoteBasketItem.deleteMany({ where: { basketId: basket.id } })
	return { basket: await reload(basket.id, locale), token }
}

// ── submission ───────────────────────────────────────────────────────────────

const quoteView = (row: QuoteRow, opts: { staff?: boolean } = {}) => ({
	id: row.id,
	quoteNumber: formatNumber(row.number),
	status: row.status,
	locale: row.locale,
	title: row.title,
	message: row.message,
	contact: {
		name: row.contactName,
		email: row.contactEmail,
		phone: row.contactPhone,
		company: row.contactCompany,
	},
	expiresAt: row.expiresAt,
	quotedSubtotal: row.quotedSubtotal?.toFixed(2) ?? null,
	currency: row.quotedCurrency,
	submittedAt: row.submittedAt,
	answeredAt: row.answeredAt,
	items: row.items.map((i) => ({
		id: i.id,
		sku: i.sku,
		name: i.name,
		attributes: i.attributes,
		quantity: i.quantity,
		moq: i.moqAtSubmission,
		note: i.note,
		quotedUnitPrice: i.quotedUnitPrice?.toFixed(2) ?? null,
		quotedLineTotal: i.quotedLineTotal?.toFixed(2) ?? null,
	})),
	messages: row.messages
		// Internal staff notes never reach the customer.
		.filter((m) => opts.staff || !m.isInternal)
		.map((m) => ({
			id: m.id,
			author: m.author,
			body: m.body,
			...(opts.staff ? { isInternal: m.isInternal } : {}),
			createdAt: m.createdAt,
		})),
})

const submit = async (
	owner: BasketOwner & { user?: { email: string; firstName: string | null; lastName: string | null; company: string | null; phone: string | null } },
	payload: {
		title: string
		message?: string
		contactName?: string
		contactEmail?: string
		contactPhone?: string
		contactCompany?: string
	},
	locale: LocaleCode
) => {
	const { basket } = await resolveBasket(owner)

	if (basket.items.length === 0) {
		throw new ApiError(httpStatus.BAD_REQUEST, "Your inquiry basket is empty", {
			messageKey: "quote.emptyBasket",
		})
	}

	// R4, gate 3 of 3: a line under its minimum blocks submission outright.
	for (const item of basket.items) {
		const moq = getEffectiveMoq({
			productMoq: item.variant.product.moq,
			variantMoq: item.variant.moq,
		})
		if (isBelowMoq(item.quantity, moq)) {
			throw new ApiError(httpStatus.CONFLICT, "A line is below its minimum order quantity", {
				messageKey: "quote.submitBelowMoq",
				// SKU if the product has one, otherwise its name. The message
				// interpolates a bare identifier, so either reads correctly.
				messageVars: {
					sku:
						item.variant.sku ??
						pick(item.variant.product.translations, locale)?.name ??
						"This item",
					moq: String(moq),
				},
			})
		}
	}

	const contactName =
		payload.contactName ??
		[owner.user?.firstName, owner.user?.lastName].filter(Boolean).join(" ").trim()
	const contactEmail = payload.contactEmail ?? owner.user?.email

	// Guests must supply contact details — there is no account to fall back on,
	// and a quote nobody can answer is worse than no quote.
	if (!contactName || !contactEmail) {
		throw new ApiError(httpStatus.BAD_REQUEST, "Name and email are required", {
			messageKey: "quote.contactRequired",
		})
	}

	// A guest needs a way back to their own thread; the raw token goes out in
	// the confirmation email and only its hash is stored.
	const accessToken = owner.userId ? null : generateToken()

	const created = await prisma.$transaction(async (tx) => {
		const quote = await tx.quoteRequest.create({
			data: {
				userId: owner.userId ?? null,
				contactName,
				contactEmail,
				contactPhone: payload.contactPhone ?? owner.user?.phone ?? null,
				contactCompany: payload.contactCompany ?? owner.user?.company ?? null,
				accessTokenHash: accessToken ? hashToken(accessToken) : null,
				title: payload.title,
				message: payload.message ?? null,
				locale,
				items: {
					create: basket.items.map((item) => ({
						variantId: item.variantId,
						productId: item.variant.productId,
						// Empty, not null: the snapshot column is non-null and a real
						// SKU is never blank, so "" unambiguously records "had none
						// at the time".
						sku: item.variant.sku ?? "",
						name:
							pick(item.variant.product.translations, locale)?.name ??
							item.variant.sku ??
							"(untitled)",
						attributes: item.variant.attributeValues.map(
							(av) =>
								pick(av.attributeValue.translations, locale)?.label ?? av.attributeValue.code
						),
						quantity: item.quantity,
						moqAtSubmission: getEffectiveMoq({
							productMoq: item.variant.product.moq,
							variantMoq: item.variant.moq,
						}),
						note: item.note,
					})),
				},
				...(payload.message
					? {
							messages: {
								create: [{ author: "CUSTOMER", authorUserId: owner.userId ?? null, body: payload.message }],
							},
						}
					: {}),
			},
		})

		await tx.quoteBasketItem.deleteMany({ where: { basketId: basket.id } })
		return quote
	})

	const full = await prisma.quoteRequest.findUnique({ where: { id: created.id }, include: quoteInclude })
	const view = quoteView(full!)

	/*
	 * Both mails are fire-and-forget against a request that is already stored.
	 * The guest's copy carries the raw access token, which exists nowhere else —
	 * it is hashed in the database — so this is the only chance to send it.
	 */
	await sendQuoteSubmitted({
		to: full!.contactEmail,
		locale: full!.locale as LocaleCode,
		quoteNumber: view.quoteNumber,
		contactName: full!.contactName,
		title: full!.title,
		items: view.items.map((i) => ({ name: i.name, quantity: i.quantity })),
		accessToken,
	})

	await notifyStaff({
		kind: "staff-new-quote",
		locale: full!.locale as LocaleCode,
		subject: t("staff.newQuote.subject", full!.locale as LocaleCode, { number: view.quoteNumber }),
		title: t("staff.newQuote.title", full!.locale as LocaleCode, { number: view.quoteNumber }),
		intro: t("staff.newQuote.intro", full!.locale as LocaleCode, {
			name: full!.contactName,
			title: full!.title,
		}),
	})

	return { quote: view, accessToken }
}

// ── reads and replies ────────────────────────────────────────────────────────

const listMine = async (userId: string, page: number, limit: number) => {
	const where = { userId }

	const [rows, total] = await Promise.all([
		prisma.quoteRequest.findMany({
			where,
			include: quoteInclude,
			orderBy: { submittedAt: "desc" },
			skip: (page - 1) * limit,
			take: limit,
		}),
		prisma.quoteRequest.count({ where }),
	])

	return {
		data: rows.map((r) => quoteView(r)),
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
	}
}

const getMine = async (userId: string, id: string) => {
	const row = await prisma.quoteRequest.findFirst({ where: { id, userId }, include: quoteInclude })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Quote request not found", {
			messageKey: "quote.notFound",
		})
	}
	return quoteView(row)
}

/** Guest access by the token from their confirmation email. */
const getByToken = async (token: string) => {
	const row = await prisma.quoteRequest.findUnique({
		where: { accessTokenHash: hashToken(token) },
		include: quoteInclude,
	})
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Quote request not found", {
			messageKey: "quote.notFound",
		})
	}
	return quoteView(row)
}

const reply = async (
	id: string,
	body: string,
	author: "CUSTOMER" | "STAFF",
	authorUserId: string | null,
	isInternal = false
) => {
	const quote = await prisma.quoteRequest.findUnique({ where: { id } })
	if (!quote) {
		throw new ApiError(httpStatus.NOT_FOUND, "Quote request not found", {
			messageKey: "quote.notFound",
		})
	}

	await prisma.$transaction(async (tx) => {
		await tx.quoteMessage.create({
			data: { quoteId: id, author, authorUserId, body, isInternal },
		})

		// A visible staff reply moves an open request to ANSWERED. An internal
		// note is not an answer and must not change what the customer sees.
		if (author === "STAFF" && !isInternal && quote.status === "OPEN") {
			await tx.quoteRequest.update({
				where: { id },
				data: { status: "ANSWERED", answeredAt: new Date() },
			})
		}
	})

	/*
	 * Only a visible staff reply is an answer. An internal note must never mail
	 * the customer — that is the whole point of the flag, and getting it wrong
	 * sends them a colleague's private remark.
	 */
	const answered = author === "STAFF" && !isInternal

	/*
	 * A guest has no account to sign into, so the answer has to carry its own
	 * way back to the thread — and the token from the original email cannot be
	 * reused, because only its hash was kept.
	 *
	 * So it rotates: a fresh token each time staff answer. The link in the
	 * newest email is always the live one and older links stop working, which is
	 * the better failure of the two available.
	 */
	const rotated = answered && quote.accessTokenHash ? generateToken() : null

	if (rotated) {
		await prisma.quoteRequest.update({
			where: { id },
			data: { accessTokenHash: hashToken(rotated) },
		})
	}

	const full = await prisma.quoteRequest.findUnique({ where: { id }, include: quoteInclude })

	if (answered) {
		await sendQuoteAnswered({
			to: full!.contactEmail,
			locale: full!.locale as LocaleCode,
			quoteNumber: formatNumber(full!.number),
			contactName: full!.contactName,
			accessToken: rotated,
		})
	}

	return quoteView(full!, { staff: author === "STAFF" })
}

const adminList = async (params: {
	status?: QuoteStatus
	search?: string
	page: number
	limit: number
}) => {
	const where: Prisma.QuoteRequestWhereInput = {
		...(params.status ? { status: params.status } : {}),
		...(params.search
			? {
					OR: [
						{ title: { contains: params.search, mode: "insensitive" } },
						{ contactName: { contains: params.search, mode: "insensitive" } },
						{ contactEmail: { contains: params.search, mode: "insensitive" } },
						{ contactCompany: { contains: params.search, mode: "insensitive" } },
						{ items: { some: { sku: { contains: params.search, mode: "insensitive" } } } },
					],
				}
			: {}),
	}

	const [rows, total] = await Promise.all([
		prisma.quoteRequest.findMany({
			where,
			include: quoteInclude,
			orderBy: { submittedAt: "desc" },
			skip: (params.page - 1) * params.limit,
			take: params.limit,
		}),
		prisma.quoteRequest.count({ where }),
	])

	return {
		data: rows.map((r) => quoteView(r, { staff: true })),
		meta: {
			page: params.page,
			limit: params.limit,
			total,
			totalPages: Math.ceil(total / params.limit) || 1,
		},
	}
}

const adminGet = async (id: string) => {
	const row = await prisma.quoteRequest.findUnique({ where: { id }, include: quoteInclude })
	if (!row) {
		throw new ApiError(httpStatus.NOT_FOUND, "Quote request not found", {
			messageKey: "quote.notFound",
		})
	}
	return quoteView(row, { staff: true })
}

/** Staff pricing the request and/or moving its status. */
const adminUpdate = async (
	id: string,
	payload: {
		status?: QuoteStatus
		expiresAt?: Date | null
		items?: { id: string; quotedUnitPrice?: string | number | null }[]
	}
) => {
	const existing = await prisma.quoteRequest.findUnique({ where: { id }, include: { items: true } })
	if (!existing) {
		throw new ApiError(httpStatus.NOT_FOUND, "Quote request not found", {
			messageKey: "quote.notFound",
		})
	}

	await prisma.$transaction(async (tx) => {
		for (const line of payload.items ?? []) {
			const item = existing.items.find((i) => i.id === line.id)
			if (!item) continue

			const unit =
				line.quotedUnitPrice === null || line.quotedUnitPrice === undefined
					? null
					: new Decimal(line.quotedUnitPrice)

			await tx.quoteRequestItem.update({
				where: { id: line.id },
				data: {
					quotedUnitPrice: unit ? unit.toFixed(4) : null,
					quotedLineTotal: unit
						? unit.mul(item.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(4)
						: null,
				},
			})
		}

		// Recompute the header total from the lines rather than trusting a
		// number sent alongside them.
		const lines = await tx.quoteRequestItem.findMany({ where: { quoteId: id } })
		const priced = lines.filter((l) => l.quotedLineTotal !== null)
		const subtotal = priced.reduce((sum, l) => sum.plus(new Decimal(l.quotedLineTotal!)), new Decimal(0))

		await tx.quoteRequest.update({
			where: { id },
			data: {
				...(payload.status ? { status: payload.status } : {}),
				...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
				quotedSubtotal: priced.length ? subtotal.toFixed(4) : null,
			},
		})
	})

	return adminGet(id)
}

/**
 * Marks quotes past their expiry. Run on a schedule — the old shop had a cron
 * job doing exactly this, which is how we know `expiresAt` was in real use.
 */
const expireOverdue = async (now = new Date()): Promise<number> => {
	const result = await prisma.quoteRequest.updateMany({
		where: {
			expiresAt: { not: null, lt: now },
			status: { in: ["OPEN", "ANSWERED"] },
		},
		data: { status: "EXPIRED" },
	})

	return result.count
}

export const QuoteService = {
	getBasket,
	addItem,
	updateItem,
	removeItem,
	clearBasket,
	submit,
	listMine,
	getMine,
	getByToken,
	reply,
	adminList,
	adminGet,
	adminUpdate,
	expireOverdue,
}
