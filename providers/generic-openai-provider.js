import { AbstractOpenAICompatibleProvider, RESPONSE_SCHEMA } from "./abstract-openai-compatible-provider.js";
import { SYSTEM_PROMPT, AI_TEMPERATURE, AI_MAX_TOKENS_MIN } from "../lib/config.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("openai-compatible");

export class GenericOpenAIProvider extends AbstractOpenAICompatibleProvider {
  static get id() {
    return "openai-compatible";
  }

  static get displayName() {
    return "OpenAI Compatible";
  }

  static get keyPlaceholder() {
    return "sk-... or your provider's key";
  }

  static get defaultModel() {
    return "gpt-4o-mini";
  }

  static get models() {
    return [
      { id: "gpt-4o-mini", label: "GPT-4o Mini", hint: "Most services support this" },
    ];
  }

  static get availabilityHint() {
    return "Enter the base URL for any OpenAI-compatible API service";
  }

  constructor(apiKey, model, baseUrl) {
    super(apiKey, model);
    this.baseUrl = baseUrl || "";
    const url = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
    this.endpoint = url ? url + "/chat/completions" : "";
  }

  async _doCorrectGrammar(text) {
    const myLog = createLogger(this.providerId);
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

      myLog.info(`API request → ${this.endpoint}`, { model: this.model, inputLength: text.length, useSchema });
      myLog.debug("Request payload:", payload);
      myLog.debug("API key: configured");

      const endTimer = myLog.time(`${this.providerId}-api-call`);
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
        myLog.error(`API error ${response.status}:`, err);
        throw new Error(err.error?.message || `${this.providerName} API error: ${response.status}`);
      }

      const data = await response.json();
      endTimer();

      myLog.group("API response", () => {
        myLog.info(`Status: ${response.status}`);
        myLog.info(`Model used: ${data.model}`);
        if (data.usage) {
          myLog.info(
            `Tokens — prompt: ${data.usage.prompt_tokens}, completion: ${data.usage.completion_tokens}, total: ${data.usage.total_tokens}`,
          );
        }
      });

      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        myLog.error("Empty content in API response:", data);
        throw new Error(`Empty response from ${this.providerName}`);
      }

      myLog.debug("Raw response content:", content);

      try {
        const parsed = JSON.parse(content);
        myLog.info(`Parsed result — ${parsed.changes?.length || 0} corrections`);
        return { ...parsed, usage: data.usage || null };
      } catch (e) {
        myLog.error("JSON parse failed. Raw content:", content);
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
        myLog.warn("response_format rejected, retrying without it");
        try {
          const result = await callApi(false);
          this._noStructuredOutput = true;
          myLog.info("Fallback succeeded — marked as noStructuredOutput");
          return result;
        } catch (fallbackErr) {
          myLog.error("Fallback also failed:", fallbackErr.message);
          throw err;
        }
      }
      throw err;
    }
  }
}
