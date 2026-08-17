# Vercel entry point

`index.ts` is what Vercel imports; `src/server.ts` is what Render and the VPS
run. They share `src/app.ts` — nothing in the application is Vercel-specific.

The decisions behind `../vercel.json`, which has nowhere to put a comment:

| Setting                         | Why                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rewrites: /(.*) → /api`        | One function serves everything. The routing already lives in `src/app/router`; splitting it across several functions would give each of them its own cold start and its own Prisma connection. |
| `regions: ["fra1"]`             | Frankfurt, next to the Supabase database in Paris. A cross-region round trip was measured at 165 ms, and a product create makes twenty of them.                                                |
| `maxDuration: 60`               | An invoice render and a checkout both do real work.                                                                                                                                            |
| `buildCommand: npx prisma generate` | The generated client is not committed and Vercel builds from a clean cache. `npx`, not a bare `prisma`: a build command runs in a plain shell, which does not have `node_modules/.bin` on its PATH the way an npm script does — a bare `prisma` exits 127, "command not found". |
| `installCommand: npm ci --include=dev` | Vercel sets `NODE_ENV=production` for the build, and npm then skips devDependencies — where `prisma` and `typescript` both live. Without this the build fails looking for a Prisma CLI that was never installed. `render.yaml` carries the same flag for the same reason. |
| **No `prisma migrate deploy`**  | Every preview deployment would otherwise migrate the production database. Migrations are run deliberately: `npx prisma migrate deploy` from a machine that means it.                           |
| `crons`                         | `node-cron` needs a process that stays alive and Vercel has none, so the schedule lives with the platform and calls `GET /api/v1/cron/run`.                                                    |

## What is different on Vercel

**Startup seeding.** `server.ts` creates the offline payment methods and the
default tax matrix at boot. There is no boot here, so `ensureShopReady`
(`src/app/middlewares`) does it on the first request each instance sees.
Without it a cold instance would answer its first checkout with nothing to pay
with, and refuse every order for having no tax rate.

**Scheduled jobs.** One cron entry runs all five jobs, daily. The in-process
schedule runs quote expiry hourly; here it is daily, so a quote can sit expired
for up to a day before it is marked so. Acceptable for a test deployment. The
free plan allows two cron entries against five jobs, which is the other reason
they are run as a set.

**Rate limiting is weaker.** `express-rate-limit` keeps its counters in memory,
and every instance has its own. Ten login attempts per instance is not ten
attempts. It is not nothing — a single attacker on one connection still meets
one instance — but it is not the guarantee it is on a single long-running
server. A shared store (Redis/Upstash) is what fixes it properly, if this ever
becomes more than a test deployment.

## Environment

Everything in `.env.example`, plus:

| Variable                            | Value                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET`                       | `openssl rand -hex 32`. Vercel sends it as `Authorization: Bearer …`; without it `/cron/run` refuses every call. |
| `PUBLIC_BASE_URL`                   | This deployment's own URL — media links are built from it.                                                       |
| `SHOP_BASE_URL`                     | The storefront's URL — every link in every email is built from it.                                               |
| `CORS_ORIGINS`                      | The storefront's URL.                                                                                            |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | `none` / `true`, while the API and the shop are on different hosts.                                              |

`DATABASE_URL` should point at Supabase's **transaction** pooler (port `6543`)
here rather than the session pooler (`5432`): serverless opens a connection per
instance and the transaction pooler is what stops that exhausting the database.
Prisma Migrate needs the session pooler, so keep `5432` in the `.env` you run
migrations from.
