import Anthropic from "@anthropic-ai/sdk"
import type { Prompts } from "../../../domain/ai/prompt"

/**
 * Claude, through Anthropic's own SDK.
 *
 * A client per call rather than a module-level singleton: the key is a setting
 * the shop can change at any moment, and a cached client would keep using the
 * revoked one until the next deploy. Constructing one is cheap — it holds
 * configuration, not a connection.
 */
export const generateWithAnthropic = async (params: {
	apiKey: string
	model: string
	prompts: Prompts
}): Promise<string> => {
	const client = new Anthropic({ apiKey: params.apiKey })

	const response = await client.messages.create({
		model: params.model,
		max_tokens: params.prompts.maxTokens,
		system: params.prompts.system,
		messages: [{ role: "user", content: params.prompts.user }],
	})

	/*
	 * `content` is a list of blocks, not a string.
	 *
	 * Thinking models return a thinking block before the text one, so taking
	 * `content[0]` would hand the editor an empty string on exactly the models
	 * worth using. Every text block is joined, in order.
	 */
	return response.content
		.filter((block): block is Anthropic.TextBlock => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim()
}
