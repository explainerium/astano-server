import { Router } from "express"
import multer from "multer"
import { auth } from "../../middlewares/auth"
import { ProductIoController } from "./productIo.controller"

/**
 * In memory, not on disk: the file is parsed once and thrown away, and writing
 * a customer's catalogue to the filesystem of a container that may be replaced
 * mid-request buys nothing.
 *
 * 20 MB holds a catalogue far larger than this shop's — the live export of 55
 * products is 87 KB, so the limit is about refusing a mistake rather than
 * rationing a real file.
 */
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 20 * 1024 * 1024 },
})

const router = Router()

router.use(auth("ADMIN", "SHOP_MANAGER"))

router.get("/export", ProductIoController.exportCsv)
router.post("/analyse", upload.single("file"), ProductIoController.analyse)

/**
 * One route for the preview and the real thing, told apart by `dryRun`.
 *
 * Deliberately not two: a preview that runs different code from the import is a
 * preview that can be wrong, and the whole point of it is to be believed.
 */
router.post("/import", upload.single("file"), ProductIoController.run)

export const ProductIoRoutes = router
export default router
