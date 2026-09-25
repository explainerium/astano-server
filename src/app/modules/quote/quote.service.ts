import Decimal from "decimal.js"
import type { Prisma, QuoteStatus } from "@prisma/client"
import { DEFAULT_LOCALE, type LocaleCode } from "../../../config/locales"
import { planMerge } from "../../../domain/basket/mergePlan"
import { applyMoqFloor, getEffectiveMoq, isBelowMoq } from "../../../domain/moq/getEffectiveMoq"
import { t } from "../../../i18n"
import {
	notifyStaff,
	notifyStaffOfQuote,
	sendQuoteAnswered,
	sendQuoteSubmitted,
	type AttachableFile,
} from "../../../helpers/mailer"
import { storage } from "../../../helpers/storage"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { generateToken, hashToken } from "../../../shared/token"
import {
	checkArtwork,
	checkArtworkComplete,
	readArtworkRules,
	readInquiryArtworkRules,
} from "../../../domain/product/artwork"
import { ArtworkService } from "../media/artwork.service"
import { BundleService } from "../bundle/bundle.service"
import { loadFollowingLines } from "../cart/bundleDiscount"
import { followingQuantity, packedMainQuantity } from "../../../domain/bundle/followQuantity"
import ApiError from "../../errors/ApiError"
import { GUEST_BASKET_TTL_DAYS } from "./quote.constant"

const basketInclude = {
	items: {
		include: {
			files: {
				include: {
					/*
					 * `storageKey`, `visibility` and `mimeType` are here for the
					 * submission email, which encloses the drawings rather than
					 * linking to them. None of the three ever leaves the server —
					 * `ArtworkService.toFile` is what the basket view returns, and it
					 * maps down to an id, a name and a size.
					 */
					asset: {
						select: {
							id: true,
							originalName: true,
							sizeBytes: true,
							createdAt: true,
							storageKey: true,
							visibility: true,
							mimeType: true,
						},
					},
				},
				orderBy: { sortOrder: "asc" },
			},
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
	items: { include: { files: { orderBy: { sortOrder: "asc" } } } },
	messages: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.QuoteRequestInclude

type QuoteRow = Prisma.QuoteRequestGetPayload<{ include: typeof quoteInclude }>

const pick = <T extends { locale: string }>(rows: T[], locale: LocaleCode): T | undefined =>
	rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === DEFAULT_LOCALE) ?? rows[0]

const formatNumber = (n: number): string => `RFQ-${String(n).padStart(6, "0")}`

// ── basket ───────────────────────────────────────────────────────────────────

const basketView = (
	basket: BasketRow,
	locale: LocaleCode,
	/** Option lines that follow their product, and how many units each covers. */
	following: Map<string, number> = new Map()
) => {
	const build = (i: BasketRow["items"][number]) => {
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
			/// An option ordered in its parent's quantity; no stepper of its own.
			followsMain: following.has(i.id),
			/// How many of the product one of these covers — 4 for a box of four.
			followsPerUnits: following.get(i.id) ?? 1,
			note: i.note,
			files: i.files.map((f) => ArtworkService.toFile(f.asset)),
			moq,
			belowMoq: isBelowMoq(i.quantity, moq),
			/// No price is shown. That is the entire point of a quote basket —
			/// these products have no price until a human sets one.
			quoteOnly: product.quoteEnabled,
			artwork: readInquiryArtworkRules(product),
			/// Flagged here, refused at submit — see the gate in submit().
			artworkMissing:
				checkArtworkComplete(readInquiryArtworkRules(product), i.files.length)?.kind === "REQUIRED",
		}
	}

	// Option lines are nested under the product they were configured with, as
	// in the cart. An option whose parent is somehow gone is listed on its own
	// rather than dropped — a line the customer cannot see is one they cannot
	// remove.
	const ids = new Set(basket.items.map((i) => i.id))
	const items = basket.items
		.filter((i) => !i.parentItemId || !ids.has(i.parentItemId))
		.map((i) => ({
			...build(i),
			options: basket.items.filter((o) => o.parentItemId === i.id).map(build),
		}))

	const every = items.flatMap((i) => [i, ...i.options])
	const belowMoq = every.some((i) => i.belowMoq)
	const artworkMissing = every.some((i) => i.artworkMissing)

	return {
		id: basket.id,
		items,
		itemCount: every.reduce((n, i) => n + i.quantity, 0),
		lineCount: items.length,
		issues: [
			...(belowMoq ? ["BELOW_MOQ"] : []),
			...(artworkMissing ? ["ARTWORK_REQUIRED"] : []),
		],
		/// R4: a line under its minimum BLOCKS submission — the third of the
		/// three MOQ gates (add, update, submit). A line missing a required
		/// drawing blocks it too: nobody can price a shape they have not seen.
		submitReady: items.length > 0 && !belowMoq && !artworkMissing,
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
					/*
					 * The same plan the cart merges by — see domain/basket/mergePlan.ts.
					 *
					 * The drawings used to be dropped here: a guest attached a file,
					 * signed in to submit the request, and arrived at a basket that had
					 * quietly lost the one thing the request was about. Nobody notices
					 * until staff ask what shape it is supposed to be.
					 *
					 * Options configured with an inquiry product travel with it, parents
					 * before their options, exactly as the cart's do.
					 */
					const plan = planMerge(
						guest.items.map((i) => ({
							id: i.id,
							variantId: i.variantId,
							quantity: i.quantity,
							fileCount: i.files.length,
							parentItemId: i.parentItemId,
						})),
						mine.items.map((i) => ({
							id: i.id,
							variantId: i.variantId,
							quantity: i.quantity,
							fileCount: i.files.length,
							parentItemId: i.parentItemId,
						}))
					)

					const guestItems = new Map(guest.items.map((i) => [i.id, i]))

					await prisma.$transaction(async (tx) => {
						for (const step of plan.increments) {
							// `increment` rather than a total from the row as it was read
							// before the loop: two guest lines landing on the same existing
							// one would each add to the same stale quantity.
							await tx.quoteBasketItem.update({
								where: { id: step.targetId },
								data: { quantity: { increment: step.quantity } },
							})
						}

						const moved = new Map<string, string>()

						for (const step of plan.copies) {
							const item = guestItems.get(step.source.id)!

							const created = await tx.quoteBasketItem.create({
								data: {
									basketId: mine!.id,
									variantId: item.variantId,
									quantity: item.quantity,
									parentItemId: step.parentSourceId
										? (moved.get(step.parentSourceId) ?? null)
										: null,
									note: item.note,
									files: {
										create: item.files.map((f, index) => ({
											assetId: f.assetId,
											sortOrder: index,
										})),
									},
								},
							})

							moved.set(item.id, created.id)
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
	return basketView(fresh!, locale, await loadFollowingLines(fresh!.items))
}

const getBasket = async (owner: BasketOwner, locale: LocaleCode) => {
	const { basket, token } = await resolveBasket(owner)
	return { basket: basketView(basket, locale, await loadFollowingLines(basket.items)), token }
}

const addItem = async (
	owner: BasketOwner,
	payload: { variantId: string; quantity: number; note?: string; assetIds?: string[] },
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

	const assetIds = payload.assetIds ?? []

	// Same rule as the cart: a line carrying a drawing is its own line, and so
	// is one configured with options — or an option line itself.
	const existing = assetIds.length
		? undefined
		: basket.items.find(
				(i) =>
					i.variantId === payload.variantId &&
					i.files.length === 0 &&
					!i.parentItemId &&
					!basket.items.some((o) => o.parentItemId === i.id)
			)

	if (existing) {
		await prisma.quoteBasketItem.update({
			where: { id: existing.id },
			data: {
				quantity: existing.quantity + payload.quantity,
				...(payload.note !== undefined ? { note: payload.note } : {}),
			},
		})
	} else {
		ArtworkService.refuse(checkArtwork(readInquiryArtworkRules(variant.product), assetIds.length))
		const assets = await ArtworkService.assertOwned(assetIds, owner.userId)

		await prisma.quoteBasketItem.create({
			data: {
				basketId: basket.id,
				variantId: payload.variantId,
				quantity: payload.quantity,
				note: payload.note ?? null,
				files: {
					create: assets.map((asset, index) => ({ assetId: asset.id, sortOrder: index })),
				},
			},
		})
	}

	await prisma.quoteBasket.update({
		where: { id: basket.id },
		data: { expiresAt: basket.userId ? null : expiry() },
	})

	return { basket: await reload(basket.id, locale), token }
}

/**
 * An inquiry product with the options the customer ticked, in one go.
 *
 * The product page used to send only the product: an inquiry configured with an
 * engraving and a box reached staff as a bare product, the options silently
 * gone. Written in one transaction, like the cart's configurator, so the
 * product never arrives without what it was configured with.
 *
 * Checked by the configurator's own loader — every option must genuinely be
 * offered with this product, and one that follows the main quantity is ordered
 * in it whatever was posted — and against each line's minimum, which is the
 * basket's first gate (R4). No price is asked for: that is the point of an
 * inquiry.
 */
const addConfiguration = async (
	owner: BasketOwner,
	payload: { variantId: string; quantity: number; options: { variantId: string; quantity: number }[] },
	locale: LocaleCode
) => {
	const { basket, token } = await resolveBasket(owner)

	const { main, chosen, quantity } = await BundleService.loadConfiguration(
		payload.variantId,
		payload.options,
		locale,
		payload.quantity
	)

	for (const line of [
		{ variant: main, quantity },
		...chosen.map((option) => ({ variant: option.variant, quantity: option.quantity })),
	]) {
		const moq = getEffectiveMoq({ productMoq: line.variant.product.moq, variantMoq: line.variant.moq })
		if (isBelowMoq(line.quantity, moq)) {
			throw new ApiError(httpStatus.BAD_REQUEST, "Below the minimum order quantity", {
				messageKey: "quote.belowMoq",
				messageVars: { moq: String(moq), quantity: String(line.quantity) },
			})
		}
	}

	await prisma.$transaction(async (tx) => {
		const parent = await tx.quoteBasketItem.create({
			// The posted quantity, raised to fill whole packs — see loadConfiguration.
			data: { basketId: basket.id, variantId: main.id, quantity },
		})

		for (const option of chosen) {
			await tx.quoteBasketItem.create({
				data: {
					basketId: basket.id,
					variantId: option.variant.id,
					quantity: option.quantity,
					// Cascades, so removing the product removes its options.
					parentItemId: parent.id,
				},
			})
		}

		await tx.quoteBasket.update({
			where: { id: basket.id },
			data: { expiresAt: basket.userId ? null : expiry() },
		})
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

	const following = await loadFollowingLines(basket.items)

	// An option that follows its product keeps the product's quantity; its note
	// is still the customer's to write.
	if (following.has(item.id)) {
		const parent = basket.items.find((i) => i.id === item.parentItemId)

		await prisma.quoteBasketItem.update({
			where: { id: itemId },
			data: {
				quantity: parent
					? followingQuantity(parent.quantity, following.get(item.id) ?? 1)
					: item.quantity,
				...(payload.note !== undefined ? { note: payload.note } : {}),
			},
		})

		return { basket: await reload(basket.id, locale), token, adjusted: false }
	}

	const moq = getEffectiveMoq({
		productMoq: item.variant.product.moq,
		variantMoq: item.variant.moq,
	})

	// R4, gate 2 of 3: raise on update, and say so.
	const { quantity, adjusted } = applyMoqFloor(payload.quantity, moq)

	const followers = basket.items.filter((i) => i.parentItemId === item.id && following.has(i.id))

	// Raised again to fill whole packs, as the configurator and the cart do.
	const packed = packedMainQuantity(
		quantity,
		followers.map((follower) => following.get(follower.id) ?? 1)
	)

	await prisma.$transaction([
		prisma.quoteBasketItem.update({
			where: { id: itemId },
			data: { quantity: packed, ...(payload.note !== undefined ? { note: payload.note } : {}) },
		}),
		// Options that follow this product move with it — one for one, or one per
		// box of four.
		...followers.map((follower) =>
			prisma.quoteBasketItem.update({
				where: { id: follower.id },
				data: { quantity: followingQuantity(packed, following.get(follower.id) ?? 1) },
			})
		),
	])

	return { basket: await reload(basket.id, locale), token, adjusted: adjusted || packed !== quantity }
}

const removeItem = async (owner: BasketOwner, itemId: string, locale: LocaleCode) => {
	const { basket, token } = await resolveBasket(owner)

	if (!basket.items.some((i) => i.id === itemId)) {
		throw new ApiError(httpStatus.NOT_FOUND, "That line is not in your basket", {
			messageKey: "quote.itemNotFound",
		})
	}

	// Option lines cascade with their product — the database FK handles it.
	await prisma.quoteBasketItem.delete({ where: { id: itemId } })
	return { basket: await reload(basket.id, locale), token }
}

const clearBasket = async (owner: BasketOwner, locale: LocaleCode) => {
	const { basket, token } = await resolveBasket(owner)
	await prisma.quoteBasketItem.deleteMany({ where: { basketId: basket.id } })
	return { basket: await reload(basket.id, locale), token }
}

// ── submission ───────────────────────────────────────────────────────────────

/**
 * Each product followed by its options, so every reader — the thread, the
 * dashboard, both mails — shows an engraving directly under its cutter.
 */
const groupedLines = <T extends { id: string; parentItemId: string | null }>(items: T[]): T[] => {
	const ids = new Set(items.map((i) => i.id))
	const isOption = (i: T) => !!i.parentItemId && ids.has(i.parentItemId)

	return items
		.filter((i) => !isOption(i))
		.flatMap((parent) => [parent, ...items.filter((o) => o.parentItemId === parent.id)])
}

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
		salutation: row.contactSalutation,
		firstName: row.contactFirstName,
		lastName: row.contactLastName,
		/*
		 * The address, which staff need in order to price the thing.
		 *
		 * Shown to the customer too — it is what they typed, and a thread that
		 * hides half the enquiry back from the person who sent it reads as if
		 * something was lost.
		 */
		street: row.contactStreet,
		houseNumber: row.contactHouseNumber,
		postcode: row.contactPostcode,
		city: row.contactCity,
		countryCode: row.contactCountryCode,
	},
	expiresAt: row.expiresAt,
	quotedSubtotal: row.quotedSubtotal?.toFixed(2) ?? null,
	currency: row.quotedCurrency,
	submittedAt: row.submittedAt,
	answeredAt: row.answeredAt,
	items: groupedLines(row.items).map((i) => ({
		id: i.id,
		/// The product line this option was asked for with; null for a product.
		parentItemId: i.parentItemId,
		sku: i.sku,
		name: i.name,
		attributes: i.attributes,
		quantity: i.quantity,
		moq: i.moqAtSubmission,
		note: i.note,
		// Frozen at submission. assetId is null once the upload is deleted,
		// but the record still says what was sent.
		files: i.files.map((f) => ({
			id: f.id,
			assetId: f.assetId,
			name: f.fileName,
		})),
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

/**
 * A subject line, written from the basket.
 *
 * The client had the form open with a "Betreff" box and asked for it to go:
 * somebody who has just filled a basket has already said what they want, and
 * being made to summarise it again is a required field standing between them
 * and sending. Staff still need something readable in a list of forty threads,
 * so it is composed here instead of demanded there.
 *
 * Names the first line and counts the rest — "Backblech 60 × 40 cm +2 weitere"
 * — because the first line is what the enquiry is usually about and the count
 * is what tells staff how big it is.
 */
/**
 * Every drawing on the basket, as something the mailer can enclose.
 *
 * Deduplicated by asset. A customer who attaches the same logo to three lines
 * has sent one file three times, and three identical attachments are three
 * chances to cut from the wrong copy of the same thing — the lines still list
 * it individually in the dashboard, where the association is what matters.
 */
const attachableFiles = (items: BasketRow["items"]): AttachableFile[] => {
	const seen = new Set<string>()
	const files: AttachableFile[] = []

	for (const item of items) {
		for (const { asset } of item.files) {
			if (seen.has(asset.id)) continue
			seen.add(asset.id)

			files.push({
				fileName: asset.originalName,
				sizeBytes: asset.sizeBytes,
				mimeType: asset.mimeType,
				read: () => storage.get(asset.storageKey, asset.visibility),
			})
		}
	}

	return files
}

const titleFromBasket = (
	items: { variant: { product: { translations: { locale: string; name: string }[] }; sku: string | null } }[],
	locale: LocaleCode
): string => {
	const first =
		pick(items[0]!.variant.product.translations, locale)?.name ??
		items[0]!.variant.sku ??
		"Anfrage"

	const rest = items.length - 1
	const title = rest > 0 ? `${first} +${rest}` : first

	// The column takes 200; a product name can be longer than that on its own.
	return title.length > 200 ? `${title.slice(0, 197)}…` : title
}

const submit = async (
	owner: BasketOwner & { user?: { email: string; firstName: string | null; lastName: string | null; company: string | null; phone: string | null } },
	payload: {
		title?: string
		message?: string
		contactName?: string
		contactEmail?: string
		contactPhone?: string
		contactCompany?: string
		contactSalutation?: string
		contactFirstName?: string
		contactLastName?: string
		contactStreet?: string
		contactHouseNumber?: string
		contactPostcode?: string
		contactCity?: string
		contactCountryCode?: string
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

		// A quote for a shape nobody has seen cannot be priced. Checked here
		// rather than in the form because a basket may sit half-specified.
		const artwork = checkArtworkComplete(
			readInquiryArtworkRules(item.variant.product),
			item.files.length
		)
		if (artwork) {
			ArtworkService.refuse(artwork)
		}
	}

	/*
	 * One name, composed rather than typed.
	 *
	 * The form asks for a first and last name separately, which is what a
	 * delivery label needs — but every reader of a quote wants the whole name:
	 * the greeting in the confirmation, the staff list, the thread header. So
	 * the parts are stored and the whole is stored with them, and nothing
	 * downstream has to know the form was split.
	 *
	 * Falls back to `contactName` for anything still sending the old shape, and
	 * to the account for a signed-in customer who sent neither.
	 */
	const contactName =
		[payload.contactFirstName, payload.contactLastName].filter(Boolean).join(" ").trim() ||
		payload.contactName ||
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
				// Named from the products, not their options: "Ausstecher +2" should
				// count the things enquired about, not the engraving on each.
				title:
					payload.title?.trim() ||
					titleFromBasket(
						basket.items.filter((i) => !i.parentItemId),
						locale
					),
				message: payload.message ?? null,

				contactSalutation: payload.contactSalutation ?? null,
				contactFirstName: payload.contactFirstName ?? owner.user?.firstName ?? null,
				contactLastName: payload.contactLastName ?? owner.user?.lastName ?? null,
				contactStreet: payload.contactStreet ?? null,
				contactHouseNumber: payload.contactHouseNumber ?? null,
				contactPostcode: payload.contactPostcode ?? null,
				contactCity: payload.contactCity ?? null,
				contactCountryCode: payload.contactCountryCode ?? null,
				locale,
				...(payload.message
					? {
							messages: {
								create: [{ author: "CUSTOMER", authorUserId: owner.userId ?? null, body: payload.message }],
							},
						}
					: {}),
			},
		})

		/*
		 * The lines, frozen. One at a time and parents first, so an option keeps
		 * pointing at the product it was asked for with — a nested create cannot
		 * point one row at a sibling it is creating in the same call.
		 */
		const requestLineFor = new Map<string, string>()
		const basketIds = new Set(basket.items.map((i) => i.id))
		const isOption = (i: BasketRow["items"][number]) => !!i.parentItemId && basketIds.has(i.parentItemId)

		for (const item of [...basket.items.filter((i) => !isOption(i)), ...basket.items.filter(isOption)]) {
			const line = await tx.quoteRequestItem.create({
				data: {
					quoteId: quote.id,
					parentItemId: isOption(item) ? (requestLineFor.get(item.parentItemId!) ?? null) : null,
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
					files: {
						create: item.files.map((f, index) => ({
							assetId: f.assetId,
							fileName: f.asset.originalName,
							sortOrder: index,
						})),
					},
				},
			})

			requestLineFor.set(item.id, line.id)
		}

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
	/*
	 * Everything the form asked for, carried into both mails.
	 *
	 * The client's complaint: the enquiry form collects a company, an address
	 * and a phone number and neither mail mentioned any of it, so staff opened
	 * the dashboard for every enquiry to find out where it was from — which is
	 * the first thing needed to price anything.
	 */
	const contact = {
		salutation: full!.contactSalutation,
		firstName: full!.contactFirstName,
		lastName: full!.contactLastName,
		name: full!.contactName,
		company: full!.contactCompany,
		street: full!.contactStreet,
		houseNumber: full!.contactHouseNumber,
		postcode: full!.contactPostcode,
		city: full!.contactCity,
		countryCode: full!.contactCountryCode,
		phone: full!.contactPhone,
		email: full!.contactEmail,
		message: full!.message,
	}

	// An option reads as belonging to the product above it in both mails.
	const items = view.items.map((i) => ({
		name: i.parentItemId ? `+ ${i.name}` : i.name,
		quantity: i.quantity,
	}))

	/*
	 * The drawings, ready to travel with the notification.
	 *
	 * Taken from the basket rows still in memory rather than re-read from the
	 * request: the ordering here is the customer's own — line by line, and
	 * within a line the order they arranged the files in — and the first
	 * drawing on the first line is the one production opens first.
	 *
	 * The bytes are not fetched now. `read` is called on the send path, so a
	 * customer pressing submit does not wait for their own upload to be pulled
	 * back out of the bucket for somebody else's inbox.
	 */
	const files = attachableFiles(basket.items)

	await sendQuoteSubmitted({
		to: full!.contactEmail,
		locale: full!.locale as LocaleCode,
		quoteNumber: view.quoteNumber,
		contactName: full!.contactName,
		title: full!.title,
		items,
		contact,
		files,
		accessToken,
	})

	await notifyStaffOfQuote({
		locale: full!.locale as LocaleCode,
		quoteId: full!.id,
		quoteNumber: view.quoteNumber,
		title: full!.title,
		items,
		contact,
		files,
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
	addConfiguration,
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
