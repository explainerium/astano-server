import { Prisma } from "@prisma/client"
import { planSettingWrite } from "../../../domain/setting/settingWrite"
import { logger } from "../../../shared/logger"
import { prisma } from "../../../shared/prisma"
import { maskSecret, open, seal } from "../../../shared/secretBox"
import { PUBLIC_KEYS, SETTINGS, SETTING_GROUPS, SETTING_SECTIONS } from "./settingRegistry"

/**
 * Store settings.
 *
 * Company details appear on every invoice and every email, so they belong here
 * rather than in environment variables only a developer can change.
 *
 * Keys are dotted and free-form; the list below documents what the rest of the
 * codebase reads, so a missing one degrades to a sensible blank rather than
 * crashing an invoice.
 */
export interface CompanyDetails {
	name: string
	street: string
	/** Optional second line — a floor, a unit, a c/o. */
	street2: string
	postcode: string
	city: string
	countryCode: string
	/** Only meaningful where tax differs within a country. */
	state: string
	vatId: string
	registerNumber: string
	email: string
	phone: string
	website: string
	invoiceFooter: string
	invoiceNumberPrefix: string
}

const asString = (value: unknown): string =>
	value === null || value === undefined ? "" : String(value)

/**
 * Settings whose value is a credential: encrypted at rest, and never returned.
 *
 * Taken from the registry rather than listed here, so declaring a setting as a
 * password is the whole of what makes it secret. A second list is a list that
 * eventually disagrees with the first, and the failure mode is a password on
 * the wire.
 */
const SECRET_KEYS = new Set(
	Object.entries(SETTINGS)
		.filter(([, definition]) => definition.type === "password")
		.map(([key]) => key)
)

export const isSecretKey = (key: string): boolean => SECRET_KEYS.has(key)

/**
 * What the admin screen may see of a stored credential: that there is one, and
 * enough of it to recognise which. Never the value.
 *
 * A secret that cannot be decrypted — a rotated `CREDENTIALS_KEY`, most likely
 * — reads as set with no preview rather than as absent. Absent would invite the
 * admin to leave the field alone, and leaving it alone is the one thing that
 * cannot fix it.
 */
const describeSecret = (stored: unknown): { isSet: boolean; preview: string | null } => {
	const sealed = asString(stored)
	if (!sealed) return { isSet: false, preview: null }

	try {
		return { isSet: true, preview: maskSecret(open(sealed)) }
	} catch {
		return { isSet: true, preview: null }
	}
}

const getAll = async (opts: { publicOnly?: boolean } = {}) => {
	const rows = await prisma.setting.findMany({
		where: opts.publicOnly ? { isPublic: true } : {},
		orderBy: { key: "asc" },
	})

	return rows.map((r) =>
		SECRET_KEYS.has(r.key)
			? {
					key: r.key,
					// Not the ciphertext either. It is not readable without the key,
					// but there is no reason for it to leave the server at all.
					value: "",
					isPublic: r.isPublic,
					updatedAt: r.updatedAt,
					...describeSecret(r.value),
				}
			: { key: r.key, value: r.value, isPublic: r.isPublic, updatedAt: r.updatedAt }
	)
}

/**
 * Decrypts a stored credential for the server's own use.
 *
 * Returns "" when unset or unreadable, and says so in the log. The callers are
 * mail and payment configuration, where a blank credential produces a clear
 * authentication failure the admin can act on; throwing here would instead take
 * down whatever request happened to be passing.
 */
const readSecret = async (key: string): Promise<string> => {
	const row = await prisma.setting.findUnique({ where: { key } })
	const sealed = asString(row?.value)

	if (!sealed) return ""

	try {
		return open(sealed)
	} catch (error) {
		logger.error(
			{ err: error, key },
			"a stored credential could not be decrypted — CREDENTIALS_KEY may have changed since it was saved"
		)
		return ""
	}
}

/**
 * Every setting as one object, credentials excluded.
 *
 * Excluded structurally rather than by asking each of the sixteen callers to
 * remember. This map is spread into email contexts and passed around as "the
 * settings"; one of those paths reaching a response is a question of when, not
 * whether. Anything that genuinely needs a credential asks for it by name
 * through `readSecret`, which is a decision the caller has to make on purpose.
 */
const getMap = async (): Promise<Record<string, unknown>> => {
	const rows = await prisma.setting.findMany()
	return Object.fromEntries(rows.filter((r) => !SECRET_KEYS.has(r.key)).map((r) => [r.key, r.value]))
}

/** Company block for invoices and email footers, blanks where unset. */
const getCompany = async (): Promise<CompanyDetails> => {
	const map = await getMap()

	return {
		name: asString(map["company.name"]),
		street: asString(map["company.street"]),
		street2: asString(map["company.street2"]),
		postcode: asString(map["company.postcode"]),
		city: asString(map["company.city"]),
		countryCode: asString(map["company.countryCode"]),
		state: asString(map["company.state"]),
		vatId: asString(map["company.vatId"]),
		registerNumber: asString(map["company.registerNumber"]),
		email: asString(map["company.email"]),
		phone: asString(map["company.phone"]),
		website: asString(map["company.website"]),
		invoiceFooter: asString(map["invoice.footer"]),
		// Applied when the PDF is rendered, not frozen onto the order. Changing it
		// renumbers invoices that have already been sent, so it is a set-once
		// setting in practice — same as WooCommerce.
		invoiceNumberPrefix: asString(map["invoice.numberPrefix"] ?? SETTINGS["invoice.numberPrefix"]!.fallback),
	}
}

/**
 * Upserts many at once — the admin screen saves a whole form.
 *
 * One multi-row statement rather than a row-per-upsert transaction. Prisma
 * sends the array form of `$transaction` sequentially, so the cost was a round
 * trip per key against a database two countries away; at ~200ms each the
 * ten-field company form came within a second or so of the 5s transaction
 * timeout, and a slower link tipped it over into a rollback that looked to the
 * admin like the save had simply not happened. One statement is also atomic
 * without needing a transaction at all.
 */
const setMany = async (entries: { key: string; value: unknown; isPublic?: boolean }[]) => {
	// Credentials are sealed on the way in, and a blank one is left alone rather
	// than written. The rule, and why, is in domain/setting/settingWrite.
	const prepared = planSettingWrite(entries, isSecretKey).map((write) =>
		write.kind === "secret"
			? { key: write.key, value: seal(write.value), isPublic: false }
			: { key: write.key, value: write.value, isPublic: write.isPublic }
	)

	if (prepared.length) {
		const rows = prepared.map(
			(e) =>
				Prisma.sql`(${e.key}, ${JSON.stringify(e.value ?? null)}::jsonb, ${e.isPublic ?? false}, now())`
		)

		await prisma.$executeRaw`
			INSERT INTO settings ("key", "value", "isPublic", "updatedAt")
			VALUES ${Prisma.join(rows)}
			ON CONFLICT ("key") DO UPDATE
			SET "value" = EXCLUDED."value",
			    "isPublic" = EXCLUDED."isPublic",
			    "updatedAt" = now()
		`
	}

	return getAll()
}

const remove = async (key: string) => {
	await prisma.setting.deleteMany({ where: { key } })
}

/**
 * Reads a setting with its declared fallback, so a fresh shop behaves sensibly
 * rather than formatting every price with an empty currency.
 */
const read = async <T = string>(key: string): Promise<T> => {
	const row = await prisma.setting.findUnique({ where: { key } })
	const value = row?.value ?? SETTINGS[key]?.fallback
	return value as T
}

/** The public block, resolved with fallbacks — what the storefront formats with. */
const getPublic = async (): Promise<Record<string, unknown>> => {
	const rows = await prisma.setting.findMany({ where: { key: { in: PUBLIC_KEYS } } })
	const stored = new Map(rows.map((r) => [r.key, r.value]))

	return Object.fromEntries(
		PUBLIC_KEYS.map((key) => [key, stored.get(key) ?? SETTINGS[key]!.fallback])
	)
}

export const SettingService = {
	getAll,
	getMap,
	getCompany,
	getPublic,
	read,
	readSecret,
	isSecretKey,
	setMany,
	remove,
	SETTINGS,
	SETTING_GROUPS,
	SETTING_SECTIONS,
}
