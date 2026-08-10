import { storage } from "../../helpers/storage"

/**
 * An uploaded image as the storefront consumes it.
 *
 * One shape for every module that hands a picture to the frontend. Products and
 * categories both do, and when they disagreed the category grid quietly
 * rendered nothing: it asked for `image.srcset.grid` while the category API was
 * returning a bare id, and neither side was wrong on its own.
 */
export interface PublicAsset {
	id: string
	/** The original. Use a derivative where one exists — these can be megabytes. */
	url: string
	width: number | null
	height: number | null
	/** thumb · grid · detail · zoom, whichever were generated. */
	srcset: Record<string, string>
}

export interface AssetRow {
	id: string
	storageKey: string
	derivatives: unknown
	width: number | null
	height: number | null
}

export const toPublicAsset = (asset: AssetRow | null | undefined): PublicAsset | null => {
	if (!asset) return null

	const derivatives = (asset.derivatives ?? {}) as Record<string, string>

	return {
		id: asset.id,
		url: storage.publicUrl(asset.storageKey),
		width: asset.width,
		height: asset.height,
		srcset: Object.fromEntries(
			Object.entries(derivatives).map(([name, key]) => [name, storage.publicUrl(key)])
		),
	}
}

/** The smallest derivative that exists, for a thumbnail. Never the original. */
export const thumbOf = (asset: PublicAsset | null): string | null =>
	asset ? (asset.srcset.thumb ?? asset.srcset.grid ?? asset.url) : null
