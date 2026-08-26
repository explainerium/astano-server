import { logger } from "../../shared/logger"
import type { MailAttachment } from "./transport"

/**
 * Customer files travelling inside an email.
 *
 * The client's request, in full: *"Email is good only upload as attachment
 * would be great."* The enquiry notification already carried everything the
 * form collected and a button through to the request — but the drawings, which
 * are the part production actually needs, stayed behind a sign-in. Whoever
 * prices the job wants them in the message they are already reading.
 *
 * The bytes are not held here. A file is a name, a size and a way to read it
 * later: sizes come out of the database, so what fits can be decided while the
 * message is composed, and the reading happens on the send path where a slow
 * bucket costs nobody a page load. It also keeps object storage out of this
 * module entirely — the enquiry passes a reader that talks to the bucket, a
 * preview passes one that returns a sample.
 */
export interface AttachableFile {
	fileName: string
	sizeBytes: number
	mimeType?: string
	read: () => Promise<Buffer>
}

/**
 * The ceiling on one message's attachments, in raw bytes.
 *
 * Ten megabytes, matching the per-file upload limit — so a single design file
 * always travels, whatever it is. Beyond that the arithmetic stops being ours:
 * MIME encodes attachments in base64, which is a third larger again, and the
 * limit that matters is the *recipient's* mail server, which is typically 20
 * to 25 MB and which we cannot see. A message refused for size is a
 * notification nobody gets — strictly worse than one that arrives listing two
 * files and carrying one, because that one still says an enquiry came in.
 *
 * An enquiry line takes up to six drawings, and a cutting drawing is vectors:
 * a DXF or a PDF of a logo is measured in kilobytes. Real enquiries are not
 * near this. What it guards against is the scan of a napkin at 40 megapixels.
 */
export const MAX_ATTACHED_BYTES = 10 * 1024 * 1024

export interface AttachmentPlan {
	/** Going in the envelope. */
	attached: AttachableFile[]
	/** Named in the body instead, with the dashboard link to fetch them from. */
	skipped: AttachableFile[]
}

/**
 * Decides what fits, in the order the customer arranged the files.
 *
 * First-fit rather than largest-first or a flat refusal: the first file on the
 * first line is the one production looks at first, and it should be the one
 * that travels. Deliberately keeps going past a file that does not fit — a
 * 9 MB render must not push a 20 KB DXF behind it out of the email.
 */
export const planAttachments = (files: AttachableFile[]): AttachmentPlan => {
	const attached: AttachableFile[] = []
	const skipped: AttachableFile[] = []
	let total = 0

	for (const file of files) {
		if (total + file.sizeBytes > MAX_ATTACHED_BYTES) {
			skipped.push(file)
			continue
		}

		total += file.sizeBytes
		attached.push(file)
	}

	return { attached, skipped }
}

/**
 * Turns a list into the thunk `sendMail` resolves.
 *
 * Settled rather than all-or-nothing: one asset deleted out from under the
 * quote must not strip the drawings that are still there. Returns undefined
 * for an empty list so callers can spread it without a conditional.
 */
export const readAttachments = (
	files: AttachableFile[]
): (() => Promise<MailAttachment[]>) | undefined => {
	if (!files.length) return undefined

	return async () => {
		const results = await Promise.allSettled(
			files.map(async (file): Promise<MailAttachment> => ({
				filename: file.fileName,
				content: await file.read(),
				...(file.mimeType ? { contentType: file.mimeType } : {}),
			}))
		)

		const ok: MailAttachment[] = []

		results.forEach((result, index) => {
			if (result.status === "fulfilled") {
				ok.push(result.value)
				return
			}

			logger.error(
				{ err: result.reason, file: files[index]!.fileName },
				"could not read a file to attach — the email goes without it"
			)
		})

		return ok
	}
}

/**
 * Two enquiry lines carrying `logo.dxf` arrive as two attachments called
 * `logo.dxf`.
 *
 * Most clients then either overwrite one with the other on "save all" or
 * silently append a number of their own choosing. Numbering them once, here,
 * means the name listed in the body and the name that lands on disk are the
 * same string — which is what lets somebody match an attachment back to the
 * line it belongs to.
 */
export const withUniqueNames = (files: AttachableFile[]): AttachableFile[] => {
	const seen = new Map<string, number>()

	return files.map((file) => {
		const count = (seen.get(file.fileName) ?? 0) + 1
		seen.set(file.fileName, count)

		if (count === 1) return file

		const dot = file.fileName.lastIndexOf(".")
		const [stem, extension] =
			dot > 0 ? [file.fileName.slice(0, dot), file.fileName.slice(dot)] : [file.fileName, ""]

		return { ...file, fileName: `${stem} (${count})${extension}` }
	})
}

/**
 * A file size somebody can read.
 *
 * Rounded to whole kilobytes below a megabyte, because that is the range every
 * real drawing lands in and "0.04 MB" tells nobody anything.
 */
export const fileSize = (bytes: number): string =>
	bytes >= 1024 * 1024
		? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
		: `${Math.max(1, Math.round(bytes / 1024))} KB`
