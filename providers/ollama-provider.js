import { BaseProvider } from "./base-provider.js";
import { createLogger } from "../lib/logger.js";
import { SYSTEM_PROMPT, AI_TEMPERATURE, AI_MAX_TOKENS_MIN } from "../lib/config.js";

const log = createLogger("ollama");

// Cache for availability check to avoid too many requests
let availabilityCache = null;
let availabilityCacheTimestamp = 0;
const AVAILABILITY_CACHE_TTL = 30 * 1000; // 30 seconds

const RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "grammar_correction",
    strict: true,
    schema: {
      type: "object",
      properties: {
        corrected: { type: "string" },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              original: { type: "string" },
              replacement: { type: "string" },
              explanation: { type: "string" },
            },
            required: ["original", "replacement", "explanation"],
            additionalProperties: false,
          },
        },
      },
      required: ["corrected", "changes"],
      additionalProperties: false,
    },
  },
};

/**
 * Cache for Ollama models to avoid fetching on every access
 */
let modelsCache = null;
let modelsCacheTimestamp = 0;
const MODELS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const FALLBACK_MODELS = [
  { id: "llama3", label: "llama3", hint: "Local LLM via Ollama" },
  { id: "mistral", label: "mistral", hint: "Local LLM via Ollama" },
  { id: "gemma", label: "gemma", hint: "Local LLM via Ollama" },
];

export class OllamaProvider extends BaseProvider {
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

  /**
   * Fetch models from Ollama API. Caches on success, returns fallbacks on failure
   * without updating cache (lazy — next call retries fetch).
   * @returns {Promise<Array<{id: string, label: string, hint: string}>>}
   */
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
      // Lazy: don't update cache on failure
      return FALLBACK_MODELS;
    }
  }

  /** Synchronous accessor: cache → fallback. Doesn't trigger fetch. */
  static get models() {
    return modelsCache && modelsCache.length > 0 ? modelsCache : FALLBACK_MODELS;
  }

  /**
   * Check if Ollama is available by attempting to reach its API
   * @returns {Promise<boolean>} - true if Ollama is reachable
   */
  static async isAvailable() {
    // Check cache first
    const now = Date.now();
    if (availabilityCache !== null && now - availabilityCacheTimestamp < AVAILABILITY_CACHE_TTL) {
      return availabilityCache;
    }

    try {
      // Try to reach Ollama's API endpoint
      const response = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(5000),
      });

      const isAvailable = response.ok;
      // Cache the result
      availabilityCache = isAvailable;
      availabilityCacheTimestamp = now;

      log.info(`Ollama availability check: ${isAvailable}`);
      return isAvailable;
    } catch (error) {
      log.info(`Ollama availability check failed: ${error.message}`);
      // Cache the failure result
      availabilityCache = false;
      availabilityCacheTimestamp = now;
      return false;
    }
  }

  constructor(apiKey, model) {
    super(apiKey, model);
    // Ollama OpenAI-compatible endpoint
    this.endpoint = "http://localhost:11434/v1/chat/completions";
  }

  /**
   * Ollama doesn't strictly require an API key when running locally,
   * but we validate it for compatibility with the OpenAI API format.
   * Users can provide any non-empty string if their Ollama instance
   * doesn't require authentication.
   */
  validateApiKey() {
    if (typeof this.apiKey !== "string") {
      log.error("API key validation failed — key is not a string");
      throw new Error("API key is required");
    }
    if (this.apiKey.trim() === "") {
      log.debug("API key is empty — allowing for local Ollama instances without auth");
    } else {
      log.debug("API key validated");
    }
    return true;
  }

  async _doCorrectGrammar(text) {
    const maxTokens = Math.max(text.length * 3, AI_MAX_TOKENS_MIN);

    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      temperature: AI_TEMPERATURE,
      max_tokens: maxTokens,
      response_format: RESPONSE_SCHEMA,
    };

    log.info(`API request → ${this.endpoint}`, { model: this.model, inputLength: text.length });
    log.debug("Request payload:", payload);
    log.debug("API key: configured");

    const endTimer = log.time("ollama-api-call");
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Ollama doesn't require API key but we send it for compatibility
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      endTimer();
      const err = await response.json().catch(() => ({}));
      log.error(`API error ${response.status}:`, err);
      if (response.status === 403) {
        throw new Error(
          "Ollama blocked the request (403). Fix: kill Ollama app, then run: OLLAMA_ORIGINS=* ollama serve",
        );
      }
      if (response.status === 400) {
        throw new Error(
          err.error?.message ||
            `Ollama rejected the request (400). Try a different model or update Ollama.`,
        );
      }
      throw new Error(err.error?.message || `Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    endTimer();

    log.group("API response", () => {
      log.info(`Status: ${response.status}`);
      log.info(`Model used: ${data.model}`);
      if (data.usage) {
        log.info(
          `Tokens — prompt: ${data.usage.prompt_tokens}, completion: ${data.usage.completion_tokens}, total: ${data.usage.total_tokens}`,
        );
      }
    });

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      log.error("Empty content in API response:", data);
      throw new Error("Empty response from Ollama");
    }

    log.debug("Raw response content:", content);

    try {
      const parsed = JSON.parse(content);
      log.info(`Parsed result — ${parsed.changes?.length || 0} corrections`);

      return {
        ...parsed,
        usage: data.usage || null,
      };
    } catch (e) {
      log.error("JSON parse failed. Raw content:", content);
      throw new Error("Failed to parse grammar correction response");
    }
  }
}
