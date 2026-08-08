import { z } from "zod"

/**
 * The bank details a customer needs in order to actually transfer the money.
 *
 * Structured rather than a paragraph of free text, and that is the whole point.
 * A customer copying an IBAN out of prose gets it wrong; a customer copying it
 * out of a labelled row does not. Structure also means the same details render
 * correctly on the thank-you page, in the confirmation email and on the
 * invoice, instead of three places each formatting a blob their own way.
 *
 * A list, not one account: a shop with a euro account and a Swiss-franc one has
 * to show both, and WooCommerce's BACS gateway models it the same way.
 *
 * Stored in PaymentMethod.config under `bankAccounts` — the column exists for
 * exactly this, and keeping it there means adding a field needs no migration.
 */

export const bankAccountSchema = z.object({
	/** What the shop calls this account when it has more than one — "EUR account". */
	label: z.string().trim().max(80).optional(),

	accountName: z.string().trim().min(1, "The account holder's name is required").max(120),
	bankName: z.string().trim().max(120).optional(),

	/**
	 * The domestic account number. Optional because within SEPA the IBAN has
	 * replaced it entirely — a German customer needs the IBAN and nothing else.
	 */
	accountNumber: z.string().trim().max(60).optional(),

	/**
	 * Checked for shape, not for validity.
	 *
	 * Length and alphabet catch the realistic mistake, which is a half-pasted or
	 * mistyped value. Verifying the checksum would reject valid test IBANs and
	 * make the field feel broken during setup, and the bank rejects a wrong one
	 * anyway — the cost of a false negative here is much higher than of a false
	 * positive.
	 */
	iban: z
		.string()
		.trim()
		.toUpperCase()
		.max(42)
		.regex(/^[A-Z]{2}[0-9A-Z\s]{10,40}$/, "That does not look like an IBAN")
		.optional()
		.or(z.literal("")),

	/** BIC or SWIFT. 8 or 11 characters. */
	bic: z
		.string()
		.trim()
		.toUpperCase()
		.max(11)
		.regex(/^[A-Z]{6}[0-9A-Z]{2}([0-9A-Z]{3})?$/, "A BIC is 8 or 11 letters and digits")
		.optional()
		.or(z.literal("")),

	/** ISO 3166-1 alpha-2. Tells an international customer where they are sending it. */
	countryCode: z
		.string()
		.trim()
		.toUpperCase()
		.length(2, "Use a 2-letter country code")
		.optional()
		.or(z.literal("")),
})

export type BankAccount = z.infer<typeof bankAccountSchema>

export const bankAccountsSchema = z.array(bankAccountSchema).max(5)

/**
 * Pulls the accounts out of a method's config, tolerating anything else in it.
 *
 * `config` is a free-form JSON column that predates this and may hold other
 * settings, so this reads its own key and ignores the rest. A malformed value
 * yields an empty list rather than throwing: a bad row in a settings blob must
 * not take down the thank-you page of an order that has already been paid for.
 */
export const readBankAccounts = (config: unknown): BankAccount[] => {
	if (!config || typeof config !== "object") return []

	const raw = (config as Record<string, unknown>).bankAccounts
	const parsed = bankAccountsSchema.safeParse(raw)

	return parsed.success ? parsed.data : []
}

/** True when there is at least one account with something worth showing. */
export const hasBankAccounts = (config: unknown): boolean =>
	readBankAccounts(config).some((account) => account.iban || account.accountNumber)
