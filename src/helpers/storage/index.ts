import { env } from "../../config"
import { logger } from "../../shared/logger"
import { localDriver } from "./localDriver"
import { r2Driver } from "./r2Driver"
import type { StorageDriver } from "./types"

export * from "./types"
export { verifyLocalSignature } from "./localDriver"

/**
 * Picks the driver from config. Set STORAGE_DRIVER=r2 with the R2_* variables
 * filled in to go live; leave it unset and everything lands in ./storage.
 */
const select = (): StorageDriver => {
	if (env.STORAGE_DRIVER === "r2") return r2Driver

	if (env.NODE_ENV === "production") {
		logger.warn(
			"STORAGE_DRIVER is not 'r2' in production — uploads are being written to local disk, which will not survive a redeploy"
		)
	}

	return localDriver
}

export const storage: StorageDriver = select()
