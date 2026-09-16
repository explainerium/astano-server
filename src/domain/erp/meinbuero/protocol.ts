import crypto from "crypto"

/**
 * The wire protocol of WISO MeinBüro Desktop's webshop interface, as spoken by
 * its own PHP connector.
 *
 * There is no published specification. What there is — and what this file is
 * written against — is the connector Buhl distributes for shops to install:
 * `PHP_Installation.zip`, version 23.06.07, linked from the setup page of the
 * MeinBüro Desktop handbook. It includes an "Angepasstes System" shop type for
 * exactly this case, and every response below reproduces what those PHP files
 * print, byte for byte where MeinBüro is likely to care.
 *
 * MeinBüro is the caller. It is given a base URL, appends one of five file
 * names, and sends its parameters as a query string or form fields and any
 * data as a raw XML body. Its identity is the `User-Agent` header, which must
 * equal the "Identifikationskennung" typed into both sides.
 *
 * Pure: no I/O. The route supplies the article list and does the recording.
 */

/** The connector version this imitates; MeinBüro may ask for it. */
export const CONNECTOR_VERSION = "23.06.07"

export type Params = Record<string, string | undefined>

export type Operation =
	| { kind: "orders" }
	| { kind: "markFetched"; id: string }
	| { kind: "sync"; sync: string }
	| { kind: "check"; callName: string; functionName: string | undefined }
	| { kind: "info" }
	| { kind: "unknown"; file: string }

export interface ArticleRow {
	sku: string
	name: string
}

export interface Reply {
	status: number
	contentType: string
	body: string
}

export interface ReplyContext {
	now: Date
	body: string
	articles: () => Promise<ArticleRow[]>
	articleCount: () => Promise<number>
}

/**
 * Constant time, because the identification is the whole of the caller's
 * credential. A missing expected value refuses everything rather than
 * accepting everything.
 */
export const agentMatches = (offered: string | undefined, expected: string | undefined): boolean => {
	if (!expected || !offered) return false

	const a = Buffer.from(offered)
	const b = Buffer.from(expected)
	return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export interface OfferedIdentity {
	userAgent: string | undefined
	authorization: string | undefined
}

/**
 * Where the "Benutzername" from MeinBüro's add-shop dialog arrives.
 *
 * Buhl's connector compares it against `$_SERVER['HTTP_USER_AGENT']`, so that
 * is the documented carrier. The dialog calls the field a user name and offers
 * a password beside it, though, and a client that also sends HTTP Basic
 * credentials is entirely plausible — so both are accepted. The alternative is
 * a refusal the client can only report as "it does not connect".
 *
 * The password box is the encryption key, and stays empty: nothing here
 * encrypts its responses.
 */
export const identityCarriers = ({ userAgent, authorization }: OfferedIdentity): string[] => {
	const offered = [userAgent]

	if (authorization?.toLowerCase().startsWith("basic ")) {
		const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8")
		const separator = decoded.indexOf(":")
		offered.push(separator === -1 ? decoded : decoded.slice(0, separator), decoded.slice(separator + 1))
	}

	return offered.filter((value): value is string => Boolean(value))
}

export const identifies = (identity: OfferedIdentity, expected: string | undefined): boolean =>
	identityCarriers(identity).some((offered) => agentMatches(offered, expected))

export const operationFor = (file: string, params: Params): Operation => {
	switch (file.toLowerCase()) {
		case "mb_osc.php":
			return { kind: "orders" }
		case "mb_osc_del.php":
			return { kind: "markFetched", id: params.id ?? "" }
		case "mb_osc_sync.php":
			return { kind: "sync", sync: params.sync ?? "" }
		case "mb_osc_val.php":
			return { kind: "check", callName: params.CallName ?? "", functionName: params.function_name }
		case "mb_osc_info.php":
			return { kind: "info" }
		default:
			return { kind: "unknown", file }
	}
}

/**
 * The shop-side functions MeinBüro may ask about before offering a feature.
 *
 * `artikeldaten_shop_zu_orgamax` is left out on purpose: it is the one that
 * imports the shop's articles *into* MeinBüro, and nothing here should invite
 * their ERP to create articles from our catalogue.
 */
const ANSWERED_FUNCTIONS = new Set([
	"starten",
	"ende",
	"daten_holen",
	"row_ueberpruefen",
	"status_aendern",
	"setze_lagerbestand_im_shop",
	"setze_Artikelpreise_im_shop",
	"artikeldaten_orgamax_zu_shop",
	"hole_Artikelliste_fuer_export",
	"paging_informationen",
	"pruefeOffeneBestellungenImShop",
])

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>'
const XML_HEAD_STANDALONE = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>'

/** PHP's `date("Y-m-d H:i:s")`, in UTC. */
const stamp = (date: Date): string => date.toISOString().replace("T", " ").slice(0, 19)

const escapeText = (value: string): string =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/** A CDATA section cannot contain its own terminator, so one is split across two. */
const cdata = (value: string): string => `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`

/**
 * `Add_NewDocElement`: CDATA for a value, a plain text node for an "empty" one.
 * PHP's `empty()` counts the string "0" as empty, which decides how a count of
 * zero is written.
 */
const element = (name: string, value: string, indent: string): string =>
	`${indent}<${name}>${value === "" || value === "0" ? escapeText(value) : cdata(value)}</${name}>`

export const successXml = (message: string, now: Date): string =>
	`${XML_HEAD}\n<orgamax_phpsuccess>\n<message>${message}</message>\n<status>Erfolgreich</status>\n<time>${stamp(now)}</time>\n</orgamax_phpsuccess>`

export const errorXml = (message: string, file: string, now: Date): string =>
	`${XML_HEAD}\n<orgamax_phperror>\n<message>${message}</message>\n<phpfile>${file}</phpfile>\n<function></function>\n<line>0</line>\n<errortime>${stamp(now)}</errortime>\n</orgamax_phperror>`

/** No orders. The shape MeinBüro receives when a shop has nothing new. */
export const emptyOrderNotification = (): string =>
	`${XML_HEAD_STANDALONE}\n<OrderNotification>\n</OrderNotification>`

/** An empty article import — the answer to "send me your articles". */
export const emptyArticleImport = (): string => `${XML_HEAD_STANDALONE}\n<Artikelimport>\n</Artikelimport>`

/** `WriteXMLResult`: nothing accepted is reported as a rollback, as the PHP does. */
export const exportProtocol = (total: number, accepted: number): string =>
	`${XML_HEAD}<Exportprotokoll><Export_Status>${accepted === 0 ? "ROLLBACK" : "SUCCESS"}</Export_Status>` +
	`<Anzahl_Datensaetze_Gesamt>${total}</Anzahl_Datensaetze_Gesamt>` +
	`<Anzahl_Datensaetze_Erfolgreich_Uebergeben>${accepted}</Anzahl_Datensaetze_Erfolgreich_Uebergeben></Exportprotokoll>`

export const articleList = (rows: ArticleRow[]): string => {
	const items = rows.map(
		(row) =>
			`  <row>\n${element("ArtikelnummerWebshop", row.sku, "    ")}\n${element("Artikelbeschreibung", row.name, "    ")}\n  </row>`
	)
	return `${XML_HEAD_STANDALONE}\n<ArtikelListeWebshop>${items.length ? `\n${items.join("\n")}\n` : ""}</ArtikelListeWebshop>\n`
}

export const pagingInformation = (articleCount: number): string =>
	`${XML_HEAD_STANDALONE}\n<PagingInformations>\n${element("ArticleCount", String(articleCount), "  ")}\n</PagingInformations>\n`

/**
 * How many records a pushed document carries.
 *
 * Every record MeinBüro sends to a shop — stock, price or article — is keyed on
 * `ArtikelnummerWebshop`, so counting that element counts records without
 * guessing the name of the wrapper around them.
 */
export const countRecords = (xml: string): number => xml.match(/<ArtikelnummerWebshop[\s/>]/g)?.length ?? 0

/** Sortable, and safe as an object key whatever MeinBüro put in the parameters. */
export const captureKey = (now: Date, file: string, sync: string | undefined, refused = false): string => {
	const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)
	const name = [safe(file.replace(/\.php$/i, "")), sync ? safe(sync) : null].filter(Boolean).join("_")
	return `erp/meinbuero/captures/${refused ? "refused/" : ""}${now.toISOString().replaceAll(":", "-")}_${name}.json`
}

const xml = (body: string): Reply => ({ status: 200, contentType: "text/xml; charset=utf-8", body })

/**
 * What the PHP connector would print for this call.
 *
 * Pushes are acknowledged with the number of records received and applied to
 * nothing — this is the capture stage, which exists to learn what MeinBüro
 * sends before anything is written. Orders come back empty for the same reason:
 * the shop's real orders must not land in their ERP during a test.
 */
export const reply = async (operation: Operation, context: ReplyContext): Promise<Reply> => {
	switch (operation.kind) {
		case "orders":
			return { status: 200, contentType: "text/plain; charset=utf-8", body: emptyOrderNotification() }

		case "markFetched":
			return /^\d+$/.test(operation.id)
				? xml(successXml(`Der Status der Bestellung '${operation.id}' wurde gesetzt.`, context.now))
				: xml(errorXml('Der übergebene Parameter "id" besitzt keinen gültigen Wert.', "mb_osc_del.php", context.now))

		case "sync":
			switch (operation.sync) {
				case "stockvalue_to_shop":
				case "pricelist_to_shop":
				case "omx_to_shop": {
					const records = countRecords(context.body)
					return xml(exportProtocol(records, records))
				}
				case "articlelist_from_shop":
					return xml(articleList(await context.articles()))
				case "paging_informationen":
					return xml(pagingInformation(await context.articleCount()))
				case "check_open_orders":
					return xml("0")
				case "shop_to_omx":
					return xml(emptyArticleImport())
				default:
					return xml("")
			}

		case "check":
			switch (operation.callName) {
				case "check_function":
					return { status: 200, contentType: "text/html; charset=utf-8", body: ANSWERED_FUNCTIONS.has(operation.functionName ?? "") ? "1" : "" }
				case "check_version":
					return { status: 200, contentType: "text/html; charset=utf-8", body: CONNECTOR_VERSION }
				default:
					return { status: 200, contentType: "text/html; charset=utf-8", body: "" }
			}

		case "info":
			return {
				status: 200,
				contentType: "application/json; charset=utf-8",
				body: JSON.stringify({ shop: "astano", connectorVersion: CONNECTOR_VERSION, mode: "capture" }, null, 2),
			}

		case "unknown":
			return { status: 404, contentType: "text/plain; charset=utf-8", body: "Not found" }
	}
}
