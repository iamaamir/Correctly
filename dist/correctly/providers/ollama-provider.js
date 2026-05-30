import { getCachedAvailability, getCachedModels, setCachedAvailability, setCachedModels } from "../lib/cache.js";
import { createLogger } from "../lib/logger.js";
import { AbstractOpenAICompatibleProvider } from "./abstract-openai-compatible-provider.js";

const log = createLogger("ollama");

const BASE_URL = "http://localhost:11434";

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

  static get requiresApiKey() {
    return false;
  }

  static async getModels() {
    const cached = getCachedModels(OllamaProvider.id);
    if (cached) return cached;

    try {
      const [tagsResponse, psResponse] = await Promise.all([
        fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${BASE_URL}/api/ps`, { signal: AbortSignal.timeout(3000) }).catch(() => null),
      ]);

      if (!tagsResponse.ok) {
        log.warn("Failed to fetch Ollama models:", tagsResponse.status);
        return FALLBACK_MODELS;
      }

      const tagsData = await tagsResponse.json();

      // Determine which models are loaded in memory
      const loadedNames = new Set();
      if (psResponse?.ok) {
        try {
          const psData = await psResponse.json();
          for (const m of psData.models || []) loadedNames.add(m.name);
        } catch {
          /* /api/ps parse failed — treat all as unloaded */
        }
      }

      const models = tagsData.models.map((model) => {
        const loaded = loadedNames.has(model.name);
        let hint = loaded ? "\u2713 Loaded" : "Local LLM via Ollama";
        if (!loaded && model.details?.parameter_size) {
          hint = `${model.details.parameter_size} model`;
        } else if (!loaded && model.details?.family) {
          hint = `${model.details.family} family model`;
        }
        return { id: model.name, label: model.name, hint };
      });

      // Prioritize loaded models at top of list
      const loaded = models.filter((m) => m.hint === "\u2713 Loaded");
      const others = models.filter((m) => m.hint !== "\u2713 Loaded");
      const sorted = [...loaded, ...others];

      setCachedModels(OllamaProvider.id, sorted);
      return sorted;
    } catch (error) {
      log.warn("Error fetching Ollama models:", error.message);
      return FALLBACK_MODELS;
    }
  }

  static get models() {
    return getCachedModels(OllamaProvider.id) || FALLBACK_MODELS;
  }

  static async onModelUnloaded(oldModelId) {
    if (!oldModelId) return;
    try {
      const response = await fetch(`${BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: oldModelId, keep_alive: 0 }),
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        log.info(`Unloaded previous model: ${oldModelId}`);
      } else if (response.status === 404) {
        log.debug(`Model ${oldModelId} not found in Ollama`);
      } else {
        log.warn(`Unload returned ${response.status} for ${oldModelId}`);
      }
    } catch (err) {
      log.warn(`Failed to unload ${oldModelId}: ${err.message}`);
    }
  }

  static async isAvailable() {
    const cached = getCachedAvailability(OllamaProvider.id);
    if (cached !== null) return cached;

    try {
      const response = await fetch(`${BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });

      const available = response.ok;
      setCachedAvailability(OllamaProvider.id, available);

      log.info(`Ollama availability check: ${available}`);
      return available;
    } catch (error) {
      log.info(`Ollama availability check failed: ${error.message}`);
      setCachedAvailability(OllamaProvider.id, false);
      return false;
    }
  }

  constructor(apiKey, model) {
    super(apiKey, model);
    this.endpoint = `${BASE_URL}/v1/chat/completions`;
  }

  _onApiError(status, err, _response) {
    if (status === 403) {
      return "Ollama blocked the request (403). Fix: kill Ollama app, then run: OLLAMA_ORIGINS=* ollama serve";
    }
    if (status === 400) {
      return err.error?.message || "Ollama rejected the request (400). Try a different model or update Ollama.";
    }
    return null;
  }
}
