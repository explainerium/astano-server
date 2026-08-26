import { describe, expect, it } from "vitest"
import {
	MAX_ATTACHED_BYTES,
	fileSize,
	planAttachments,
	readAttachments,
	withUniqueNames,
	type AttachableFile,
} from "../../src/helpers/mailer/attachments"

/**
 * What travels with the enquiry notification, asserted.
 *
 * The client asked for the customer's drawings to arrive attached rather than
 * behind a sign-in, and every failure mode here is silent: a cap that drops a
 * file the body still lists, two attachments with the same name overwriting
 * each other on "save all", one unreadable asset taking the others down with
 * it. None of that shows up in a preview — the message looks correct and
 * arrives missing the thing it was sent for.
 */

const file = (fileName: string, sizeBytes: number, content = "x"): AttachableFile => ({
	fileName,
	sizeBytes,
	mimeType: "image/vnd.dxf",
	read: async () => Buffer.from(content),
})

const MB = 1024 * 1024

describe("planAttachments", () => {
	it("encloses everything when the set fits", () => {
		const files = [file("a.dxf", 20_000), file("b.pdf", 400_000)]
		const plan = planAttachments(files)

		expect(plan.attached).toEqual(files)
		expect(plan.skipped).toEqual([])
	})

	it("skips what does not fit and keeps going", () => {
		// The 9 MB render must not push the 20 KB drawing behind it out of the
		// email — first-fit continues rather than stopping at the first refusal.
		const small = file("logo.dxf", 20_000)
		const huge = file("scan.pdf", 9 * MB)
		const alsoSmall = file("frame.dxf", 30_000)

		const plan = planAttachments([small, huge, huge, alsoSmall])

		expect(plan.attached.map((f) => f.fileName)).toEqual(["logo.dxf", "scan.pdf", "frame.dxf"])
		expect(plan.skipped.map((f) => f.fileName)).toEqual(["scan.pdf"])
	})

	it("always lets a single file through at the upload limit", () => {
		// The per-file upload ceiling is 10 MB and so is this one, so no file a
		// customer is allowed to upload can be one the email refuses on its own.
		const plan = planAttachments([file("max.stl", MAX_ATTACHED_BYTES)])

		expect(plan.attached).toHaveLength(1)
		expect(plan.skipped).toEqual([])
	})
})

describe("withUniqueNames", () => {
	it("numbers repeats and keeps the extension", () => {
		const named = withUniqueNames([
			file("logo.dxf", 1),
			file("logo.dxf", 2),
			file("logo.dxf", 3),
			file("readme", 4),
			file("readme", 5),
		])

		expect(named.map((f) => f.fileName)).toEqual([
			"logo.dxf",
			"logo (2).dxf",
			"logo (3).dxf",
			"readme",
			"readme (2)",
		])
	})

	it("leaves distinct names alone", () => {
		const files = [file("a.dxf", 1), file("b.dxf", 2)]
		expect(withUniqueNames(files).map((f) => f.fileName)).toEqual(["a.dxf", "b.dxf"])
	})
})

describe("readAttachments", () => {
	it("is undefined when there is nothing to send", () => {
		expect(readAttachments([])).toBeUndefined()
	})

	it("reads the bytes and carries the type", async () => {
		const attachments = await readAttachments([file("a.dxf", 1, "0\nEOF")])!()

		expect(attachments).toEqual([
			{ filename: "a.dxf", content: Buffer.from("0\nEOF"), contentType: "image/vnd.dxf" },
		])
	})

	it("keeps the files it can read when one is gone", async () => {
		// An asset deleted out from under the quote must cost the email that one
		// drawing, not all of them.
		const missing: AttachableFile = {
			fileName: "gone.dxf",
			sizeBytes: 10,
			read: async () => {
				throw new Error("NoSuchKey")
			},
		}

		const attachments = await readAttachments([file("here.dxf", 10), missing])!()

		expect(attachments.map((a) => a.filename)).toEqual(["here.dxf"])
	})
})

describe("fileSize", () => {
	it("reads in kilobytes below a megabyte", () => {
		// "0 MB" beside a 40 KB drawing tells nobody anything, which is the whole
		// reason this is not the existing megabytes() helper.
		expect(fileSize(40_000)).toBe("39 KB")
		expect(fileSize(120)).toBe("1 KB")
	})

	it("switches to megabytes at a megabyte", () => {
		expect(fileSize(MB)).toBe("1.0 MB")
		expect(fileSize(2.5 * MB)).toBe("2.5 MB")
	})
})
