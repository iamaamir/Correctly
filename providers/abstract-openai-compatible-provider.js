import { AI_MAX_TOKENS_MIN, AI_TEMPERATURE, SYSTEM_PROMPT, SYSTEM_PROMPT_L2, SYSTEM_PROMPT_L3 } from "../lib/config.js";
import { createLogger } from "../lib/logger.js";
import { AbstractProvider } from "./abstract-provider.js";

const RETRY_CONFIG = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 5000,
};

async function fetchWithRetry(url, options) {
  for (let i = 0; i <= RETRY_CONFIG.maxRetries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(80000),
      });
      if (!response.ok && response.status >= 500 && i < RETRY_CONFIG.maxRetries) {
        const delay = Math.min(RETRY_CONFIG.baseDelayMs * 2 ** i, RETRY_CONFIG.maxDelayMs);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return response;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Request timeout");
      if (error.name === "TypeError" && error.message.includes("fetch") && i < RETRY_CONFIG.maxRetries) {
        const delay = Math.min(RETRY_CONFIG.baseDelayMs * 2 ** i, RETRY_CONFIG.maxDelayMs);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
}

export const RESPONSE_SCHEMA = {
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
        confidence: { type: "number" },
      },
      required: ["corrected", "changes", "confidence"],
      additionalProperties: false,
    },
  },
};

export class AbstractOpenAICompatibleProvider extends AbstractProvider {
  constructor(apiKey, model) {
    super(apiKey, model);
    if (new.target === AbstractOpenAICompatibleProvider) {
      throw new Error("AbstractOpenAICompatibleProvider is abstract — extend it, do not instantiate directly");
    }
    this.endpoint = "";
  }

  /**
   * Shared API call logic. Sends a chat completion request to the configured
   * endpoint with the given system prompt and options.
   * @param {string} text — user input text
   * @param {string} systemPrompt — system message content
   * @param {{ useSchema?: boolean }} [options]
   * @returns {Promise<{content: string, usage: object|null}>}
   */
  async _callApi(text, systemPrompt, { useSchema = true } = {}) {
    const log = createLogger(this.providerId);
    const maxTokens = Math.max(text.length * 3, AI_MAX_TOKENS_MIN);

    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: AI_TEMPERATURE,
      max_tokens: maxTokens,
    };
    if (useSchema) payload.response_format = RESPONSE_SCHEMA;

    log.info(`API request → ${this.endpoint}`, {
      model: this.model,
      inputLength: text.length,
      useSchema,
    });
    log.debug("Request payload:", payload);
    log.debug("API key: configured");

    const endTimer = log.time(`${this.providerId}-api-call`);
    const response = await fetchWithRetry(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      endTimer();
      const err = await response.json().catch(() => ({}));
      const customMsg = this._onApiError(response.status, err, response);
      if (customMsg) throw new Error(customMsg);
      log.error(`API error ${response.status}:`, err);
      throw new Error(err.error?.message || `${this.providerName} API error: ${response.status}`);
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
      throw new Error(`Empty response from ${this.providerName}`);
    }

    return { content, usage: data.usage || null };
  }

  async _doCorrectGrammar(text) {
    const log = createLogger(this.providerId);

    const attempt = async (useSchema) => {
      const { content, usage } = await this._callApi(text, SYSTEM_PROMPT, { useSchema });
      log.debug("Raw response content:", content);
      try {
        const parsed = JSON.parse(content);
        log.info(`Parsed result — ${parsed.changes?.length || 0} corrections`);
        return { ...parsed, usage };
      } catch (_e) {
        log.error("JSON parse failed. Raw content:", content);
        throw new Error("Failed to parse grammar correction response");
      }
    };

    if (this._noStructuredOutput) {
      return await attempt(false);
    }

    try {
      return await attempt(true);
    } catch (err) {
      if (err.message && (err.message.includes("response_format") || err.message.includes("json_schema"))) {
        log.warn("response_format rejected, retrying without it");
        try {
          const result = await attempt(false);
          this._noStructuredOutput = true;
          log.info("Fallback succeeded — marked as noStructuredOutput");
          return result;
        } catch (fallbackErr) {
          log.error("Fallback also failed:", fallbackErr.message);
          throw err;
        }
      }
      throw err;
    }
  }

  async _doCorrectGrammarLevel2(text) {
    const log = createLogger(this.providerId);
    const { content, usage } = await this._callApi(text, SYSTEM_PROMPT_L2, { useSchema: false });
    log.debug("Raw L2 response content:", content);
    const extracted = this._extractJsonFromText(content);
    return { ...extracted, usage };
  }

  async _doCorrectGrammarLevel3(text) {
    const log = createLogger(this.providerId);
    const { content } = await this._callApi(text, SYSTEM_PROMPT_L3, { useSchema: false });
    const corrected = content.trim();
    log.info(`L3 corrected text — ${corrected.length} chars`);
    return { corrected, changes: [] };
  }

  _onApiError(_status, _err, _response) {
    return null;
  }
}
