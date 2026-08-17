import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

import { describe, expect, it } from "vitest"

/**
 * Every production dependency must be loadable by `require()`.
 *
 * This exists because of a day lost to a 500 that only ever appeared once
 * deployed. `sanitize-html` is CommonJS and calls `require("htmlparser2")`;
 * htmlparser2 v11 dropped its CommonJS build. Node 22.12 and later can
 * `require()` an ES module, so development and Render — both on Node 24 —
 * loaded it without complaint. Vercel's loader cannot, and threw
 * `ERR_REQUIRE_ESM` at startup on every single request.
 *
 * Nothing in the codebase changed to cause it and nothing in the codebase
 * showed it. It arrived through a transitive bump and was invisible until the
 * one environment that mattered. So the check belongs here, where a dependency
 * update runs into it, rather than in a deployment log.
 *
 * `package.json` pins htmlparser2 to the last CommonJS release in `overrides`.
 * If that pin is ever dropped, this test is what says so.
 *
 * Dynamic `import()` is exempt and correctly so — it loads ESM anywhere. The
 * invoice renderer reaches `@react-pdf/renderer` that way on purpose, and that
 * package brings ESM-only dependencies of its own. Hence DYNAMIC below: what is
 * checked is the tree that gets `require`d, not the whole of node_modules.
 */

const require_ = createRequire(import.meta.url)
const ROOT = path.join(__dirname, "..", "..")

/** Loaded with `import()` at the point of use, so ESM below it is fine. */
const DYNAMIC = new Set(["@react-pdf/renderer"])

type Manifest = {
	name?: string
	version?: string
	type?: string
	dependencies?: Record<string, string>
}

const readManifest = (file: string): Manifest => JSON.parse(fs.readFileSync(file, "utf8")) as Manifest

/**
 * Node's own rule, not a guess at it.
 *
 * A manifest's `type` field is not the answer on its own: htmlparser2 v10 and
 * v12 are both `"type": "module"`, and only one of them breaks. What decides it
 * is the *file* `require()` would land on — v10's `main` points into a
 * `dist/commonjs/` folder carrying its own `{"type": "commonjs"}`, which is how
 * a dual-format package is built. So resolve the entry the way the runtime
 * would, then ask what that file is.
 */
const isEsm = (file: string): boolean => {
	if (file.endsWith(".mjs")) return true
	if (file.endsWith(".cjs") || file.endsWith(".json") || file.endsWith(".node")) return false

	for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
		const manifest = path.join(dir, "package.json")

		if (fs.existsSync(manifest)) {
			try {
				return readManifest(manifest).type === "module"
			} catch {
				return false
			}
		}

		if (path.dirname(dir) === dir) return false
	}
}

const collectEsmOnly = (): string[] => {
	const found = new Set<string>()
	const visited = new Set<string>()

	const walk = (name: string, from: string): void => {
		if (DYNAMIC.has(name)) return

		// `paths` makes this resolve exactly as a `require` from that package
		// would, honouring the `require` condition in `exports` — which is the
		// condition a dual-format package uses to hand back CommonJS.
		//
		// A package with no root entry at all is not a finding. Plenty publish
		// subpaths only (`math-intrinsics/abs`, `@aws-sdk/nested-clients/sts`)
		// and are perfectly requireable at the path their consumer actually
		// uses. What matters is where a root `require` lands when there is one.
		let entry: string | null = null
		try {
			entry = require_.resolve(name, { paths: [from] })
		} catch {
			/* subpath-only, or types-only. Still walk its dependencies. */
		}

		if (entry) {
			if (visited.has(entry)) return
			visited.add(entry)
		}

		// The package's own manifest, not whichever one sits nearest the entry
		// file — a dual-format build has a second, near-empty package.json in
		// `dist/commonjs` that lists no dependencies of its own.
		let manifestFile: string
		try {
			manifestFile = require_.resolve(`${name}/package.json`, { paths: [from] })
		} catch {
			// Hidden behind `exports`, which is allowed. Fall back to the nearest
			// manifest above the entry; at worst it is the same file.
			if (!entry) return

			let dir = path.dirname(entry)
			while (!fs.existsSync(path.join(dir, "package.json")) && path.dirname(dir) !== dir) {
				dir = path.dirname(dir)
			}
			manifestFile = path.join(dir, "package.json")
		}

		if (visited.has(manifestFile)) return
		visited.add(manifestFile)

		const manifest = readManifest(manifestFile)

		if (entry && isEsm(entry)) found.add(`${manifest.name ?? name}@${manifest.version ?? "?"}`)

		for (const dependency of Object.keys(manifest.dependencies ?? {})) {
			walk(dependency, path.dirname(manifestFile))
		}
	}

	for (const dependency of Object.keys(readManifest(path.join(ROOT, "package.json")).dependencies ?? {})) {
		walk(dependency, ROOT)
	}

	return [...found].sort()
}

describe("production dependencies", () => {
	it("are all loadable with require(), including transitively", () => {
		const esmOnly = collectEsmOnly()

		expect(
			esmOnly,
			esmOnly.length
				? `ESM-only, and something require()s it:\n  ${esmOnly.join("\n  ")}\n\n` +
						"A runtime that cannot require() an ES module — Vercel's, among others — " +
						"will fail to start.\nPin the package to its last CommonJS release in the " +
						'"overrides" block of package.json, or reach it through a dynamic import() ' +
						"and add it to DYNAMIC above.\n\nReproduce the failure:\n  " +
						"node --no-experimental-require-module -e 'require(\"./dist/app.js\")'\n"
				: undefined
		).toEqual([])
	})

	it("recognises an ESM-only package when it sees one", () => {
		// Guards the guard. htmlparser2 v12 is the package that caused the
		// outage, and `color-string` is ESM-only and present in the tree — under
		// the dynamic import, which is why the sweep above is allowed to pass
		// while this still has something to point at. If this stops finding it,
		// the sweep has gone blind rather than clean.
		const colorString = path.join(ROOT, "node_modules", "color-string", "index.js")

		expect(fs.existsSync(colorString), "color-string moved — point this at another ESM-only package").toBe(
			true
		)
		expect(isEsm(colorString)).toBe(true)
		expect(isEsm(require_.resolve("sanitize-html", { paths: [ROOT] }))).toBe(false)
	})

	it("pins htmlparser2 to a version that ships CommonJS", () => {
		const { overrides } = readManifest(path.join(ROOT, "package.json")) as Manifest & {
			overrides?: Record<string, string>
		}

		expect(overrides?.htmlparser2, "htmlparser2 v11+ is ESM-only and sanitize-html require()s it").toBe(
			"10.0.0"
		)
	})
})
