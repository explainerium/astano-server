import { Prisma } from "@prisma/client"
import { httpStatus } from "../../shared/httpStatus"

/**
 * Translates Prisma's internal errors into something a shop admin can act on.
 *
 * Prisma's own messages embed file paths, line numbers and a stack — useful in
 * a terminal, wrong in an HTTP response. They tell the reader nothing they can
 * fix and hand an attacker the server's directory layout.
 */

/** Field names as they appear in the schema → wording a human would use. */
const FIELD_LABELS: Record<string, string> = {
	sku: "SKU",
	email: "email address",
	slug: "URL slug",
	storageKey: "file",
	code: "code",
	tokenHash: "token",
}

const labelFor = (field: string): string => FIELD_LABELS[field] ?? field

const targetFields = (meta: unknown): string[] => {
	const target = (meta as { target?: unknown } | undefined)?.target

	if (Array.isArray(target)) return target.map(String)
	if (typeof target === "string") {
		// PostgreSQL hands back an index name like "product_variants_sku_key".
		const match = /_([a-zA-Z0-9]+)_key$/.exec(target)
		return match?.[1] ? [match[1]] : [target]
	}

	return []
}

export interface TranslatedPrismaError {
	statusCode: number
	messageKey: string
	messageVars: Record<string, string>
	fallback: string
}

export const translatePrismaError = (error: unknown): TranslatedPrismaError | null => {
	if (error instanceof Prisma.PrismaClientValidationError) {
		return {
			statusCode: httpStatus.BAD_REQUEST,
			messageKey: "error.invalidData",
			messageVars: {},
			fallback: "Some of the submitted data is not in the expected format.",
		}
	}

	if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null

	switch (error.code) {
		case "P2002": {
			const fields = targetFields(error.meta)
			const label = fields.map(labelFor).join(", ")

			return {
				statusCode: httpStatus.CONFLICT,
				messageKey: fields.length ? "error.duplicateField" : "error.duplicate",
				messageVars: { field: label },
				fallback: label
					? `Another record already uses that ${label}.`
					: "Another record with these details already exists.",
			}
		}

		case "P2003":
			return {
				statusCode: httpStatus.BAD_REQUEST,
				messageKey: "error.relatedNotFound",
				messageVars: {},
				fallback: "Something you linked to does not exist. Please check your selection.",
			}

		case "P2025":
			return {
				statusCode: httpStatus.NOT_FOUND,
				messageKey: "error.recordNotFound",
				messageVars: {},
				fallback: "That record no longer exists. It may have been deleted.",
			}

		case "P2014":
			return {
				statusCode: httpStatus.CONFLICT,
				messageKey: "error.relationConflict",
				messageVars: {},
				fallback: "This change would break a link to another record.",
			}

		/*
		 * The transaction ran out of time.
		 *
		 * Named rather than left to the default, because the default is a lie
		 * here: nothing was rejected. The database was still willing, the work
		 * simply took longer than the transaction was allowed. Reported as
		 * "rejected", it sent us looking for a constraint violation in a product
		 * update that had none — the tier ladder just silently failed to save
		 * and the admin was told the data was bad.
		 *
		 * 408 rather than 400: this is a timeout, and retrying the same request
		 * unchanged is a reasonable thing for the caller to do.
		 */
		case "P2028":
			return {
				statusCode: httpStatus.REQUEST_TIMEOUT,
				messageKey: "error.transactionTimeout",
				messageVars: {},
				fallback: "That save took too long and was rolled back. Please try again.",
			}

		default:
			return {
				statusCode: httpStatus.BAD_REQUEST,
				messageKey: "error.databaseRejected",
				messageVars: {},
				fallback: "The database rejected this change.",
			}
	}
}
