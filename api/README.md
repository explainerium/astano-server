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
| `installCommand: npm ci --include=dev` | Vercel sets `NODE_ENV=production` for the build, and npm then skips devDependencies — where `prisma` and `typescript` both live. Without this the build fails looking for a Prisma CLI that was never installed. `render.yaml` carries the same flag for the same reason. |
| **No `prisma migrate deploy`**  | Every preview deployment would otherwise migrate the production database. Migrations are run deliberately: `npx prisma migrate deploy` from a machine that means it.                           |
| `crons`                         | `node-cron` needs a process that stays alive and Vercel has none, so the schedule lives with the platform and calls `GET /api/v1/cron/run`.                                                    |

## `require()` of an ES module, and why it only broke here

This cost a day, so it is written down properly.

Every request returned 500 with `ERR_REQUIRE_ESM`: `sanitize-html/index.js`
calling `require("htmlparser2")`, where htmlparser2 v11 and later are ESM-only.
The same code had never once failed in development or on Render.

The difference is not the code, it is the loader. **Node 22.12 and later can
`require()` an ES module; Vercel's loader cannot** — it is a Rust
reimplementation (`/opt/rust/nodejs.js`, `/opt/rust/bytecode.js` in a stack
trace), and it throws where stock Node would have succeeded. Development runs
Node 24 and Render runs Node 24, so both sides of that line looked identical
until the first deploy here.

The fix is the `overrides` block in `package.json`, pinning htmlparser2 to
`10.0.0` — the last release that still ships a CommonJS build. Not the bundler,
which was the first attempt: bundling only hid the `require` from *one* of the
two code paths the platform might run, and left the other still broken.

Reproduce either state locally, with the flag that turns stock Node into this
loader:

```sh
node --no-experimental-require-module -e 'require("sanitize-html")'
# without the override: ERR_REQUIRE_ESM, exactly as deployed
# with it:              loads
```

That flag is the check to run before adding any dependency here. The one other
ESM-only package in the tree, `color-string` (under `@react-pdf/renderer`), is
safe only because the invoice renderer is reached through a dynamic `import()`,
which is allowed to load ESM. A static `require` of either would fail the same
way.

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

`DATABASE_URL` **must** point at Supabase's **transaction** pooler (port
`6543`, with `?pgbouncer=true`) rather than the session pooler (`5432`).
Prisma Migrate needs session mode, so keep `5432` in the `.env` you run
migrations from — but nowhere else.

Not a preference. The session pooler allows **fifteen clients in total, across
everything that connects to the database**. Serverless opens its own pool per
instance, so a handful of warm instances take all fifteen and then every query
fails — including the ones from a developer's laptop, which is what makes it
look like the database has gone down rather than run out of room. Supabase
answers `XX000 (EMAXCONNSESSION) max clients reached in session mode`, which
Prisma reports as P2010 and this API translates to "the database rejected this
change" on whatever request happened to be passing.

The pool size is capped to match: one connection per serverless instance, five
for a long-running server. See `poolSize()` in `src/shared/prisma.ts`.
