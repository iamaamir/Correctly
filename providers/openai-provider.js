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
    return "gpt-5.4-mini";
  }

  static get models() {
    return [
      {
        id: "gpt-5.4-nano",
        label: "GPT-5.4 Nano",
        hint: "Fastest, lowest cost",
      },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", hint: "Fast & cheap" },
      { id: "gpt-5.5", label: "GPT-5.5", hint: "Balanced" },
      {
        id: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        hint: "Flagship quality, low cost",
      },
      {
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        hint: "Flagship, balanced",
      },
      {
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        hint: "Most capable",
      },
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
