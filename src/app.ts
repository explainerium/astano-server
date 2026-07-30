import cookieParser from "cookie-parser"
import cors from "cors"
import express, { type Application, type Request, type Response } from "express"
import helmet from "helmet"
import httpStatus from "./shared/httpStatus"
import { env, LOCALES, DEFAULT_LOCALE } from "./config"
import globalErrorHandler from "./app/middlewares/globalErrorHandler"
import notFound from "./app/middlewares/notFound"
import { resolveLocale } from "./app/middlewares/resolveLocale"
import router from "./app/router"
import { MediaController } from "./app/modules/media/media.controller"
import { httpLogger } from "./shared/httpLogger"
import { missingTranslations } from "./i18n"
import "./app/interfaces/locale"

const app: Application = express()

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
app.use("/media", MediaController.servePublicLocal)

app.use("/api/v1", router)

app.use(notFound)
app.use(globalErrorHandler)

export default app
