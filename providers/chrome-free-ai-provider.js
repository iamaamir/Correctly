import { SYSTEM_PROMPT } from "../lib/config.js";
import { createLogger } from "../lib/logger.js";
import { AbstractProvider } from "./abstract-provider.js";

const log = createLogger("chrome-free-ai");

const GRAMMAR_SCHEMA = {
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
};

export class ChromeFreeAIProvider extends AbstractProvider {
  static STATUS = {
    UNAVAILABLE: "unavailable",
    DOWNLOADABLE: "downloadable",
    DOWNLOADING: "downloading",
    AVAILABLE: "available",
  };

  static get id() {
    return "chrome-free-ai";
  }

  static get displayName() {
    return "Chrome Free AI";
  }

  static get keyPlaceholder() {
    return "No API key needed — uses Chrome's built-in AI";
  }

  static get defaultModel() {
    return "gemini-nano";
  }

  static get requiresApiKey() {
    return false;
  }

  static isAvailable() {
    const found = typeof LanguageModel !== "undefined";
    log.info(`isAvailable: ${found}`);
    return found;
  }

  static async getStatus() {
    if (typeof LanguageModel === "undefined") return ChromeFreeAIProvider.STATUS.UNAVAILABLE;
    const raw = await LanguageModel.availability();
    log.info(`getStatus: raw="${raw}"`);
    const map = {
      no: ChromeFreeAIProvider.STATUS.UNAVAILABLE,
      unavailable: ChromeFreeAIProvider.STATUS.UNAVAILABLE,
      "after-download": ChromeFreeAIProvider.STATUS.DOWNLOADABLE,
      downloadable: ChromeFreeAIProvider.STATUS.DOWNLOADABLE,
      downloading: ChromeFreeAIProvider.STATUS.DOWNLOADING,
      readily: ChromeFreeAIProvider.STATUS.AVAILABLE,
      available: ChromeFreeAIProvider.STATUS.AVAILABLE,
    };
    return map[raw] || ChromeFreeAIProvider.STATUS.UNAVAILABLE;
  }

  static async ensureModel(onProgress) {
    log.info("ensureModel: starting model download");
    const session = await LanguageModel.create({
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          log.debug(`downloadprogress: ${Math.round(e.loaded * 100)}%`);
          onProgress?.(e.loaded);
        });
      },
    });
    log.info("ensureModel: download complete");
    session.destroy();
  }

  static get CHROME_FLAGS_HELP() {
    return "Enable chrome://flags/#optimization-guide-on-device-model and chrome://flags/#prompt-api-for-gemini-nano";
  }

  async _doCorrectGrammar(text) {
    const endTimer = log.time("chrome-free-ai-call");
    log.info(`Starting grammar check`, { inputLength: text.length });

    const status = await ChromeFreeAIProvider.getStatus();
    log.info(`Grammar check status: "${status}"`);
    if (status === ChromeFreeAIProvider.STATUS.UNAVAILABLE) {
      throw new Error(`Chrome Free AI not available. ${ChromeFreeAIProvider.CHROME_FLAGS_HELP}`);
    }
    if (status === ChromeFreeAIProvider.STATUS.DOWNLOADABLE) {
      throw new Error("Chrome Free AI model not downloaded. Open the extension popup to download it.");
    }
    if (status === ChromeFreeAIProvider.STATUS.DOWNLOADING) {
      throw new Error("Chrome Free AI model still downloading. Try again soon.");
    }

    log.debug("Creating LanguageModel session");
    const session = await LanguageModel.create({
      initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
    });
    log.debug(`Session created — context window: ${session.contextWindow}, usage: ${session.contextUsage}`);

    try {
      log.debug("Calling session.prompt with responseConstraint");
      const result = await session.prompt(text, {
        responseConstraint: GRAMMAR_SCHEMA,
      });

      endTimer();

      log.debug("Raw response from Prompt API:", result);

      const parsed = JSON.parse(result);
      log.info(`Parsed result — ${parsed.changes?.length || 0} corrections`);
      if (parsed.changes?.length > 0) {
        log.group("Corrections", () => {
          for (const c of parsed.changes) {
            log.info(`"${c.original}" → "${c.replacement}": ${c.explanation}`);
          }
        });
      }

      return parsed;
    } catch (e) {
      endTimer();
      log.error("Grammar check failed:", e.message);
      if (e instanceof SyntaxError) {
        log.error("JSON parse error — response was not valid JSON despite responseConstraint");
      }
      throw new Error(`Chrome Free AI error: ${e.message}`);
    } finally {
      log.debug("Destroying session");
      session.destroy();
    }
  }
}
