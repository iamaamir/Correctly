import { createLogger } from "../lib/logger.js";
import { AbstractOpenAICompatibleProvider } from "./abstract-openai-compatible-provider.js";

const log = createLogger("openai");

export class OpenAIProvider extends AbstractOpenAICompatibleProvider {
  static get id() {
    return "openai";
  }

  static get displayName() {
    return "OpenAI";
  }

  static get keyPlaceholder() {
    return "sk-...";
  }

  static get defaultModel() {
    return "gpt-4o-mini";
  }

  static get models() {
    return [
      { id: "gpt-4o-mini", label: "GPT-4o Mini", hint: "Fast & cheap" },
      { id: "gpt-4o", label: "GPT-4o", hint: "Best quality" },
      { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", hint: "Fastest, lowest cost" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", hint: "Balanced" },
      { id: "gpt-4.1", label: "GPT-4.1", hint: "Most capable" },
    ];
  }

  validateApiKey() {
    super.validateApiKey();
    if (!this.apiKey.startsWith("sk-")) {
      log.error("API key validation failed — OpenAI keys start with 'sk-'");
      throw new Error("Invalid OpenAI API key format — expected key starting with 'sk-'");
    }
    log.debug("OpenAI API key format validated");
    return true;
  }

  constructor(apiKey, model) {
    super(apiKey, model);
    this.endpoint = "https://api.openai.com/v1/chat/completions";
  }
}
