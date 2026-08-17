/**
 * The Vercel entry point.
 *
 * Plain JavaScript, and it requires the **compiled** app rather than the
 * TypeScript source. That is deliberate: Vercel's Node builder compiles a
 * TypeScript entry point itself, using whichever TypeScript it finds in the
 * project — and this project is on TypeScript 7, whose API it cannot drive
 * ("Cannot read properties of undefined (reading 'readFile')"). Handing it
 * finished JavaScript takes the question away entirely, and has the side
 * benefit that the deployment is built by exactly the `tsc` and `tsconfig.json`
 * everything else is built by, JSX setting and all.
 *
 * `npm run build` produces `dist/`, which is also what copies the i18n message
 * catalogues across — `tsc` alone leaves JSON behind.
 *
 * Vercel runs functions, not servers: it imports this file and calls what it
 * exports, once per request. `src/server.ts` — the entry Render and the VPS use
 * — is never loaded here, so `app.listen`, the signal handlers and the
 * `node-cron` timers do not exist on this platform. Two consequences are
 * handled elsewhere rather than pretended away:
 *
 *  - **Startup seeding.** The payment methods and the tax matrix are created
 *    from `server.ts` at boot. There is no boot, so `ensureShopReady` (wired
 *    into `app.ts`) does it on the first request each instance sees.
 *  - **Scheduled jobs.** The schedule lives in `vercel.json` and calls
 *    `GET /api/v1/cron/run`, which authenticates with `CRON_SECRET`.
 *
 * Express itself needs no adapting: an Express app *is* a `(req, res)` handler,
 * which is exactly what Vercel's Node runtime expects.
 */
/**
 * Loaded inside a try, so a failure at import says what it was.
 *
 * A module that throws while a serverless function is starting takes the whole
 * invocation with it, and the platform can only report
 * `FUNCTION_INVOCATION_FAILED` — a 500 page with an id on it and nothing else.
 * The real reason goes to the runtime log, which is a different screen from the
 * build log everybody looks at first, and that gap has cost several deploys.
 *
 * So the failure is caught and answered with. `503`, because the deployment is
 * not serving rather than the request being wrong, and `Retry-After` so a
 * crawler does not treat it as permanent.
 */
let app

try {
	app = require("../dist/app").default
} catch (error) {
	/*
	 * The message, not the stack.
	 *
	 * What breaks here is a missing environment variable or a module that will
	 * not load, and the message names it — "Cannot find module 'x'",
	 * "ERR_REQUIRE_ESM". A stack would add file paths from inside the bundle and
	 * tell a stranger more about the deployment than it tells the person fixing
	 * it. The stack is logged; only the sentence is served.
	 */
	console.error("The API failed to start:", error)

	app = (_req, res) => {
		res.statusCode = 503
		res.setHeader("Content-Type", "application/json; charset=utf-8")
		res.setHeader("Retry-After", "120")
		res.end(
			JSON.stringify({
				success: false,
				statusCode: 503,
				message: "The API could not start.",
				error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
				hint: "Check the deployment's environment variables, then redeploy — the full stack is in the runtime log.",
			})
		)
	}
}

module.exports = app
