import { AbstractOpenAICompatibleProvider } from "./abstract-openai-compatible-provider.js";

export class GenericOpenAIProvider extends AbstractOpenAICompatibleProvider {
	static get id() {
		return "openai-compatible";
	}

	static get displayName() {
		return "OpenAI Compatible";
	}

	static get keyPlaceholder() {
		return "sk-... or your provider's key";
	}

	static get defaultModel() {
		return "gpt-4o-mini";
	}

	static get models() {
		return [
			{
				id: "gpt-4o-mini",
				label: "GPT-4o Mini",
				hint: "Most services support this",
			},
		];
	}

	static get availabilityHint() {
		return "Enter the base URL for any OpenAI-compatible API service";
	}

	constructor(apiKey, model, baseUrl) {
		super(apiKey, model);
		this.baseUrl = baseUrl || "";
		const url = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
		this.endpoint = url ? `${url}/chat/completions` : "";
	}
}
