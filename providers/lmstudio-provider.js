import { AbstractOpenAICompatibleProvider } from "./abstract-openai-compatible-provider.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("lmstudio");

let modelsCache = null;
let modelsCacheTimestamp = 0;
const MODELS_CACHE_TTL = 5 * 60 * 1000;

const FALLBACK_MODELS = [
  { id: "local-model", label: "local-model", hint: "Loaded in LM Studio" },
];

export class LMStudioProvider extends AbstractOpenAICompatibleProvider {
  static get id() {
    return "lmstudio";
  }

  static get displayName() {
    return "LM Studio";
  }

  static get keyPlaceholder() {
    return "not needed for local use";
  }

  static get defaultModel() {
    return "local-model";
  }

  static get availabilityHint() {
    return "Make sure LM Studio is running with local CORS off";
  }

  static get requiresApiKey() { return false; }

  static async getModels() {
    const now = Date.now();
    if (modelsCache && now - modelsCacheTimestamp < MODELS_CACHE_TTL) {
      return modelsCache;
    }

    try {
      const response = await fetch("http://localhost:1234/v1/models", {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        log.warn("Failed to fetch LM Studio models:", response.status);
        return FALLBACK_MODELS;
      }

      const data = await response.json();

      modelsCache = (data.data || []).map((model) => ({
        id: model.id,
        label: model.id,
        hint: "Local LLM via LM Studio",
      }));
      modelsCacheTimestamp = now;

      return modelsCache;
    } catch (error) {
      log.warn("Error fetching LM Studio models:", error.message);
      return FALLBACK_MODELS;
    }
  }

  static get models() {
    return modelsCache && modelsCache.length > 0 ? modelsCache : FALLBACK_MODELS;
  }

  static async isAvailable() {
    try {
      const response = await fetch("http://localhost:1234/v1/models", {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  constructor(apiKey, model) {
    super(apiKey, model);
    this.endpoint = "http://localhost:1234/v1/chat/completions";
  }

  _onApiError(status, err, response) {
    if (status === 403) {
      return "LM Studio blocked the request (403). Make sure 'CORS' is disabled in Local CORS settings.";
    }
    return null;
  }
}
