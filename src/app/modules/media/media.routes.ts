import { Router } from "express"
import multer from "multer"
import { MAX_FILE_BYTES } from "./media.constant"
import { auth } from "../../middlewares/auth"
import { uploadLimiter } from "../../middlewares/rateLimiter"
import { validateRequest } from "../../middlewares/validateRequest"
import { MediaController } from "./media.controller"
import { MediaValidation } from "./media.validation"

/**
 * Memory storage, never disk. The buffer goes straight to sharp and then to the
 * bucket, so nothing untrusted is ever written to the server's filesystem — and
 * there is no temp directory to fill up or forget to clean.
 */
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: MAX_FILE_BYTES, files: 1 },
})

const router = Router()

router.get(
	"/",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(MediaValidation.listSchema),
	MediaController.list
)

router.post(
	"/images",
	auth("ADMIN", "SHOP_MANAGER"),
	uploadLimiter,
	upload.single("file"),
	MediaController.uploadImage
)

// Customer design files. Any signed-in customer may upload their own artwork —
// rate limited, because this is the one endpoint where a request costs the shop
// storage rather than a moment of CPU.
router.post("/files", auth(), uploadLimiter, upload.single("file"), MediaController.uploadFile)

router.get(
	"/:id/url",
	auth(),
	validateRequest(MediaValidation.idSchema),
	MediaController.signedUrl
)

router.patch(
	"/:id",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(MediaValidation.updateSchema),
	MediaController.updateMeta
)

router.delete(
	"/:id",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(MediaValidation.idSchema),
	MediaController.remove
)

router.get("/folders/all", auth("ADMIN", "SHOP_MANAGER"), MediaController.listFolders)

router.post(
	"/folders",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(MediaValidation.createFolderSchema),
	MediaController.createFolder
)

router.delete(
	"/folders/:id",
	auth("ADMIN", "SHOP_MANAGER"),
	validateRequest(MediaValidation.idSchema),
	MediaController.removeFolder
)

// Signature-checked, so no auth middleware — the link itself is the credential.
router.get("/download/:key", MediaController.downloadLocal)

export const MediaRoutes = router
export default router
