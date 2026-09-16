import express, { Router, type Request } from "express"
import { env } from "../../../config"
import {
	captureKey,
	identifies,
	identityCarriers,
	operationFor,
	reply,
	type ArticleRow,
	type Params,
} from "../../../domain/erp/meinbuero/protocol"
import { storage } from "../../../helpers/storage"
import { catchAsync } from "../../../shared/catchAsync"
import { logger } from "../../../shared/logger"
import { prisma } from "../../../shared/prisma"

/**
 * WISO MeinBüro Desktop's webshop interface — the capture stage.
 *
 * Added in MeinBüro as an "Angepasstes System" with this router's address as
 * the base URL, the client's ERP calls `mb_osc*.php` here exactly as it calls
 * the PHP connector on their Gambio shop. Every authenticated call is recorded
 * whole, and answered the way that connector answers — but nothing is written
 * to the shop and no order is handed over. The protocol has no specification
 * beyond Buhl's PHP files, so the first job is to see what MeinBüro actually
 * sends: how the Standard and Händler lists and their quantity steps arrive,
 * above all. See `ERP-PLAN.md`.
 *
 * Mounted in `app.ts` ahead of the JSON and form parsers rather than through
 * the router registry. MeinBüro posts raw XML, and a form parser that got to
 * the body first would consume it — the one thing this route exists to keep.
 */
export const MeinBueroRoutes = Router()

/** PHP's `$_REQUEST`: query string, with form fields over it. */
const paramsOf = (req: Request, raw: Buffer): Params => {
	const params: Params = {}

	for (const [key, value] of Object.entries(req.query)) {
		params[key] = Array.isArray(value) ? String(value[0]) : String(value)
	}

	if (req.is("application/x-www-form-urlencoded")) {
		for (const [key, value] of new URLSearchParams(raw.toString("utf8"))) params[key] = value
	}

	return params
}

/** Headers worth keeping. The identification travels as `User-Agent` and is never stored. */
const RECORDED_HEADERS = ["content-type", "content-length", "content-encoding", "accept", "accept-encoding", "expect"]

const articles = async (): Promise<ArticleRow[]> => {
	const variants = await prisma.productVariant.findMany({
		where: { sku: { not: null } },
		select: { sku: true, product: { select: { translations: { select: { locale: true, name: true } } } } },
		orderBy: { sku: "asc" },
	})

	return variants.map((variant) => {
		const names = variant.product.translations
		const name = (names.find((t) => t.locale === "de") ?? names.find((t) => t.locale === "en") ?? names[0])?.name
		return { sku: variant.sku!, name: name ?? "" }
	})
}

const articleCount = () => prisma.productVariant.count({ where: { sku: { not: null } } })

const CAPTURE_PREFIX = "erp/meinbuero/captures/"

/**
 * Reading the captures back, with the same identification MeinBüro uses.
 *
 * Registered before `/:file` so the name cannot be mistaken for a connector
 * file. It exists because the captures are the only record of what MeinBüro
 * sent, and whoever is debugging the connection may have no console for the
 * object store — asking the API is then the difference between a fix and a
 * guess. Confined to the captures prefix: this is not a way to read the
 * customers' design files.
 */
MeinBueroRoutes.get(
	"/_captures",
	catchAsync(async (req, res) => {
		if (!identifies({ userAgent: req.get("user-agent"), authorization: req.get("authorization") }, env.MEINBUERO_AGENT)) {
			res.status(403).type("text/plain").send("Identification does not match")
			return
		}

		const key = typeof req.query.key === "string" ? req.query.key : null

		if (!key) {
			const keys = await storage.list(CAPTURE_PREFIX, "PRIVATE", 500)
			res.json({ count: keys.length, keys })
			return
		}

		if (!key.startsWith(CAPTURE_PREFIX) || key.includes("..")) {
			res.status(400).type("text/plain").send("Key is outside the captures")
			return
		}

		res.type("application/json").send(await storage.get(key, "PRIVATE"))
	})
)

MeinBueroRoutes.all(
	"/:file",
	// Everything as bytes, whatever MeinBüro labels it. 20 MB holds a full
	// price list of this catalogue many times over.
	express.raw({ type: () => true, limit: "20mb" }),
	catchAsync(async (req, res) => {
		const file = String(req.params.file)

		// Unconfigured means closed, not open.
		if (!env.MEINBUERO_AGENT) {
			res.status(404).type("text/plain").send("Not found")
			return
		}

		const identity = { userAgent: req.get("user-agent"), authorization: req.get("authorization") }
		const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)

		if (!identifies(identity, env.MEINBUERO_AGENT)) {
			/*
			 * Recorded, not just refused.
			 *
			 * A mistyped identification and a MeinBüro that carries it somewhere
			 * unexpected look identical from the client's side — "it does not
			 * connect" — and each costs a round trip to the client's office to
			 * tell apart. What is kept is the shape of the attempt: which headers
			 * carried something and how long it was, never the value.
			 */
			const shape = identityCarriers(identity).map((value) => value.length)
			logger.warn({ file, carriers: shape }, "MeinBüro call refused: the identification did not match")

			await storage
				.put({
					key: captureKey(new Date(), file, undefined, true),
					visibility: "PRIVATE",
					contentType: "application/json",
					body: Buffer.from(
						JSON.stringify(
							{
								receivedAt: new Date().toISOString(),
								method: req.method,
								file,
								query: req.query,
								identificationLengths: shape,
								hasAuthorizationHeader: Boolean(identity.authorization),
								bodyBytes: raw.length,
							},
							null,
							2
						)
					),
				})
				.catch((error) => logger.error({ err: error, file }, "refused MeinBüro call could not be recorded"))

			res.status(403).type("text/plain").send("Identification does not match")
			return
		}

		const params = paramsOf(req, raw)
		const operation = operationFor(file, params)
		const now = new Date()
		const answer = await reply(operation, { now, body: raw.toString("utf8"), articles, articleCount })

		const key = captureKey(now, file, params.sync)
		const headers = Object.fromEntries(RECORDED_HEADERS.map((name) => [name, req.get(name)]).filter(([, value]) => value))

		/*
		 * Recorded before answering, and awaited. On a serverless platform the
		 * instance may be frozen the moment the response is sent, and a capture
		 * that never reached storage is the one failure this stage cannot afford.
		 * A storage error still answers MeinBüro — it is logged loudly instead.
		 */
		try {
			await storage.put({
				key,
				visibility: "PRIVATE",
				contentType: "application/json",
				body: Buffer.from(
					JSON.stringify(
						{
							receivedAt: now.toISOString(),
							method: req.method,
							file,
							params,
							headers,
							bodyBytes: raw.length,
							body: raw.toString("utf8"),
							reply: { status: answer.status, contentType: answer.contentType, body: answer.body.slice(0, 64_000) },
						},
						null,
						2
					)
				),
			})
		} catch (error) {
			logger.error({ err: error, file, key, bodyBytes: raw.length }, "MeinBüro call could not be recorded")
		}

		logger.info(
			{ file, operation: operation.kind, sync: params.sync, shopSystem: params.shp_system, bodyBytes: raw.length, key },
			"MeinBüro call recorded"
		)

		res.status(answer.status).type(answer.contentType).send(answer.body)
	})
)

export default MeinBueroRoutes
