import type { Prompts } from "../../../domain/ai/prompt"

/**
 * ChatGPT, over plain HTTPS.
 *
 * No SDK. One POST to one endpoint is the whole of what this needs, and the
 * backend is bundled to CommonJS for a serverless runtime that has already had
 * one outage over a dependency's module format — a package added for a single
 * fetch is a risk with nothing on the other side of the trade.
 */
const ENDPOINT = "https://api.openai.com/v1/chat/completions"

interface ChatCompletion {
	choices?: { message?: { content?: string | null } }[]
	error?: { message?: string }
}

export const generateWithOpenAi = async (params: {
	apiKey: string
	model: string
	prompts: Prompts
}): Promise<string> => {
	const response = await fetch(ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${params.apiKey}`,
		},
		body: JSON.stringify({
			model: params.model,
			max_completion_tokens: params.prompts.maxTokens,
			messages: [
				{ role: "system", content: params.prompts.system },
				{ role: "user", content: params.prompts.user },
			],
		}),
	})

	const body = (await response.json().catch(() => ({}))) as ChatCompletion

	/*
	 * The provider's own sentence, not ours.
	 *
	 * "Incorrect API key provided", "You exceeded your current quota" and "The
	 * model `gpt-9` does not exist" are three different problems with three
	 * different fixes, and each of them names its own. Anything we wrote here
	 * would be a guess at which.
	 */
	if (!response.ok) {
		throw new Error(body.error?.message ?? `OpenAI answered ${response.status}`)
	}

	return (body.choices?.[0]?.message?.content ?? "").trim()
}
