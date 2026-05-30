import { getCachedAvailability, getCachedModels, setCachedAvailability, setCachedModels } from "../lib/cache.js";
import { createLogger } from "../lib/logger.js";
import { AbstractOpenAICompatibleProvider } from "./abstract-openai-compatible-provider.js";

const log = createLogger("lmstudio");

const FALLBACK_MODELS = [{ id: "local-model", label: "local-model", hint: "Loaded in LM Studio" }];

const BASE_URL = "http://localhost:1234";

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
      const response = await fetch(`${BASE_URL}/api/v1/models`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        log.warn("Failed to fetch LM Studio models:", response.status);
        return FALLBACK_MODELS;
      }

      const data = await response.json();

      const models = (data.models || []).map((m) => {
        const loaded = m.loaded_instances && m.loaded_instances.length > 0;
        return {
          id: m.key,
          label: m.display_name || m.key,
          hint: loaded ? "\u2713 Loaded" : "Local LLM via LM Studio",
        };
      });

      // Prioritize loaded models at top of list
      const loaded = models.filter((m) => m.hint === "\u2713 Loaded");
      const others = models.filter((m) => m.hint !== "\u2713 Loaded");
      const sorted = [...loaded, ...others];

      setCachedModels(LMStudioProvider.id, sorted);
      return sorted;
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
      const response = await fetch(`${BASE_URL}/v1/models`, {
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

  static async onModelUnloaded(oldModelId) {
    if (!oldModelId || oldModelId === "local-model") return;
    try {
      const response = await fetch(`${BASE_URL}/api/v1/models/unload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instance_id: oldModelId }),
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        log.info(`Unloaded previous model: ${oldModelId}`);
      } else if (response.status === 404) {
        log.debug(`Model ${oldModelId} not found in LM Studio (already unloaded)`);
      } else {
        log.warn(`Unload returned ${response.status} for ${oldModelId}`);
      }
    } catch (err) {
      log.warn(`Failed to unload ${oldModelId}: ${err.message}`);
    }
  }

  constructor(apiKey, model) {
    super(apiKey, model);
    this.endpoint = `${BASE_URL}/v1/chat/completions`;
  }

  _onApiError(status, _err, _response) {
    if (status === 403) {
      return "LM Studio blocked the request (403). Make sure 'CORS' is disabled in Local CORS settings.";
    }
    return null;
  }
}
