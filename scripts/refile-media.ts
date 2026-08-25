/**
 * Puts surviving images back in the folder the client filed them in.
 *
 * Removing the duplicates had a side effect nobody would have predicted from
 * the counts: where the copy that got deleted was the *filed* one and the copy
 * that survived was an unfiled product image, the picture stayed in the library
 * but left its folder. One folder — Ausstechformen Edelstahl — emptied
 * completely that way, even though all four of its pictures are still here.
 *
 * The folders are the client's own work, so this restores them from the same
 * source the import read: the `media_folder` taxonomy in the WordPress dump,
 * matched on filename.
 *
 * Only ever *adds* a folder to something unfiled. An asset the shop has already
 * filed somewhere is left alone — the dump is a record of what WordPress
 * thought, not an authority over what has been decided since.
 *
 *   npx tsx scripts/refile-media.ts --dry-run
 *   npx tsx scripts/refile-media.ts
 */
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { prisma } from "../src/shared/prisma"

const DUMP = "C:/Users/mdrab/Local Sites/astano-v2/app/sql/local.sql"
const DRY_RUN = process.argv.includes("--dry-run")

const splitRows = (line: string): string[] => {
	const start = line.indexOf("VALUES ")
	if (start < 0) return []

	const out: string[] = []
	let depth = 0
	let current = ""
	let quoted = false
	let escaped = false

	for (let i = start + 7; i < line.length; i++) {
		const c = line[i]!
		if (escaped) {
			current += c
			escaped = false
			continue
		}
		if (quoted) {
			if (c === "\\") escaped = true
			else if (c === "'") quoted = false
			current += c
			continue
		}
		if (c === "'") {
			quoted = true
			current += c
			continue
		}
		if (c === "(" && ++depth === 1) {
			current = ""
			continue
		}
		if (c === ")" && --depth === 0) {
			out.push(current)
			continue
		}
		if (depth > 0) current += c
	}

	return out
}

const splitColumns = (row: string): string[] => {
	const out: string[] = []
	let current = ""
	let quoted = false
	let escaped = false

	for (const c of row) {
		if (escaped) {
			current += c === "n" ? "\n" : c
			escaped = false
			continue
		}
		if (c === "\\") {
			escaped = true
			continue
		}
		if (c === "'") {
			quoted = !quoted
			continue
		}
		if (c === "," && !quoted) {
			out.push(current)
			current = ""
			continue
		}
		current += c
	}

	out.push(current)
	return out
}

const decodeEntities = (v: string): string =>
	v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')

/** filename (lowercased) → the folder the client filed it in. */
const readFiling = async (): Promise<Map<string, string>> => {
	const folderTerm = new Map<string, string>()
	const termName = new Map<string, string>()
	const members = new Map<string, string[]>()
	const attachmentFile = new Map<string, string>()

	const rl = createInterface({ input: createReadStream(DUMP), crlfDelay: Infinity })

	for await (const line of rl) {
		if (line.startsWith("INSERT INTO `wp_term_taxonomy`")) {
			for (const row of splitRows(line)) {
				const c = splitColumns(row)
				if (c[2] === "media_folder") folderTerm.set(c[0]!, c[1]!)
			}
		} else if (line.startsWith("INSERT INTO `wp_terms`")) {
			for (const row of splitRows(line)) {
				const c = splitColumns(row)
				termName.set(c[0]!, c[1]!)
			}
		} else if (line.startsWith("INSERT INTO `wp_term_relationships`")) {
			for (const row of splitRows(line)) {
				const c = splitColumns(row)
				if (!members.has(c[1]!)) members.set(c[1]!, [])
				members.get(c[1]!)!.push(c[0]!)
			}
		} else if (line.startsWith("INSERT INTO `wp_postmeta`")) {
			for (const row of splitRows(line)) {
				const c = splitColumns(row)
				if (c[2] === "_wp_attached_file") attachmentFile.set(c[1]!, c[3]!)
			}
		}
	}

	const filing = new Map<string, string>()
	for (const [ttid, termId] of folderTerm) {
		const folder = decodeEntities(termName.get(termId) ?? "")
		for (const id of members.get(ttid) ?? []) {
			const file = attachmentFile.get(id)
			if (file) filing.set(file.split("/").pop()!.toLowerCase(), folder)
		}
	}

	return filing
}

const main = async () => {
	const filing = await readFiling()
	console.log(`${filing.size} filed attachments in the dump`)

	const folders = await prisma.mediaFolder.findMany({ select: { id: true, name: true } })
	const folderId = new Map(folders.map((f) => [f.name, f.id]))

	const unfiled = await prisma.asset.findMany({
		where: { folderId: null },
		select: { id: true, originalName: true },
	})

	const moves: { id: string; name: string; folder: string }[] = []
	for (const a of unfiled) {
		const folder = filing.get((a.originalName ?? "").toLowerCase())
		if (folder && folderId.has(folder)) {
			moves.push({ id: a.id, name: a.originalName ?? "", folder })
		}
	}

	console.log(`${unfiled.length} unfiled assets, ${moves.length} of them belong in a folder\n`)

	const perFolder = new Map<string, number>()
	for (const m of moves) perFolder.set(m.folder, (perFolder.get(m.folder) ?? 0) + 1)
	for (const [folder, n] of [...perFolder.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${String(n).padStart(3)}  → ${folder}`)
	}

	if (DRY_RUN) return

	for (const m of moves) {
		await prisma.asset.update({ where: { id: m.id }, data: { folderId: folderId.get(m.folder)! } })
	}

	console.log(`\nfiled ${moves.length}`)
}

void main().finally(() => prisma.$disconnect())
