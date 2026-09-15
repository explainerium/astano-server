import { describe, expect, it } from "vitest"
import {
	agentMatches,
	articleList,
	captureKey,
	countRecords,
	emptyOrderNotification,
	exportProtocol,
	operationFor,
	pagingInformation,
	reply,
	type Operation,
	type ReplyContext,
} from "../../src/domain/erp/meinbuero/protocol"

/**
 * MeinBüro Desktop's webshop interface, capture stage.
 *
 * The expected strings are what Buhl's PHP connector (23.06.07) prints. They
 * are pinned exactly because MeinBüro is a closed client: if a response drifts
 * from the shape it was written against, the symptom is an unexplained
 * "connection failed" in an office abroad, not a failing request we can see.
 */
const context = (overrides: Partial<ReplyContext> = {}): ReplyContext => ({
	now: new Date("2026-09-15T10:20:30.000Z"),
	body: "",
	articles: async () => [{ sku: "1-ESH-1", name: "Edelstahl Trinkhalm" }],
	articleCount: async () => 55,
	...overrides,
})

describe("agentMatches", () => {
	it("accepts only the exact identification", () => {
		expect(agentMatches("astano-meinbuero-test", "astano-meinbuero-test")).toBe(true)
		expect(agentMatches("astano-meinbuero-tesT", "astano-meinbuero-test")).toBe(false)
		expect(agentMatches("short", "astano-meinbuero-test")).toBe(false)
	})

	it("refuses everything when nothing is configured or nothing is offered", () => {
		expect(agentMatches("anything", undefined)).toBe(false)
		expect(agentMatches("", "")).toBe(false)
		expect(agentMatches(undefined, "astano-meinbuero-test")).toBe(false)
	})
})

describe("operationFor", () => {
	it("maps the five connector files, whatever their case", () => {
		expect(operationFor("mb_osc.php", {})).toEqual({ kind: "orders" })
		expect(operationFor("MB_OSC_DEL.PHP", { id: "7" })).toEqual({ kind: "markFetched", id: "7" })
		expect(operationFor("mb_osc_sync.php", { sync: "pricelist_to_shop" })).toEqual({ kind: "sync", sync: "pricelist_to_shop" })
		expect(operationFor("mb_osc_val.php", { CallName: "check_function", function_name: "starten" })).toEqual({
			kind: "check",
			callName: "check_function",
			functionName: "starten",
		})
		expect(operationFor("mb_osc_info.php", {})).toEqual({ kind: "info" })
		expect(operationFor("index.php", {})).toEqual({ kind: "unknown", file: "index.php" })
	})
})

describe("responses", () => {
	it("reports no orders in the connector's shape", () => {
		expect(emptyOrderNotification()).toBe(
			'<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<OrderNotification>\n</OrderNotification>'
		)
	})

	it("writes the export protocol, with nothing accepted as a rollback", () => {
		expect(exportProtocol(3, 3)).toBe(
			'<?xml version="1.0" encoding="utf-8"?><Exportprotokoll><Export_Status>SUCCESS</Export_Status>' +
				"<Anzahl_Datensaetze_Gesamt>3</Anzahl_Datensaetze_Gesamt>" +
				"<Anzahl_Datensaetze_Erfolgreich_Uebergeben>3</Anzahl_Datensaetze_Erfolgreich_Uebergeben></Exportprotokoll>"
		)
		expect(exportProtocol(0, 0)).toContain("<Export_Status>ROLLBACK</Export_Status>")
	})

	it("lists articles in CDATA, and survives a name holding the CDATA terminator", () => {
		const xml = articleList([{ sku: "1-ESH-1", name: "a]]>b & <c>" }])
		expect(xml).toContain("<ArtikelnummerWebshop><![CDATA[1-ESH-1]]></ArtikelnummerWebshop>")
		expect(xml).toContain("<Artikelbeschreibung><![CDATA[a]]]]><![CDATA[>b & <c>]]></Artikelbeschreibung>")
		expect(articleList([])).toBe('<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<ArtikelListeWebshop></ArtikelListeWebshop>\n')
	})

	it("writes a zero count as a text node, the way PHP's empty() decides", () => {
		expect(pagingInformation(0)).toContain("<ArticleCount>0</ArticleCount>")
		expect(pagingInformation(55)).toContain("<ArticleCount><![CDATA[55]]></ArticleCount>")
	})
})

describe("countRecords", () => {
	it("counts records by their article number, whatever wraps them", () => {
		const body =
			"<Lagerbestand><Artikel><ArtikelnummerWebshop>1-ESH-1</ArtikelnummerWebshop><LagerBestandAktuell>5</LagerBestandAktuell></Artikel>" +
			"<Artikel><ArtikelnummerWebshop/></Artikel><Artikel><ArtikelnummerWebshop >x</ArtikelnummerWebshop></Artikel></Lagerbestand>"
		expect(countRecords(body)).toBe(3)
		expect(countRecords("")).toBe(0)
	})
})

describe("captureKey", () => {
	it("sorts by time and cannot be steered out of its prefix", () => {
		const now = new Date("2026-09-15T10:20:30.123Z")
		expect(captureKey(now, "mb_osc_sync.php", "pricelist_to_shop")).toBe(
			"erp/meinbuero/captures/2026-09-15T10-20-30.123Z_mb_osc_sync_pricelist_to_shop.json"
		)
		expect(captureKey(now, "mb_osc.php", "../../x")).toBe("erp/meinbuero/captures/2026-09-15T10-20-30.123Z_mb_osc_______x.json")
	})
})

describe("reply", () => {
	const run = (operation: Operation, overrides?: Partial<ReplyContext>) => reply(operation, context(overrides))

	it("acknowledges pushed records without applying them", async () => {
		const body = "<x><r><ArtikelnummerWebshop>a</ArtikelnummerWebshop></r><r><ArtikelnummerWebshop>b</ArtikelnummerWebshop></r></x>"
		const answer = await run({ kind: "sync", sync: "stockvalue_to_shop" }, { body })
		expect(answer.body).toContain("<Anzahl_Datensaetze_Gesamt>2</Anzahl_Datensaetze_Gesamt>")
	})

	it("hands MeinBüro no articles to import from the shop", async () => {
		const answer = await run({ kind: "sync", sync: "shop_to_omx" })
		expect(answer.body).not.toContain("<row>")
		expect((await run({ kind: "check", callName: "check_function", functionName: "artikeldaten_shop_zu_orgamax" })).body).toBe("")
	})

	it("answers the capability and version checks", async () => {
		expect((await run({ kind: "check", callName: "check_function", functionName: "setze_Artikelpreise_im_shop" })).body).toBe("1")
		expect((await run({ kind: "check", callName: "check_version", functionName: undefined })).body).toBe("23.06.07")
	})

	it("serves the shop's article list and count", async () => {
		expect((await run({ kind: "sync", sync: "articlelist_from_shop" })).body).toContain("1-ESH-1")
		expect((await run({ kind: "sync", sync: "paging_informationen" })).body).toContain("[CDATA[55]]")
	})

	it("refuses a non-numeric order id as the connector does", async () => {
		expect((await run({ kind: "markFetched", id: "12" })).body).toContain("<orgamax_phpsuccess>")
		expect((await run({ kind: "markFetched", id: "1 OR 1" })).body).toContain("<orgamax_phperror>")
	})

	it("returns 404 for a file the connector does not have", async () => {
		expect((await run({ kind: "unknown", file: "setup.php" })).status).toBe(404)
	})
})
