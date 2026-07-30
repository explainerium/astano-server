import { Prisma } from "@prisma/client"
import { prisma } from "../../../shared/prisma"

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
export const KNOWN_SETTINGS = {
	"company.name": "Legal entity on invoices",
	"company.street": "Street address",
	"company.postcode": "Postcode",
	"company.city": "City",
	"company.countryCode": "ISO country code",
	"company.vatId": "VAT identification number",
	"company.registerNumber": "Commercial register number",
	"company.email": "Contact address shown to customers",
	"company.phone": "Contact phone",
	"company.website": "Shop URL",
	"invoice.footer": "Free text printed at the foot of every invoice",
	"invoice.numberPrefix": "Prefix for invoice numbers",
	"mail.fromName": "Display name on outgoing email",
	"mail.fromAddress": "From address on outgoing email",
	"mail.adminNotifyAddress": "Where new orders and quote requests are announced",
} as const

export interface CompanyDetails {
	name: string
	street: string
	postcode: string
	city: string
	countryCode: string
	vatId: string
	registerNumber: string
	email: string
	phone: string
	website: string
	invoiceFooter: string
}

const asString = (value: unknown): string =>
	value === null || value === undefined ? "" : String(value)

const getAll = async (opts: { publicOnly?: boolean } = {}) => {
	const rows = await prisma.setting.findMany({
		where: opts.publicOnly ? { isPublic: true } : {},
		orderBy: { key: "asc" },
	})

	return rows.map((r) => ({ key: r.key, value: r.value, isPublic: r.isPublic, updatedAt: r.updatedAt }))
}

const getMap = async (): Promise<Record<string, unknown>> => {
	const rows = await prisma.setting.findMany()
	return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/** Company block for invoices and email footers, blanks where unset. */
const getCompany = async (): Promise<CompanyDetails> => {
	const map = await getMap()

	return {
		name: asString(map["company.name"]),
		street: asString(map["company.street"]),
		postcode: asString(map["company.postcode"]),
		city: asString(map["company.city"]),
		countryCode: asString(map["company.countryCode"]),
		vatId: asString(map["company.vatId"]),
		registerNumber: asString(map["company.registerNumber"]),
		email: asString(map["company.email"]),
		phone: asString(map["company.phone"]),
		website: asString(map["company.website"]),
		invoiceFooter: asString(map["invoice.footer"]),
	}
}

/** Upserts many at once — the admin screen saves a whole form. */
const setMany = async (entries: { key: string; value: unknown; isPublic?: boolean }[]) => {
	await prisma.$transaction(
		entries.map((e) =>
			prisma.setting.upsert({
				where: { key: e.key },
				create: {
					key: e.key,
					value: (e.value ?? Prisma.JsonNull) as Prisma.InputJsonValue,
					isPublic: e.isPublic ?? false,
				},
				update: {
					value: (e.value ?? Prisma.JsonNull) as Prisma.InputJsonValue,
					...(e.isPublic !== undefined ? { isPublic: e.isPublic } : {}),
				},
			})
		)
	)

	return getAll()
}

const remove = async (key: string) => {
	await prisma.setting.deleteMany({ where: { key } })
}

export const SettingService = { getAll, getMap, getCompany, setMany, remove, KNOWN_SETTINGS }
