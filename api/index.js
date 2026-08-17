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
module.exports = require("../dist/app").default
