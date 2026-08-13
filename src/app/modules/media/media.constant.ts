/**
 * Derivative sizes generated at upload.
 *
 * R2 has no transformation layer, unlike Cloudinary, so every size a page needs
 * has to exist as a real object. These match the sizes the old storefront
 * actually used (§9.6): a 150px thumbnail strip and a 920px quick-view, plus
 * grid and zoom sizes.
 *
 * WebP throughout — roughly 30% smaller than JPEG at the same quality, and
 * universally supported now.
 */
export const IMAGE_DERIVATIVES = [
	{ name: "thumb", width: 150 },
	{ name: "grid", width: 400 },
	{ name: "detail", width: 920 },
	{ name: "zoom", width: 1600 },
] as const

export const WEBP_QUALITY = 82

/** 10 MB is generous for a product photo and mean for an attack. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Design files are production input and can legitimately be large. */
/**
 * Sentinel for "media nobody filed".
 *
 * Unfiled assets have `folderId = null`, which cannot be expressed as a uuid,
 * and an absent folderId already means "no filter, show everything" — so
 * without this there is no way to ask the question at all.
 *
 * Deliberately not a real "Default" folder row: an admin could rename, move or
 * delete that, and every unfiled asset would then point at something that no
 * longer means what it did. Null cannot be renamed.
 */
export const UNFILED = "none"

/**
 * The ceiling on a customer's design file.
 *
 * Ten, not the fifty it was. A cutting drawing is vectors — a PDF or a DXF of a
 * logo is measured in kilobytes — so anything approaching this is a scan or a
 * render that production cannot use anyway, and accepting it only means a slow
 * upload on a phone and a large object nobody opens.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * A limit as text, derived rather than typed.
 *
 * The number is quoted in the error the customer sees and in the hint under the
 * upload button. A hand-written "50 MB" beside a constant that has since
 * changed is a lie no test can catch, and this file has carried one.
 */
export const megabytes = (bytes: number): string =>
	`${Math.round(bytes / (1024 * 1024))} MB`

export const ALLOWED_IMAGE_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/avif",
	"image/gif",
] as const

/**
 * Customer design-file formats, from the old storefront's upload field (R12).
 * An allow-list, never a block-list: a block-list is a promise to have thought
 * of everything.
 */
export const ALLOWED_FILE_EXTENSIONS = [
	".pdf",
	".eps",
	".ai",
	".stl",
	".stp",
	".step",
	".svg",
	".dxf",
] as const

export const SIGNED_URL_TTL_SECONDS = 5 * 60
