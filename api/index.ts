/**
 * The Vercel entry point.
 *
 * Vercel runs functions, not servers: it imports this file and calls what it
 * exports, once per request. `server.ts` — the entry every other deployment
 * uses — is never loaded here, so `app.listen`, the signal handlers and the
 * `node-cron` timers all simply do not exist on this platform.
 *
 * Two consequences are handled elsewhere rather than pretended away:
 *
 *  - **Startup seeding.** The payment methods and the tax matrix are created
 *    from `server.ts` at boot. There is no boot, so `ensureShopReady` (wired
 *    into `app.ts`) does it on the first request of each instance instead.
 *  - **Scheduled jobs.** `node-cron` needs a process that stays alive. The
 *    schedule lives in `vercel.json` and calls `POST /api/v1/cron/run`, which
 *    authenticates with `CRON_SECRET`.
 *
 * Express itself needs no adapting: an Express app *is* a
 * `(req, res) => void` handler, which is exactly what Vercel's Node runtime
 * expects. Nothing about `app.ts` is Vercel-specific, so the same file keeps
 * serving Render and the VPS unchanged.
 */
import app from "../src/app"

export default app
