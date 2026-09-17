import {
	buildPrompts,
	buildTranslationPrompts,
	DEFAULT_MODEL,
	stripFences,
	toPlainText,
	type AiProvider,
	type GenerateInput,
	type TranslateInput,
} from "../../../domain/ai/prompt"
import { sanitizeRichText } from "../../../domain/html/sanitizeRichText"
import { httpStatus } from "../../../shared/httpStatus"
import { logger } from "../../../shared/logger"
import ApiError from "../../errors/ApiError"
import { SettingService } from "../setting/setting.service"
import { generateWithAnthropic } from "./anthropicAdapter"
import { generateWithOpenAi } from "./openaiAdapter"

/**
 * Drafting catalogue text, on request.
 *
 * Off until the shop enters a key of its own — the client's account, the
 * client's bill, and nothing is ever sent anywhere until somebody presses the
 * button in the editor. The key is stored the way the SMTP password is:
 * encrypted at rest, never returned, and left alone by a save that did not
 * touch it.
 *
 * The prompts live in `domain/ai/prompt.ts` and the providers behind the two
 * adapters beside this file, so what stays here is the part with a decision in
 * it: which provider, which model, and what the answer is allowed to contain.
 */

export interface AiStatus {
	/** The shop has switched the feature on. */
	enabled: boolean
	/** A key is stored. Whether it works is what `test` is for. */
	configured: boolean
	provider: AiProvider
	model: string
}

export interface AiTestResult {
	ok: boolean
	/** The provider's own words on failure — see the adapters. */
	message: string
	provider: AiProvider
	model: string
}

const asProvider = (value: unknown): AiProvider => (value === "openai" ? "openai" : "anthropic")

const asString = (value: unknown): string =>
	value === null || value === undefined ? "" : String(value).trim()

/** Settings plus the key, resolved once per call. */
const configuration = async () => {
	const map = await SettingService.getMap()
	const provider = asProvider(map["ai.provider"])
	const apiKey = await SettingService.readSecret("ai.apiKey")

	return {
		enabled: map["ai.enabled"] === true,
		provider,
		// An empty model setting means "whatever is right for this provider",
		// which keeps the field optional and stops a model id chosen for Claude
		// being sent to OpenAI after a provider switch.
		model: asString(map["ai.model"]) || DEFAULT_MODEL[provider],
		voice: asString(map["ai.voice"]),
		apiKey,
	}
}

const status = async (): Promise<AiStatus> => {
	const config = await configuration()

	return {
		enabled: config.enabled,
		configured: Boolean(config.apiKey),
		provider: config.provider,
		model: config.model,
	}
}

const callProvider = async (
	config: { provider: AiProvider; model: string; apiKey: string },
	prompts: ReturnType<typeof buildPrompts>
): Promise<string> =>
	config.provider === "openai"
		? generateWithOpenAi({ apiKey: config.apiKey, model: config.model, prompts })
		: generateWithAnthropic({ apiKey: config.apiKey, model: config.model, prompts })

export interface GenerateResult {
	text: string
	provider: AiProvider
	model: string
}

const generate = async (input: GenerateInput): Promise<GenerateResult> => {
	const config = await configuration()

	if (!config.enabled) {
		throw new ApiError(httpStatus.BAD_REQUEST, "AI text is switched off", {
			messageKey: "ai.disabled",
		})
	}

	if (!config.apiKey) {
		throw new ApiError(httpStatus.BAD_REQUEST, "No API key is stored", { messageKey: "ai.noKey" })
	}

	const prompts = buildPrompts({ ...input, voice: config.voice })

	let raw: string
	try {
		raw = await callProvider(config, prompts)
	} catch (error) {
		// Logged with the provider and model, never with the key or the prompt —
		// a brief can carry an unreleased product.
		logger.error(
			{ err: error, provider: config.provider, model: config.model },
			"AI text generation failed"
		)

		throw new ApiError(
			httpStatus.BAD_GATEWAY,
			error instanceof Error ? error.message : "The AI service could not be reached",
			{ messageKey: "ai.failed" }
		)
	}

	/*
	 * Cleaned the same way every other HTML field on this site is.
	 *
	 * The text goes straight into a description that the storefront renders with
	 * `dangerouslySetInnerHTML`. A model is not a hostile source, but it is an
	 * outside one, and "it only writes what we asked for" is not a property
	 * anybody can check on every press of a button.
	 */
	const text =
		input.kind === "productShort"
			? toPlainText(raw)
			: (sanitizeRichText(stripFences(raw)) ?? "")

	return { text, provider: config.provider, model: config.model }
}

/**
 * The same machinery, pointed at a translation.
 *
 * Its own entry point rather than another `kind`, because the two have opposite
 * rules: writing invents a sentence from a brief, translating must invent
 * nothing at all. Sharing a prompt would eventually let one of those leak into
 * the other.
 */
const translate = async (input: TranslateInput): Promise<GenerateResult> => {
	const config = await configuration()

	if (!config.enabled) {
		throw new ApiError(httpStatus.BAD_REQUEST, "AI text is switched off", {
			messageKey: "ai.disabled",
		})
	}

	if (!config.apiKey) {
		throw new ApiError(httpStatus.BAD_REQUEST, "No API key is stored", { messageKey: "ai.noKey" })
	}

	// Nothing to translate is not an error — the field was simply empty, and the
	// button that called this sits above several of them.
	if (!input.text.trim()) return { text: "", provider: config.provider, model: config.model }

	let raw: string
	try {
		raw = await callProvider(config, buildTranslationPrompts(input))
	} catch (error) {
		logger.error(
			{ err: error, provider: config.provider, model: config.model },
			"AI translation failed"
		)

		throw new ApiError(
			httpStatus.BAD_GATEWAY,
			error instanceof Error ? error.message : "The AI service could not be reached",
			{ messageKey: "ai.failed" }
		)
	}

	const text = input.html ? (sanitizeRichText(stripFences(raw)) ?? "") : toPlainText(raw)

	return { text, provider: config.provider, model: config.model }
}

/**
 * One tiny real request, and what the provider said about it.
 *
 * Saving a key proves nothing — it is a long string that looks right whether or
 * not it has credit on it, whether or not it was pasted from the wrong account,
 * and whether or not the chosen model exists. This is where that is found out,
 * for the price of a few tokens.
 */
const test = async (): Promise<AiTestResult> => {
	const config = await configuration()

	if (!config.apiKey) {
		return {
			ok: false,
			message: "No API key is stored yet.",
			provider: config.provider,
			model: config.model,
		}
	}

	try {
		const reply = await callProvider(config, {
			system: "Answer with one word.",
			user: "Reply with the word OK.",
			maxTokens: 16,
		})

		return {
			ok: true,
			message: reply || "The service answered.",
			provider: config.provider,
			model: config.model,
		}
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : "The service could not be reached.",
			provider: config.provider,
			model: config.model,
		}
	}
}

export const AiService = { status, generate, translate, test }
