import { AbstractProvider } from "./abstract-provider.js";
import { createLogger } from "../lib/logger.js";
import { SYSTEM_PROMPT, AI_TEMPERATURE, AI_MAX_TOKENS_MIN } from "../lib/config.js";

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
      },
      required: ["corrected", "changes"],
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

  async _doCorrectGrammar(text) {
    const log = createLogger(this.providerId);
    const maxTokens = Math.max(text.length * 3, AI_MAX_TOKENS_MIN);

    const callApi = async (useSchema) => {
      const payload = {
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        temperature: AI_TEMPERATURE,
        max_tokens: maxTokens,
      };
      if (useSchema) payload.response_format = RESPONSE_SCHEMA;

      log.info(`API request → ${this.endpoint}`, { model: this.model, inputLength: text.length, useSchema });
      log.debug("Request payload:", payload);
      log.debug("API key: configured");

      const endTimer = log.time(`${this.providerId}-api-call`);
      const response = await fetch(this.endpoint, {
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

      log.debug("Raw response content:", content);

      try {
        const parsed = JSON.parse(content);
        log.info(`Parsed result — ${parsed.changes?.length || 0} corrections`);
        return { ...parsed, usage: data.usage || null };
      } catch (e) {
        log.error("JSON parse failed. Raw content:", content);
        throw new Error("Failed to parse grammar correction response");
      }
    };

    if (this._noStructuredOutput) {
      return await callApi(false);
    }

    try {
      return await callApi(true);
    } catch (err) {
      if (err.message && (err.message.includes("response_format") || err.message.includes("json_schema"))) {
        log.warn("response_format rejected, retrying without it");
        try {
          const result = await callApi(false);
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

  _onApiError(status, err, response) {
    return null;
  }
}
