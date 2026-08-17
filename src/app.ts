import cookieParser from "cookie-parser"
import cors from "cors"
import express, { type Application, type Request, type Response } from "express"
import helmet from "helmet"
import httpStatus from "./shared/httpStatus"
import { env, LOCALES, DEFAULT_LOCALE } from "./config"
import ensureShopReady from "./app/middlewares/ensureShopReady"
import globalErrorHandler from "./app/middlewares/globalErrorHandler"
import notFound from "./app/middlewares/notFound"
import { resolveLocale } from "./app/middlewares/resolveLocale"
import router from "./app/router"
import { MediaController } from "./app/modules/media/media.controller"
import { httpLogger } from "./shared/httpLogger"
import { missingTranslations } from "./i18n"
import "./app/interfaces/locale"

const app: Application = express()

/**
 * One proxy hop, not "any number of them".
 *
 * The API is deployed behind Render's load balancer, so without this every
 * request appears to come from the proxy's own address. The rate limiters key
 * on `req.ip`, which meant the whole site shared a single bucket: ten wrong
 * passwords from one visitor locked everybody else out of signing in for
 * fifteen minutes. Refresh tokens recorded the proxy's address too, so the
 * "which device was this?" column said the same thing on every row.
 *
 * `1` rather than `true`: trusting the entire chain lets a client prepend its
 * own X-Forwarded-For and claim any address it likes, which hands back the
 * rate-limit bypass this is here to close.
 */
app.set("trust proxy", 1)

app.use(helmet())
app.use(
	cors({
		origin: env.CORS_ORIGINS.split(",").map((o) => o.trim()),
		credentials: true,
	})
)
app.use(express.json({ limit: "1mb" }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(httpLogger)

// Must run before the router so /de/... resolves to the same handlers as /...
app.use(resolveLocale)

/*
 * The payment methods and the tax matrix, made certain on the first request.
 *
 * `server.ts` does this at boot, which covers Render and the VPS. A serverless
 * deployment never runs that file, so this is what stops a cold instance
 * serving a checkout with nothing to pay with. Cached per instance and never
 * awaited — see the middleware.
 */
app.use(ensureShopReady)

// Index route — so hitting the server in a browser explains itself rather than
// returning a bare 404.
app.get("/", (req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		statusCode: httpStatus.OK,
		message: "Astano API",
		data: {
			version: "v1",
			env: env.NODE_ENV,
			locale: req.locale,
			endpoints: {
				health: "/health",
				api: "/api/v1",
			},
			locales: LOCALES.map((l) => ({
				code: l.code,
				label: l.label,
				prefix: l.code === DEFAULT_LOCALE ? "/" : `/${l.code}`,
			})),
		},
	})
})

app.get("/health", (req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		statusCode: httpStatus.OK,
		message: "Astano API is running",
		data: {
			env: env.NODE_ENV,
			locale: {
				resolved: req.locale,
				default: DEFAULT_LOCALE,
				supported: LOCALES.map((l) => ({ code: l.code, label: l.label })),
				missingTranslations: missingTranslations(),
			},
			uptime: Math.round(process.uptime()),
		},
	})
})

// Local-driver public media. With R2 these are served from Cloudflare and this
// route is never reached.
app.use(
	"/media",
	(_req, res, next) => {
		/**
		 * Product images exist to be embedded by the storefront and the admin,
		 * which run on a different origin in development (3000 vs 5000).
		 *
		 * helmet defaults Cross-Origin-Resource-Policy to `same-origin`, which
		 * makes the browser refuse to *render* the image even though the request
		 * succeeds — so it shows as a broken image while curl reports 200. Relaxed
		 * for this route only: these bytes are public by definition. Everything
		 * else, including every JSON response, keeps the strict default.
		 */
		res.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
		next()
	},
	MediaController.servePublicLocal
)

app.use("/api/v1", router)

app.use(notFound)
app.use(globalErrorHandler)

export default app
