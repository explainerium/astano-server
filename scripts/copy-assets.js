/**
 * Copies non-TypeScript assets into dist/.
 *
 * `tsc` compiles .ts and ignores everything else, so the i18n message catalogs
 * never reached the build and the production server crashed at startup with
 * "Cannot find module './messages/en.json'". Typecheck passes, tests pass, and
 * the built artefact is broken — which is why `npm run build` now runs this.
 */
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
const SRC = path.join(ROOT, "src")
const DIST = path.join(ROOT, "dist")

/** Extensions that belong in the build but that tsc will not carry over. */
const ASSET_EXTENSIONS = [".json", ".html", ".txt", ".hbs"]

let copied = 0

const walk = (dir) => {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const from = path.join(dir, entry.name)

		if (entry.isDirectory()) {
			walk(from)
			continue
		}

		if (!ASSET_EXTENSIONS.includes(path.extname(entry.name))) continue

		const to = path.join(DIST, path.relative(SRC, from))
		fs.mkdirSync(path.dirname(to), { recursive: true })
		fs.copyFileSync(from, to)
		copied++
	}
}

if (!fs.existsSync(DIST)) {
	console.error("dist/ does not exist — run tsc first")
	process.exit(1)
}

walk(SRC)
console.log(`copied ${copied} asset file(s) into dist/`)
