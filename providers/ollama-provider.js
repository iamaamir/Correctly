import { AbstractOpenAICompatibleProvider } from "./abstract-openai-compatible-provider.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("ollama");

let availabilityCache = null;
let availabilityCacheTimestamp = 0;
const AVAILABILITY_CACHE_TTL = 30 * 1000;

let modelsCache = null;
let modelsCacheTimestamp = 0;
const MODELS_CACHE_TTL = 5 * 60 * 1000;

const FALLBACK_MODELS = [
  { id: "llama3", label: "llama3", hint: "Local LLM via Ollama" },
  { id: "mistral", label: "mistral", hint: "Local LLM via Ollama" },
  { id: "gemma", label: "gemma", hint: "Local LLM via Ollama" },
];

export class OllamaProvider extends AbstractOpenAICompatibleProvider {
  static get id() {
    return "ollama";
  }

  static get displayName() {
    return "Ollama";
  }

  static get keyPlaceholder() {
    return "your ollama API key";
  }

  static get defaultModel() {
    return "llama3";
  }

  static get availabilityHint() {
    return "Make sure Ollama is up and running";
  }

  static get requiresApiKey() { return false; }

  static async getModels() {
    const now = Date.now();
    if (modelsCache && now - modelsCacheTimestamp < MODELS_CACHE_TTL) {
      return modelsCache;
    }

    try {
      const response = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        log.warn("Failed to fetch Ollama models:", response.status);
        return FALLBACK_MODELS;
      }

      const data = await response.json();

      modelsCache = data.models.map((model) => {
        let hint = "Local LLM via Ollama";
        if (model.details?.parameter_size) {
          hint = `${model.details.parameter_size} model`;
        } else if (model.details?.family) {
          hint = `${model.details.family} family model`;
        }
        return { id: model.name, label: model.name, hint };
      });
      modelsCacheTimestamp = now;

      return modelsCache;
    } catch (error) {
      log.warn("Error fetching Ollama models:", error.message);
      return FALLBACK_MODELS;
    }
  }

  static get models() {
    return modelsCache && modelsCache.length > 0 ? modelsCache : FALLBACK_MODELS;
  }

  static async isAvailable() {
    const now = Date.now();
    if (availabilityCache !== null && now - availabilityCacheTimestamp < AVAILABILITY_CACHE_TTL) {
      return availabilityCache;
    }

    try {
      const response = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(5000),
      });

      const isAvailable = response.ok;
      availabilityCache = isAvailable;
      availabilityCacheTimestamp = now;

      log.info(`Ollama availability check: ${isAvailable}`);
      return isAvailable;
    } catch (error) {
      log.info(`Ollama availability check failed: ${error.message}`);
      availabilityCache = false;
      availabilityCacheTimestamp = now;
      return false;
    }
  }

  constructor(apiKey, model) {
    super(apiKey, model);
    this.endpoint = "http://localhost:11434/v1/chat/completions";
  }

  _onApiError(status, err, response) {
    if (status === 403) {
      return "Ollama blocked the request (403). Fix: kill Ollama app, then run: OLLAMA_ORIGINS=* ollama serve";
    }
    if (status === 400) {
      return err.error?.message || "Ollama rejected the request (400). Try a different model or update Ollama.";
    }
    return null;
  }
}
