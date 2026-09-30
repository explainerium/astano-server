import type { CleverReachReceiver } from "../../../domain/newsletter/cleverreachReceiver"
import { SettingService } from "../setting/setting.service"

/**
 * CleverReach's REST API (v3), over plain HTTPS.
 *
 * No SDK: CleverReach publishes one for PHP only, and three calls — a token,
 * the list of groups and an upsert — are not worth a dependency in a backend
 * bundled for a serverless runtime. Docs:
 * https://developers.cleverreach.com/docs/api-categories/introduction
 */
const API = "https://rest.cleverreach.com/v3"
const TOKEN_URL = "https://rest.cleverreach.com/oauth/token.php"
/** Outside /v3: https://developers.cleverreach.com/docs/guides/webhooks/ */
const HOOKS = "https://rest.cleverreach.com/hooks/eventhook"

/** The one event the shop listens for. */
export const UNSUBSCRIBE_EVENT = "receiver.unsubscribed"

/** Upserts are sent in batches; a first sync may carry the whole list. */
export const UPSERT_BATCH = 100

export interface CleverReachConfig {
	enabled: boolean
	clientId: string
	clientSecret: string
	groupId: string
}

const asString = (value: unknown): string =>
	value === null || value === undefined ? "" : String(value).trim()

export const readConfig = async (): Promise<CleverReachConfig> => {
	const map = await SettingService.getMap()

	return {
		enabled: map["cleverreach.enabled"] === true,
		clientId: asString(map["cleverreach.clientId"]),
		clientSecret: await SettingService.readSecret("cleverreach.clientSecret"),
		groupId: asString(map["cleverreach.groupId"]),
	}
}

/**
 * CleverReach's own sentence, not ours.
 *
 * "invalid_client", "Unauthorized: invalid token" and "group not found" are
 * three different fixes, and the API names each one. OAuth errors and API
 * errors come in two different shapes, so both are read.
 */
const messageOf = (body: unknown, status: number): string => {
	const b = (body ?? {}) as {
		error?: string | { message?: string; code?: number }
		error_description?: string
		message?: string
	}
	if (typeof b.error === "object" && b.error?.message) return b.error.message
	if (b.error_description) return b.error_description
	if (typeof b.error === "string") return b.error
	if (b.message) return b.message
	return `CleverReach answered ${status}`
}

/*
 * The access token, kept for as long as this instance lives.
 *
 * CleverReach issues them for a year, so a warm server asks once; a cold one
 * asks again, which costs one request and nothing else. Keyed by client id so
 * that pasting a different app's credentials is never answered with the old
 * app's token.
 */
let cached: { clientId: string; token: string; expiresAt: number } | null = null

/**
 * A token for the shop's own CleverReach account.
 *
 * The client-credentials grant: the app's id and secret, nothing from a
 * person's login. Created at Account → Extras → REST API.
 */
const token = async (config: CleverReachConfig): Promise<string> => {
	if (cached && cached.clientId === config.clientId && cached.expiresAt > Date.now()) {
		return cached.token
	}

	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "client_credentials",
			client_id: config.clientId,
			client_secret: config.clientSecret,
		}),
	})

	const body = (await response.json().catch(() => ({}))) as {
		access_token?: string
		expires_in?: number
	}

	if (!response.ok || !body.access_token) throw new Error(messageOf(body, response.status))

	// A day short of what CleverReach says, so a token is never used in the
	// minute it runs out.
	const lifetime = Math.max(60, (body.expires_in ?? 3600) - 86_400) * 1000
	cached = { clientId: config.clientId, token: body.access_token, expiresAt: Date.now() + lifetime }

	return body.access_token
}

const call = async <T>(
	config: CleverReachConfig,
	method: "GET" | "POST" | "DELETE",
	/** A path under /v3, or a full URL for the hooks endpoint, which is not. */
	path: string,
	payload?: unknown
): Promise<T> => {
	const response = await fetch(path.startsWith("https://") ? path : `${API}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${await token(config)}`,
			...(payload === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: payload === undefined ? undefined : JSON.stringify(payload),
	})

	const body = await response.json().catch(() => null)

	if (response.status === 401) cached = null
	if (!response.ok) throw new Error(messageOf(body, response.status))

	return body as T
}

export interface CleverReachGroup {
	id: number
	name: string
	/** Active receivers, where CleverReach reports it. */
	receiverCount: number | null
}

/** Every group (list) in the account — what the admin picks the group from. */
export const listGroups = async (config: CleverReachConfig): Promise<CleverReachGroup[]> => {
	const rows = await call<{ id: number; name: string; receiver_count?: number }[]>(
		config,
		"GET",
		"/groups"
	)

	return (rows ?? []).map((row) => ({
		id: row.id,
		name: row.name,
		receiverCount: typeof row.receiver_count === "number" ? row.receiver_count : null,
	}))
}

/** Creates or updates these receivers in the configured group. */
export const upsertReceivers = async (
	config: CleverReachConfig,
	receivers: CleverReachReceiver[]
): Promise<void> => {
	if (!receivers.length) return
	await call(config, "POST", `/groups/${encodeURIComponent(config.groupId)}/receivers/upsert`, receivers)
}

/**
 * One receiver of a group, by the pool id a webhook names.
 *
 * The unsubscribe webhook carries ids, not the address — the address it does
 * carry on some events is encrypted — so the address is asked for here.
 */
export const getReceiver = async (
	config: CleverReachConfig,
	groupId: string,
	poolId: string
): Promise<{ email: string; active: boolean; deactivated: number }> => {
	const row = await call<{ email?: string; active?: boolean; deactivated?: number }>(
		config,
		"GET",
		`/groups/${encodeURIComponent(groupId)}/receivers/${encodeURIComponent(poolId)}`
	)

	return { email: String(row?.email ?? ""), active: !!row?.active, deactivated: Number(row?.deactivated ?? 0) }
}

/**
 * Asks CleverReach to call `url` whenever somebody leaves `groupId`.
 *
 * CleverReach checks the URL before it answers — a GET carrying a `secret`,
 * which must be echoed back behind `verify` — so the verify token has to be
 * stored before this is called. Any earlier hook for the event is removed
 * first: CleverReach keys hooks by event name, and a second registration for a
 * different group or URL would otherwise be refused or left beside the first.
 */
export const registerUnsubscribeHook = async (
	config: CleverReachConfig,
	params: { url: string; groupId: string; verify: string }
): Promise<{ callToken: string }> => {
	await call(config, "DELETE", `${HOOKS}/${UNSUBSCRIBE_EVENT}`).catch(() => {
		// Nothing registered yet is the usual case, and not a failure.
	})

	const body = await call<{ success?: boolean; call_token?: string }>(config, "POST", HOOKS, {
		url: params.url,
		event: UNSUBSCRIBE_EVENT,
		condition: params.groupId,
		verify: params.verify,
	})

	if (!body?.call_token) throw new Error("CleverReach registered the webhook but sent no call token.")

	return { callToken: body.call_token }
}
