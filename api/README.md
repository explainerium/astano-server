# Vercel entry point

`index.ts` is what Vercel imports; `src/server.ts` is what Render and the VPS
run. They share `src/app.ts` — nothing in the application is Vercel-specific.

The decisions behind `../vercel.json`, which has nowhere to put a comment:

| Setting                         | Why                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rewrites: /(.*) → /api`        | One function serves everything. The routing already lives in `src/app/router`; splitting it across several functions would give each of them its own cold start and its own Prisma connection. |
| `regions: ["fra1"]`             | Frankfurt, next to the Supabase database in Paris. A cross-region round trip was measured at 165 ms, and a product create makes twenty of them.                                                |
| `maxDuration: 60`               | An invoice render and a checkout both do real work.                                                                                                                                            |
| `buildCommand` → `npx prisma generate` | The generated client is not committed and Vercel builds from a clean cache. `npx`, not a bare `prisma`: a build command runs in a plain shell, which does not have `node_modules/.bin` on its PATH the way an npm script does — a bare `prisma` exits 127, "command not found". |
| `buildCommand` → `npm run build` | We compile, Vercel does not. See below. |
| `buildCommand` → `rm -rf node_modules/typescript` | **This is not a hack, it is a workaround for a bug in Vercel's own builder.** See below. |
| `buildCommand` → `rm -rf dist node_modules/sanitize-html node_modules/htmlparser2` | Deletes everything the bundle replaced, so nothing can quietly load it. See below. |
| `installCommand: npm ci --include=dev` | Vercel sets `NODE_ENV=production` for the build, and npm then skips devDependencies — where `prisma` and `typescript` both live. Without this the build fails looking for a Prisma CLI that was never installed. `render.yaml` carries the same flag for the same reason. |
| **No `prisma migrate deploy`**  | Every preview deployment would otherwise migrate the production database. Migrations are run deliberately: `npx prisma migrate deploy` from a machine that means it.                           |
| `crons`                         | `node-cron` needs a process that stays alive and Vercel has none, so the schedule lives with the platform and calls `GET /api/v1/cron/run`.                                                    |

## Why the unbundled build is deleted after bundling

`dist/` and the two packages the bundle inlined (`sanitize-html`, and the
ESM-only `htmlparser2` it requires) are removed once `dist-bundle/app.js`
exists.

Not tidiness. `ERR_REQUIRE_ESM` from `node_modules/sanitize-html/index.js`
survived several deployments *after* the bundle was in place — and it cannot
come from the bundle, where that `require` no longer exists. Something was still
reaching the unbundled code. Rather than keep guessing which layer (a restored
build cache, a stale bytecode snapshot, a second traced entry point), the
unbundled code is simply not there any more.

That also makes the failure legible if it ever happens again: a load of the old
path now fails with `MODULE_NOT_FOUND`, which `api/index.js` catches and serves
as a 503 naming the module — instead of an ESM error that reads like the bundle
did not work.

Both are safe to delete. The bundle inlines `sanitize-html` outright, and
nothing external references it — verified with
`grep -c 'require("sanitize-html")' dist-bundle/app.js`, which is zero.

## Why TypeScript is deleted after the build

`@vercel/node` decides which TypeScript to use like this (`dist/index.js`):

```js
try {
  compiler = require.resolve("typescript", { paths: [cwd] })
} catch {
  compiler = "typescript"          // its own bundled 5.9.3
}
…
if (!hasLegacyCompilerApi(loadedCompiler)) {
  return registerNativeCompiler(options, cwd, loadedVersion)
}
```

This project is on **TypeScript 7**, the native rewrite, which has no legacy
compiler API — so the builder takes `registerNativeCompiler`, and that function
begins:

```js
const compilerPath = (0, import_promises.readFile)(packageJsonPath, "utf8")
```

`import_promises` is undefined in their bundle. That is the whole of
`Error: Cannot read properties of undefined (reading 'readFile')` — a broken
import inside Vercel's builder, on a code path only a TypeScript 7 project
reaches. Nothing about this repository is wrong, and no amount of changing the
entry point avoids it: the compiler is registered before the entry is even
looked at.

Removing `node_modules/typescript` once our own build has finished makes that
`require.resolve` throw, so the builder falls back to the TypeScript **it
ships** — 5.9.3, which has the legacy API and works. Nothing is lost: the
compile already happened, and the deployed artefact is JavaScript.

Delete this step when Vercel fixes the bug, or when the project drops to
TypeScript 5.

## Why the build is ours and not Vercel's

`api/index.js` is plain JavaScript and requires the compiled `dist/`. The build
runs the same `tsc` and `tsconfig.json` as everything else, so the deployment
gets the same `nodenext` module resolution and the same `react-jsx` setting the
invoice PDF needs. `includeFiles: "dist/**"` is what guarantees it ships —
`src/i18n/index.ts` reads its catalogues with a dynamic
`require(\`./messages/${code}.json\`)`, which a file tracer has no reliable way
to follow.

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
