import { getCachedAvailability, getCachedModels, setCachedAvailability, setCachedModels } from "../lib/cache.js";
import { createLogger } from "../lib/logger.js";
import { AbstractOpenAICompatibleProvider } from "./abstract-openai-compatible-provider.js";

const log = createLogger("lmstudio");

const FALLBACK_MODELS = [{ id: "local-model", label: "local-model", hint: "Loaded in LM Studio" }];

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

  static get requiresApiKey() {
    return false;
  }

  static async getModels() {
    const cached = getCachedModels(LMStudioProvider.id);
    if (cached) return cached;

    try {
      const response = await fetch("http://localhost:1234/v1/models", {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        log.warn("Failed to fetch LM Studio models:", response.status);
        return FALLBACK_MODELS;
      }

      const data = await response.json();

      const models = (data.data || []).map((model) => ({
        id: model.id,
        label: model.id,
        hint: "Local LLM via LM Studio",
      }));
      setCachedModels(LMStudioProvider.id, models);

      return models;
    } catch (error) {
      log.warn("Error fetching LM Studio models:", error.message);
      return FALLBACK_MODELS;
    }
  }

  static get models() {
    return getCachedModels(LMStudioProvider.id) || FALLBACK_MODELS;
  }

  static async isAvailable() {
    const cached = getCachedAvailability(LMStudioProvider.id);
    if (cached !== null) return cached;

    try {
      const response = await fetch("http://localhost:1234/v1/models", {
        signal: AbortSignal.timeout(5000),
      });
      const available = response.ok;
      setCachedAvailability(LMStudioProvider.id, available);
      return available;
    } catch {
      setCachedAvailability(LMStudioProvider.id, false);
      return false;
    }
  }

  constructor(apiKey, model) {
    super(apiKey, model);
    this.endpoint = "http://localhost:1234/v1/chat/completions";
  }

  _onApiError(status, _err, _response) {
    if (status === 403) {
      return "LM Studio blocked the request (403). Make sure 'CORS' is disabled in Local CORS settings.";
    }
    return null;
  }
}
