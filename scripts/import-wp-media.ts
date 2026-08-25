/**
 * Brings the WordPress media library across, once.
 *
 * The new shop's marketing pages still load their photographs from
 * `www.astano.de/wp-content/uploads/…`, which means the old site cannot be
 * switched off without breaking them. This moves every original into our own
 * library and storage, keeps the folders the client organised by hand, and
 * writes out a path→asset map so the hard-coded references can be repointed.
 *
 * Two things about WordPress make the file count misleading. It writes a
 * resized copy of every upload for each registered image size —
 * `name-300x200.jpg` and a dozen siblings — so five sixths of what is on disk
 * is generated and worth nothing to us; we make our own sizes. And its folders
 * are not folders: `custom-media-folders.php`, an mu-plugin on the live site,
 * stores them as a flat `media_folder` taxonomy on attachments, so the
 * structure the client sees lives in the database rather than in the tree.
 *
 * **Uploads through the API rather than writing to the bucket directly.**
 * Writing directly would need the storage access keys on whichever machine runs
 * this, and they deliberately live only on the deployment. Going through the
 * same endpoint the dashboard uses keeps them there, and means every file gets
 * exactly the treatment a hand-uploaded one does.
 *
 * Reads the SQL dump rather than the running database, so WordPress does not
 * need to be started. Idempotent: what has been imported is recorded in a map
 * file beside this script and skipped, so an interrupted run is resumed by
 * running it again.
 *
 *   npx tsx scripts/import-wp-media.ts              # everything, against live
 *   npx tsx scripts/import-wp-media.ts --pages      # only the marketing pages
 *   npx tsx scripts/import-wp-media.ts --local      # against localhost:5000
 *   npx tsx scripts/import-wp-media.ts --dry-run
 */
import {
	createReadStream,
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { createInterface } from "node:readline"
import path from "node:path"
import sharp from "sharp"

const UPLOADS = "C:/Users/mdrab/Local Sites/astano-v2/app/public/wp-content/uploads"
const DUMP = "C:/Users/mdrab/Local Sites/astano-v2/app/sql/local.sql"
const MAP_FILE = path.join(__dirname, "wp-media-map.json")

const YEARS = ["2025", "2026"]
const IMAGE = /\.(jpe?g|png|webp|gif|avif|svg)$/i
/** WordPress's own derivatives: name-800x600.jpg. */
const GENERATED = /-\d+x\d+\.[a-z]+$/i

/**
 * The platform caps a serverless request body well below our own image limit,
 * and nine of these originals are print-resolution stock photographs. Anything
 * larger is re-encoded first: the biggest size the shop renders is 1600px, so
 * 2400 loses nothing anybody will see.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

const argv = new Set(process.argv.slice(2))
const DRY_RUN = argv.has("--dry-run")
const PAGES_ONLY = argv.has("--pages")
/**
 * One folder at a time — `--folder "Motive Tiere"`.
 *
 * The marketing images belong to no folder at all, so importing them proved
 * the upload but not the filing. This exists so a single folder can be brought
 * across and checked before the other nine hundred follow it.
 */
const ONLY_FOLDER = [...argv].find((a) => a.startsWith("--folder="))?.slice(9)
const BASE = argv.has("--local")
	? "http://localhost:5000/api/v1"
	: "https://astano-server.vercel.app/api/v1"

const CREDENTIALS = {
	email: process.env.IMPORT_EMAIL ?? "explainerium@gmail.com",
	password: process.env.IMPORT_PASSWORD ?? "explainerium",
}

// ── the API ──────────────────────────────────────────────────────────────────

let token = ""
let tokenAt = 0
/** Access tokens last fifteen minutes and this run is longer than that. */
const TOKEN_TTL_MS = 10 * 60 * 1000

const authorise = async (): Promise<string> => {
	if (token && Date.now() - tokenAt < TOKEN_TTL_MS) return token

	const res = await fetch(`${BASE}/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(CREDENTIALS),
	})

	const body = (await res.json()) as { data?: { accessToken?: string } }
	const fresh = body?.data?.accessToken
	if (!fresh) throw new Error(`login failed (${res.status})`)

	token = fresh
	tokenAt = Date.now()
	return token
}

const api = async (endpoint: string, init: RequestInit = {}) => {
	const bearer = await authorise()
	const res = await fetch(`${BASE}${endpoint}`, {
		...init,
		headers: { ...(init.headers ?? {}), authorization: `Bearer ${bearer}` },
	})

	const text = await res.text()
	if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 160)}`)

	return text ? JSON.parse(text) : null
}

// ── the SQL dump ─────────────────────────────────────────────────────────────

/** `VALUES (…),(…);` → one string per row, quotes and escapes respected. */
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

/** One row → its columns, unquoted. */
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

const decodeEntities = (value: string): string =>
	value
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;/g, "'")

/** Folder name → the uploads-relative paths the client filed under it. */
const readFolders = async (): Promise<Map<string, string[]>> => {
	const folderTerm = new Map<string, string>() // term_taxonomy_id → term_id
	const termName = new Map<string, string>()
	const members = new Map<string, string[]>() // term_taxonomy_id → attachment ids
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

	const byName = new Map<string, string[]>()
	for (const [ttid, termId] of folderTerm) {
		const name = decodeEntities(termName.get(termId) ?? `folder ${termId}`)
		byName.set(
			name,
			(members.get(ttid) ?? [])
				.map((id) => attachmentFile.get(id))
				.filter((f): f is string => Boolean(f))
		)
	}

	return byName
}

// ── the files ────────────────────────────────────────────────────────────────

const walk = (dir: string, out: string[] = []): string[] => {
	if (!existsSync(dir)) return out
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry)
		if (statSync(full).isDirectory()) walk(full, out)
		else out.push(full)
	}
	return out
}

/** Uploads-relative, forward slashes — the form WordPress stores. */
const relative = (file: string): string =>
	file.replace(/\\/g, "/").split("/wp-content/uploads/")[1] ?? file

const MIME: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
	".gif": "image/gif",
	".avif": "image/avif",
	".svg": "image/svg+xml",
}

/** Brings a print-resolution original under the request-body ceiling. */
const fit = async (buffer: Buffer, ext: string): Promise<Buffer> => {
	if (buffer.byteLength <= MAX_UPLOAD_BYTES || ext === ".svg") return buffer
	return sharp(buffer)
		.resize({ width: 2400, withoutEnlargement: true })
		.jpeg({ quality: 88 })
		.toBuffer()
}

/**
 * The originals the marketing pages are built from.
 *
 * Read out of the storefront helper rather than listed here, so the two cannot
 * drift: whichever photographs those pages use are the ones this brings across.
 */
const pageImages = (): Set<string> =>
	new Set(
		[
			...readFileSync(
				path.join(__dirname, "../../frontend/src/lib/pageMedia.ts"),
				"utf8"
			).matchAll(/image\(\s*\n?\s*"([^"]+)"/g),
		].map((m) => m[1]!.replace("/wp-content/uploads/", ""))
	)

// ── the run ──────────────────────────────────────────────────────────────────

interface Entry {
	assetId: string
	url: string
	folder: string | null
}

const main = async () => {
	if (DRY_RUN) console.log("DRY RUN — nothing will be written\n")
	console.log("target:", BASE, "\n")

	console.log("reading the dump …")
	const byName = await readFolders()

	const folderOf = new Map<string, string>()
	for (const [name, files] of byName) for (const f of files) folderOf.set(f, name)
	console.log(`  ${byName.size} folders, ${folderOf.size} filed attachments\n`)

	const wantedPaths = PAGES_ONLY ? pageImages() : null

	const files = YEARS.flatMap((y) => walk(path.join(UPLOADS, y)))
		.filter((f) => IMAGE.test(f) && !GENERATED.test(f))
		.filter((f) => !wantedPaths || wantedPaths.has(relative(f)))
		.filter((f) => !ONLY_FOLDER || folderOf.get(relative(f)) === ONLY_FOLDER)
		.sort()

	if (ONLY_FOLDER && !byName.has(ONLY_FOLDER)) {
		console.log(`no folder called "${ONLY_FOLDER}". Known folders:`)
		for (const name of [...byName.keys()].sort()) console.log("  ", name)
		return
	}

	console.log(`${files.length} original image(s) to import\n`)

	const map: Record<string, Entry> = existsSync(MAP_FILE)
		? JSON.parse(readFileSync(MAP_FILE, "utf8"))
		: {}
	const resumed = Object.values(map).filter((e) => e.assetId).length
	if (resumed) console.log(`resuming — ${resumed} already imported\n`)

	// Folders, matched by the name the client gave them.
	const folderIds = new Map<string, string>()
	if (!DRY_RUN) {
		const existing = (await api("/media/folders/all")) as {
			data?: { id: string; name: string }[]
		}
		for (const f of existing?.data ?? []) folderIds.set(f.name, f.id)

		for (const name of byName.keys()) {
			if (folderIds.has(name)) continue
			const created = (await api("/media/folders", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name }),
			})) as { data?: { id: string } }
			if (created?.data?.id) folderIds.set(name, created.data.id)
		}

		console.log(`${folderIds.size} folder(s) ready\n`)
	}

	let done = 0
	let skipped = 0
	let failed = 0
	const started = Date.now()

	for (const file of files) {
		const rel = relative(file)
		if (map[rel]?.assetId) {
			skipped++
			continue
		}

		const folderName = folderOf.get(rel) ?? null
		const folderId = folderName ? folderIds.get(folderName) : undefined
		const ext = path.extname(file).toLowerCase()

		if (DRY_RUN) {
			console.log(`  would import ${rel}${folderName ? `  → ${folderName}` : ""}`)
			done++
			continue
		}

		try {
			const buffer = await fit(readFileSync(file), ext)

			const form = new FormData()
			form.append(
				"file",
				new Blob([new Uint8Array(buffer)], { type: MIME[ext] ?? "image/jpeg" }),
				path.basename(file)
			)
			if (folderId) form.append("folderId", folderId)

			const uploaded = (await api("/media/images", { method: "POST", body: form })) as {
				data?: { id: string; url: string }
			}

			map[rel] = {
				assetId: uploaded?.data?.id ?? "",
				url: uploaded?.data?.url ?? "",
				folder: folderName,
			}
			done++
		} catch (error) {
			failed++
			console.log(`  FAILED ${rel}: ${(error as Error).message.split("\n")[0]}`)
		}

		if ((done + failed) % 20 === 0) {
			writeFileSync(MAP_FILE, JSON.stringify(map, null, 2))
			const rate = (done + failed) / ((Date.now() - started) / 1000)
			const left = Math.round((files.length - skipped - done - failed) / rate / 60)
			console.log(`  ${done} imported, ${failed} failed — about ${left} min left`)
		}
	}

	if (!DRY_RUN) writeFileSync(MAP_FILE, JSON.stringify(map, null, 2))

	console.log(`\nimported ${done}, skipped ${skipped}, failed ${failed}`)
	console.log(`map: ${MAP_FILE}`)
}

void main()
