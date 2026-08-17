/**
 * Bundles the compiled app into one CommonJS file for serverless deployment.
 *
 * Not an optimisation. Vercel's Node runtime does not support `require()` of an
 * ES module — its loader (`/opt/rust/nodejs.js` in a stack trace) throws
 * `ERR_REQUIRE_ESM` — and the dependency tree is full of packages that have
 * moved to ESM. `sanitize-html@2.17` requires `htmlparser2@^12`, which is
 * ESM-only and has no CommonJS entry to downgrade to, so one `require` deep
 * inside a third-party package took down every request to the API.
 *
 * Pinning one package would have fixed one package. esbuild converts every
 * ESM dependency to CommonJS as it inlines it, so the whole class of failure
 * goes away and stays away as more of npm moves to ESM.
 *
 * Long-running deployments (Render, the VPS) keep running `dist/` directly —
 * their Node is ours to choose, and `require(esm)` works there. This is only
 * for the platform whose Node we do not control.
 */
const esbuild = require("esbuild")
const path = require("path")

const ROOT = path.join(__dirname, "..")

/**
 * Left out of the bundle, and why.
 *
 * Native addons cannot be inlined — they are `.node` binaries loaded at
 * runtime, and esbuild would only mangle the paths that find them. Prisma's
 * client is generated into `node_modules` and resolves its own files relative
 * to itself. `@react-pdf/renderer` is reached through a dynamic `import()`,
 * which works on every Node version and needs no help.
 *
 * Everything external must still be shipped, which `includeFiles` in
 * `vercel.json` and the tracer between them take care of.
 */
const EXTERNAL = [
	"sharp",
	"bcrypt",
	"@prisma/client",
	".prisma/client",
	"@prisma/adapter-pg",
	"@react-pdf/renderer",
]

esbuild
	.build({
		entryPoints: [path.join(ROOT, "dist", "app.js")],
		outfile: path.join(ROOT, "dist-bundle", "app.js"),
		bundle: true,
		platform: "node",
		// The floor Vercel might give us, not the version we develop on. Setting
		// it higher would let esbuild emit syntax the runtime cannot parse.
		target: "node20",
		format: "cjs",
		external: EXTERNAL,
		// Kept: this is a server, nobody downloads it, and a readable stack trace
		// in a runtime log is worth more than the bytes.
		minify: false,
		sourcemap: false,
		logLevel: "warning",
	})
	.then(() => console.log("bundled dist/ → dist-bundle/app.js"))
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
