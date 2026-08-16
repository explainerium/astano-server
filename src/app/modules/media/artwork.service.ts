import {
	checkArtwork,
	readArtworkRules,
	type ArtworkProblem,
} from "../../../domain/product/artwork"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { storage } from "../../../helpers/storage"
import { SIGNED_URL_TTL_SECONDS } from "./media.constant"
import ApiError from "../../errors/ApiError"

/**
 * Customer artwork on a basket line.
 *
 * Two rules run on every attachment and neither is optional:
 *
 *  1. The file must have been uploaded by the account attaching it. Asset ids
 *     are guessable in the sense that any signed-in customer could send one,
 *     and a drawing is exactly the sort of thing a competitor would like to
 *     read. `Asset.uploadedById` exists for this check alone.
 *
 *  2. The product must accept that many files. The form limits it too, but the
 *     form is not what protects production from a line with forty attachments.
 */

export interface ArtworkFile {
	id: string
	name: string
	sizeBytes: number
	uploadedAt: Date
}

const toFile = (asset: {
	id: string
	originalName: string
	sizeBytes: number
	createdAt: Date
}): ArtworkFile => ({
	id: asset.id,
	name: asset.originalName,
	sizeBytes: asset.sizeBytes,
	uploadedAt: asset.createdAt,
})

/**
 * Checks the ids exist and belong to this account, in one query.
 *
 * Returns them in the order asked for, because that is the order the customer
 * arranged them in and the first file is the one production looks at first.
 */
const assertOwned = async (assetIds: string[], userId: string | undefined) => {
	if (!assetIds.length) return []

	if (!userId) {
		throw new ApiError(httpStatus.UNAUTHORIZED, "Sign in to attach a file", {
			messageKey: "artwork.signInRequired",
		})
	}

	const unique = [...new Set(assetIds)]

	const assets = await prisma.asset.findMany({
		where: { id: { in: unique }, uploadedById: userId },
		select: { id: true, originalName: true, sizeBytes: true, createdAt: true },
	})

	if (assets.length !== unique.length) {
		// Deliberately the same error whether the file does not exist or belongs
		// to somebody else — the difference is not the caller's business.
		throw new ApiError(httpStatus.NOT_FOUND, "One of those files is not yours", {
			messageKey: "artwork.notYours",
		})
	}

	const byId = new Map(assets.map((a) => [a.id, a]))
	return unique.map((id) => byId.get(id)!)
}

/** The product's rules, reached from whichever variant the line points at. */
const rulesForVariant = async (variantId: string) => {
	const variant = await prisma.productVariant.findUnique({
		where: { id: variantId },
		select: { product: { select: { artworkMaxFiles: true, artworkRequired: true } } },
	})

	return readArtworkRules(variant?.product)
}

const refuse = (problem: ArtworkProblem | null) => {
	if (!problem) return

	if (problem.kind === "REQUIRED") {
		throw new ApiError(httpStatus.CONFLICT, "This product needs a file", {
			messageKey: "artwork.required",
		})
	}

	if (problem.kind === "NOT_ACCEPTED") {
		throw new ApiError(httpStatus.CONFLICT, "This product does not take file uploads", {
			messageKey: "artwork.notAccepted",
		})
	}

	throw new ApiError(httpStatus.CONFLICT, "Too many files for this product", {
		messageKey: "artwork.tooMany",
		messageVars: { max: String(problem.max) },
	})
}

/**
 * Replaces the files on a line.
 *
 * Replace rather than add: the customer edits a set, and an add-only API makes
 * "remove the one I attached by mistake" a second endpoint nobody builds.
 */
/**
 * Whether this caller owns the basket a line sits in.
 *
 * Two kinds of basket, two kinds of proof. A claimed one belongs to an account
 * and the token is gone; an anonymous one is addressed only by the httpOnly
 * cookie the visitor holds, and that cookie is the whole of its identity.
 *
 * Testing only `owner.userId && owner.userId !== userId` — which is what this
 * used to do — reads as "a guest basket belongs to nobody, so let anyone at
 * it": any signed-in customer could attach files to a stranger's line if they
 * ever learnt its id. Absent proof is not proof.
 */
const ownsBasket = (
	owner: { userId: string | null; token: string | null },
	caller: { userId?: string; token?: string }
): boolean =>
	owner.userId ? owner.userId === caller.userId : Boolean(owner.token) && owner.token === caller.token

const setCartItemFiles = async (
	cartItemId: string,
	assetIds: string[],
	userId: string | undefined,
	/** The guest cart cookie, so an unclaimed cart can still prove it is theirs. */
	cartToken?: string
): Promise<ArtworkFile[]> => {
	const item = await prisma.cartItem.findUnique({
		where: { id: cartItemId },
		select: { id: true, variantId: true, cart: { select: { userId: true, token: true } } },
	})

	if (!item) {
		throw new ApiError(httpStatus.NOT_FOUND, "That line is not in your cart", {
			messageKey: "cart.itemNotFound",
		})
	}

	// The line has to be the caller's as well as the files.
	if (!ownsBasket(item.cart, { userId, token: cartToken })) {
		throw new ApiError(httpStatus.NOT_FOUND, "That line is not in your cart", {
			messageKey: "cart.itemNotFound",
		})
	}

	refuse(checkArtwork(await rulesForVariant(item.variantId), assetIds.length))

	const assets = await assertOwned(assetIds, userId)

	await prisma.$transaction([
		prisma.cartItemFile.deleteMany({ where: { cartItemId } }),
		prisma.cartItemFile.createMany({
			data: assets.map((asset, index) => ({ cartItemId, assetId: asset.id, sortOrder: index })),
		}),
	])

	return assets.map(toFile)
}

const setBasketItemFiles = async (
	basketItemId: string,
	assetIds: string[],
	userId: string | undefined,
	/** The guest basket cookie — same reasoning as the cart above. */
	basketToken?: string
): Promise<ArtworkFile[]> => {
	const item = await prisma.quoteBasketItem.findUnique({
		where: { id: basketItemId },
		select: { id: true, variantId: true, basket: { select: { userId: true, token: true } } },
	})

	if (!item) {
		throw new ApiError(httpStatus.NOT_FOUND, "That line is not in your basket", {
			messageKey: "quote.itemNotFound",
		})
	}

	if (!ownsBasket(item.basket, { userId, token: basketToken })) {
		throw new ApiError(httpStatus.NOT_FOUND, "That line is not in your basket", {
			messageKey: "quote.itemNotFound",
		})
	}

	refuse(checkArtwork(await rulesForVariant(item.variantId), assetIds.length))

	const assets = await assertOwned(assetIds, userId)

	await prisma.$transaction([
		prisma.quoteBasketItemFile.deleteMany({ where: { basketItemId } }),
		prisma.quoteBasketItemFile.createMany({
			data: assets.map((asset, index) => ({ basketItemId, assetId: asset.id, sortOrder: index })),
		}),
	])

	return assets.map(toFile)
}

/**
 * A time-limited link to a stored file.
 *
 * Artwork is uploaded to the private bucket, so there is no public URL to hand
 * out — and there should not be: a customer's drawing is theirs. Staff may read
 * any of it, a customer only their own.
 */
const downloadUrl = async (
	assetId: string,
	viewer: { userId?: string; isStaff: boolean }
): Promise<string> => {
	const asset = await prisma.asset.findUnique({
		where: { id: assetId },
		select: { storageKey: true, uploadedById: true, visibility: true },
	})

	if (!asset) {
		throw new ApiError(httpStatus.NOT_FOUND, "File not found", { messageKey: "media.notFound" })
	}

	// A public asset is public — product images come through here too, and
	// there is nothing to protect on one.
	if (asset.visibility === "PUBLIC") return storage.publicUrl(asset.storageKey)

	if (!viewer.isStaff && asset.uploadedById !== viewer.userId) {
		throw new ApiError(httpStatus.NOT_FOUND, "File not found", { messageKey: "media.notFound" })
	}

	return storage.signedUrl(asset.storageKey, SIGNED_URL_TTL_SECONDS)
}

export const ArtworkService = {
	setCartItemFiles,
	setBasketItemFiles,
	downloadUrl,
	assertOwned,
	rulesForVariant,
	refuse,
	toFile,
}
