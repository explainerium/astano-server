import type { PaymentGateway, PaymentGatewayMode, PaymentGatewayProvider } from "@prisma/client"
import { env } from "../../../config"
import { httpStatus } from "../../../shared/httpStatus"
import { prisma } from "../../../shared/prisma"
import { maskSecret, open, seal } from "../../../shared/secretBox"
import ApiError from "../../errors/ApiError"
import { PROVIDERS, defaultMethods, type ProviderDefinition } from "./providers"
import * as stripeAdapter from "./stripe.adapter"

/**
 * Payment provider configuration, as the client manages it.
 *
 * Two rules shape everything here:
 *
 *   1. A secret goes in and never comes out. The API accepts a key and returns
 *      only a mask of it. There is no endpoint that reveals a stored key,
 *      because there is no screen that needs one — and a leaked admin session
 *      should not be a leaked Stripe account.
 *
 *   2. Nothing goes live untested. Switching a gateway on requires a successful
 *      connection test against the mode being switched to, so a half-pasted key
 *      fails in this screen rather than at a customer's checkout.
 */

type Credentials = Record<string, string>

const definition = (provider: PaymentGatewayProvider): ProviderDefinition => PROVIDERS[provider]

const credentialsFor = (row: PaymentGateway, mode: PaymentGatewayMode): Credentials =>
	((mode === "LIVE" ? row.liveCredentials : row.testCredentials) ?? {}) as Credentials

/** Decrypts one stored value, or null when it was never set. */
const readCredential = (
	row: PaymentGateway,
	mode: PaymentGatewayMode,
	key: string
): string | null => {
	const sealed = credentialsFor(row, mode)[key]
	return sealed ? open(sealed) : null
}

/**
 * The whole credential set for a mode, decrypted.
 *
 * Internal only. Nothing that returns to a browser calls this.
 */
export const openCredentials = (
	row: PaymentGateway,
	mode: PaymentGatewayMode = row.mode
): Credentials => {
	const sealed = credentialsFor(row, mode)
	return Object.fromEntries(Object.entries(sealed).map(([key, value]) => [key, open(value)]))
}

/** How each stored value is described to the admin: set or not, and a hint of which. */
const describeCredentials = (row: PaymentGateway, mode: PaymentGatewayMode) => {
	const stored = credentialsFor(row, mode)

	return Object.fromEntries(
		definition(row.provider).fields.map((field) => {
			const sealed = stored[field.key]
			return [
				field.key,
				{
					isSet: Boolean(sealed),
					// Masked from the decrypted value, so the admin recognises what is
					// there without it being usable. Never the value itself.
					preview: sealed ? maskSecret(open(sealed)) : null,
				},
			]
		})
	)
}

/**
 * One gateway, as the admin screen sees it.
 *
 * Carries its own field and method definitions so the screen is rendered from
 * the API rather than from a copy of the provider list kept in the frontend —
 * one place to add a field, one place to fix a help string.
 */
const view = (row: PaymentGateway) => {
	const def = definition(row.provider)

	return {
		provider: row.provider,
		label: def.label,
		dashboardUrl: def.dashboardUrl,
		isActive: row.isActive,
		mode: row.mode,
		enabledMethods: row.enabledMethods.length ? row.enabledMethods : defaultMethods(row.provider),
		fields: def.fields,
		methods: def.methods,
		/** Handed to the client to paste into the provider's dashboard. */
		webhookUrl: `${env.PUBLIC_BASE_URL}${def.webhookPath}`,
		credentials: {
			TEST: describeCredentials(row, "TEST"),
			LIVE: describeCredentials(row, "LIVE"),
		},
		lastTest: row.testedAt
			? {
					at: row.testedAt,
					mode: row.testedMode,
					succeeded: row.testSucceeded,
					message: row.testMessage,
				}
			: null,
		updatedAt: row.updatedAt,
	}
}

/** Every provider, whether or not it has ever been configured. */
const list = async () => {
	const rows = await prisma.paymentGateway.findMany()
	const byProvider = new Map(rows.map((row) => [row.provider, row]))

	// The screen shows a card per provider from the first visit, so a provider
	// with no row yet is materialised on read rather than hidden until saved.
	const providers = Object.keys(PROVIDERS) as PaymentGatewayProvider[]

	return Promise.all(
		providers.map(async (provider) => {
			const existing = byProvider.get(provider)
			if (existing) return view(existing)

			const created = await prisma.paymentGateway.create({
				data: { provider, enabledMethods: defaultMethods(provider) },
			})
			return view(created)
		})
	)
}

const load = async (provider: PaymentGatewayProvider): Promise<PaymentGateway> => {
	const row = await prisma.paymentGateway.findUnique({ where: { provider } })
	if (row) return row

	return prisma.paymentGateway.create({
		data: { provider, enabledMethods: defaultMethods(provider) },
	})
}

const getOne = async (provider: PaymentGatewayProvider) => view(await load(provider))

/**
 * Saves credentials for one mode.
 *
 * A field left blank is left alone, not cleared. The screen cannot show what is
 * stored, so an empty box means "I did not touch this" — treating it as "delete
 * it" would wipe a working key every time somebody edited the field next to it.
 * Clearing is explicit, via `null`.
 *
 * Saving invalidates the recorded test. The keys have changed; whatever passed
 * before proved nothing about what is stored now.
 */
const saveCredentials = async (
	provider: PaymentGatewayProvider,
	mode: PaymentGatewayMode,
	input: Record<string, string | null>
) => {
	const row = await load(provider)
	const def = definition(provider)
	const stored = { ...credentialsFor(row, mode) }

	for (const field of def.fields) {
		if (!(field.key in input)) continue

		const value = input[field.key]

		// Explicitly cleared. `undefined` cannot reach here — the key is present.
		if (value === null || value === undefined) {
			delete stored[field.key]
			continue
		}

		const trimmed = value.trim()
		if (!trimmed) continue

		stored[field.key] = seal(trimmed)
	}

	const updated = await prisma.paymentGateway.update({
		where: { provider },
		data: {
			[mode === "LIVE" ? "liveCredentials" : "testCredentials"]: stored,
			...(mode === row.mode
				? { testedAt: null, testedMode: null, testSucceeded: null, testMessage: null }
				: {}),
			// Credentials for the mode currently in use changed, so the gateway
			// drops out of service until it is tested again. Better a shop with one
			// fewer payment option for a minute than a checkout that 500s.
			...(mode === row.mode && row.isActive ? { isActive: false } : {}),
		},
	})

	return view(updated)
}

/**
 * Calls the provider with the stored keys and records what came back.
 *
 * The result is persisted, not just returned, because switching the gateway on
 * checks it — and because "it worked when I set it up" is the first thing
 * anybody wants to know three months later.
 */
const testConnection = async (provider: PaymentGatewayProvider, mode: PaymentGatewayMode) => {
	const row = await load(provider)
	const def = definition(provider)

	const missing = def.fields
		.filter((field) => field.required && !credentialsFor(row, mode)[field.key])
		.map((field) => field.label)

	if (missing.length) {
		const result = {
			ok: false,
			message: `Still needed: ${missing.join(", ")}.`,
		}
		await record(provider, mode, result)
		return result
	}

	if (provider !== "STRIPE") {
		const result = { ok: false, message: "This provider is not connected yet." }
		await record(provider, mode, result)
		return result
	}

	const secretKey = readCredential(row, mode, "secretKey")!
	const result = await stripeAdapter.testConnection(secretKey, mode === "LIVE")

	await record(provider, mode, result)
	return result
}

const record = (
	provider: PaymentGatewayProvider,
	mode: PaymentGatewayMode,
	result: { ok: boolean; message: string }
) =>
	prisma.paymentGateway.update({
		where: { provider },
		data: {
			testedAt: new Date(),
			testedMode: mode,
			testSucceeded: result.ok,
			testMessage: result.message,
		},
	})

/**
 * Turning a gateway on, switching modes, choosing methods.
 *
 * The guard is here rather than in validation because it needs the stored test
 * result: a gateway may only be switched on when the mode it will run in has
 * passed a connection test. Switching a *live* gateway back to test mode is
 * always allowed — that direction cannot take a customer's money.
 */
const updateSettings = async (
	provider: PaymentGatewayProvider,
	input: { isActive?: boolean; mode?: PaymentGatewayMode; enabledMethods?: string[] }
) => {
	const row = await load(provider)
	const def = definition(provider)

	const nextMode = input.mode ?? row.mode
	const nextActive = input.isActive ?? row.isActive

	if (nextActive) {
		const testedThisMode =
			row.testSucceeded === true && row.testedMode === nextMode && !modeCredentialsChanged(row)

		if (!testedThisMode) {
			throw new ApiError(
				httpStatus.CONFLICT,
				`Run a successful connection test in ${nextMode === "LIVE" ? "Live" : "Test"} mode before switching this on.`,
				{ messageKey: "payment.untested" }
			)
		}
	}

	if (input.enabledMethods) {
		const known = new Set(def.methods.map((method) => method.code))
		const unknown = input.enabledMethods.filter((code) => !known.has(code))

		if (unknown.length) {
			throw new ApiError(httpStatus.BAD_REQUEST, `Unknown method: ${unknown.join(", ")}`, {
				messageKey: "payment.unknownMethod",
			})
		}

		if (nextActive && !input.enabledMethods.length) {
			throw new ApiError(httpStatus.BAD_REQUEST, "An active gateway needs at least one method.", {
				messageKey: "payment.noMethods",
			})
		}
	}

	const updated = await prisma.paymentGateway.update({
		where: { provider },
		data: {
			...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
			...(input.mode !== undefined ? { mode: input.mode } : {}),
			...(input.enabledMethods ? { enabledMethods: input.enabledMethods } : {}),
		},
	})

	return view(updated)
}

/**
 * Whether the recorded test still describes what is stored.
 *
 * saveCredentials clears the test when it touches the active mode, so a
 * surviving test is by construction about the current keys. Kept as a named
 * check so the intent survives a future edit to either side.
 */
const modeCredentialsChanged = (row: PaymentGateway): boolean =>
	row.testedAt === null || row.testSucceeded === null

export const PaymentGatewayService = {
	list,
	getOne,
	saveCredentials,
	testConnection,
	updateSettings,
	openCredentials,
}
