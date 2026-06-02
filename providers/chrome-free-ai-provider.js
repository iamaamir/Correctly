import { SYSTEM_PROMPT, SYSTEM_PROMPT_L2, SYSTEM_PROMPT_L3 } from "../lib/config.js";
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
    confidence: { type: "number" },
  },
  required: ["corrected", "changes", "confidence"],
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

  static get models() {
    return [
      {
        id: "gemini-nano",
        label: "Gemini Nano",
        hint: "Built-in, private, offline",
      },
    ];
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

  // ──────────────────────────────────────────────
  //  SESSION METRICS (instrumentation / benchmark)
  // ──────────────────────────────────────────────

  _getSessionMetrics() {
    if (!this._sessionMetrics) {
      this._sessionMetrics = {
        createCount: 0,
        cloneCount: 0,
        destroyCount: 0,
        promptCount: 0,
        abortCount: 0,
        reuseCount: 0,
      };
    }
    return this._sessionMetrics;
  }

  getSessionMetrics() {
    return { ...(this._sessionMetrics ?? this._getSessionMetrics()) };
  }

  resetSessionMetrics() {
    this._sessionMetrics = null;
  }

  // ──────────────────────────────────────────────
  //  BASE SESSION CACHE (clone-per-check)
  // ──────────────────────────────────────────────

  static get baseSessionTTL() {
    return 300000; // 5 minutes
  }

  constructor(...args) {
    super(...args);
    this.baseSessionsByLevel = new Map();
    this.baseSessionPromisesByLevel = new Map();
    this.baseSessionGenerationByLevel = new Map();
    this._baseSessionCreatedAt = new Map();
    this._baseSessionGeneration = 0;
  }

  _getSystemPrompt(level) {
    if (level === 1) return SYSTEM_PROMPT;
    if (level === 2) return SYSTEM_PROMPT_L2;
    return SYSTEM_PROMPT_L3;
  }

  async _getBaseSession(level, { signal }) {
    const generation = this._baseSessionGeneration;
    const levelGen = this.baseSessionGenerationByLevel.get(level);

    if (levelGen !== generation) {
      const stale = this.baseSessionsByLevel.get(level);
      if (stale) {
        try {
          stale.destroy();
        } catch {}
        this.baseSessionsByLevel.delete(level);
      }
      this.baseSessionGenerationByLevel.set(level, generation);
    }

    const existing = this.baseSessionsByLevel.get(level);
    if (existing) {
      const createdAt = this._baseSessionCreatedAt.get(level);
      const ttl = this.constructor.baseSessionTTL;
      if (createdAt && Date.now() - createdAt > ttl) {
        log.debug(`Base session level ${level} expired after TTL — recreating`);
        try {
          existing.destroy();
        } catch {}
        this.baseSessionsByLevel.delete(level);
        this._baseSessionCreatedAt.delete(level);
      } else {
        this._getSessionMetrics().reuseCount++;
        return existing;
      }
    }

    const pending = this.baseSessionPromisesByLevel.get(level);
    if (pending) {
      try {
        const session = await pending;
        signal?.throwIfAborted?.();
        if (this.baseSessionGenerationByLevel.get(level) !== generation) {
          try {
            session.destroy();
          } catch {}
          this.baseSessionPromisesByLevel.delete(level);
        } else {
          this.baseSessionsByLevel.set(level, session);
          this.baseSessionPromisesByLevel.delete(level);
          this._baseSessionCreatedAt.set(level, Date.now());
          this._getSessionMetrics().reuseCount++;
          return session;
        }
      } catch {
        this.baseSessionPromisesByLevel.delete(level);
      }
    }

    const systemPrompt = this._getSystemPrompt(level);
    this._getSessionMetrics().createCount++;
    const createT0 = performance.now();
    log.debug(`Creating base session level ${level}`);

    const promise = LanguageModel.create({
      initialPrompts: [{ role: "system", content: systemPrompt }],
      signal,
    });
    this.baseSessionPromisesByLevel.set(level, promise);

    try {
      const session = await promise;
      performance.measure("correctly:session:create", { start: createT0, end: performance.now() });
      if (this.baseSessionGenerationByLevel.get(level) !== generation) {
        try {
          session.destroy();
        } catch {}
        this.baseSessionGenerationByLevel.set(level, generation);
        this.baseSessionPromisesByLevel.delete(level);
        return this._getBaseSession(level, { signal });
      }
      this.baseSessionsByLevel.set(level, session);
      this.baseSessionPromisesByLevel.delete(level);
      this._baseSessionCreatedAt.set(level, Date.now());
      return session;
    } catch (e) {
      this.baseSessionPromisesByLevel.delete(level);
      this.baseSessionGenerationByLevel.delete(level);
      throw e;
    }
  }

  async destroySessions() {
    log.debug("Destroying all base sessions");
    this._baseSessionGeneration++;
    for (const session of this.baseSessionsByLevel.values()) {
      try {
        session.destroy();
      } catch (err) {
        log.warn("Base session destroy error:", err?.message);
      }
    }
    this.baseSessionsByLevel.clear();
    this.baseSessionPromisesByLevel.clear();
    this.baseSessionGenerationByLevel.clear();
    this._baseSessionCreatedAt.clear();
  }

  async _runWithSession(text, level, { signal, skipSessionCache = false }) {
    const endTimer = log.time("chrome-free-ai-call");
    const systemPrompt = this._getSystemPrompt(level);

    let session;

    if (!skipSessionCache) {
      const base = await this._getBaseSession(level, { signal });
      session = await base.clone();
      this._getSessionMetrics().cloneCount++;
      log.debug(`Cloned base session level ${level}`);
    } else {
      this._getSessionMetrics().createCount++;
      const createT0 = performance.now();
      log.debug(`Creating one-shot session level ${level}`);
      session = await LanguageModel.create({
        initialPrompts: [{ role: "system", content: systemPrompt }],
        signal,
      });
      performance.measure("correctly:session:create", { start: createT0, end: performance.now() });
    }

    try {
      this._getSessionMetrics().promptCount++;
      const promptT0 = performance.now();
      log.debug("Calling session.prompt");

      const isLevel1 = level === 1;
      const result = await session.prompt(text, isLevel1 ? { responseConstraint: GRAMMAR_SCHEMA, signal } : { signal });

      performance.measure("correctly:session:prompt", { start: promptT0, end: performance.now() });
      endTimer();

      return result;
    } finally {
      this._getSessionMetrics().destroyCount++;
      try {
        session.destroy();
      } catch {}
    }
  }

  static get CHROME_FLAGS_HELP() {
    return "Enable chrome://flags/#optimization-guide-on-device-model and chrome://flags/#prompt-api-for-gemini-nano";
  }

  async _doCorrectGrammar(text, { signal, skipSessionCache = false } = {}) {
    log.info(`Starting grammar check`, { inputLength: text.length });

    signal?.throwIfAborted?.();
    const status = await ChromeFreeAIProvider.getStatus();
    signal?.throwIfAborted?.();
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

    try {
      const result = await this._runWithSession(text, 1, { signal, skipSessionCache });

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
      if (e.name === "AbortError" || signal?.aborted) {
        this._getSessionMetrics().abortCount++;
        throw e;
      }
      log.error("Grammar check failed:", e.message);
      if (e instanceof SyntaxError) {
        log.error("JSON parse error — response was not valid JSON despite responseConstraint");
      }
      throw new Error(`Chrome Free AI error: ${e.message}`);
    }
  }

  async _doCorrectGrammarLevel2(text, { signal, skipSessionCache = false } = {}) {
    const log = createLogger(this.providerId);
    log.info(`L2 grammar check start`, { inputLength: text.length });

    signal?.throwIfAborted?.();
    const status = await ChromeFreeAIProvider.getStatus();
    signal?.throwIfAborted?.();
    if (status !== ChromeFreeAIProvider.STATUS.AVAILABLE) {
      throw new Error(`Chrome Free AI not available`);
    }

    try {
      const result = await this._runWithSession(text, 2, { signal, skipSessionCache });
      log.debug("Raw L2 response:", result);
      const parsed = this._extractJsonFromText(result);
      log.info(`L2 parsed — ${parsed.changes?.length || 0} corrections`);
      return parsed;
    } catch (e) {
      if (e.name === "AbortError" || signal?.aborted) {
        this._getSessionMetrics().abortCount++;
        throw e;
      }
      log.error("L2 grammar check failed:", e.message);
      if (e instanceof SyntaxError || e.message.includes("Failed to parse")) {
        throw new Error("Failed to parse grammar correction response");
      }
      throw new Error(`Chrome Free AI error: ${e.message}`);
    }
  }

  async _doCorrectGrammarLevel3(text, { signal, skipSessionCache = false } = {}) {
    const log = createLogger(this.providerId);
    log.info(`L3 grammar check start`, { inputLength: text.length });

    signal?.throwIfAborted?.();
    const status = await ChromeFreeAIProvider.getStatus();
    signal?.throwIfAborted?.();
    if (status !== ChromeFreeAIProvider.STATUS.AVAILABLE) {
      throw new Error(`Chrome Free AI not available`);
    }

    try {
      const result = await this._runWithSession(text, 3, { signal, skipSessionCache });
      log.debug("Raw L3 response:", result);
      return { corrected: result.trim(), changes: [], confidence: 5 };
    } catch (e) {
      if (e.name === "AbortError" || signal?.aborted) {
        this._getSessionMetrics().abortCount++;
        throw e;
      }
      log.error("L3 grammar check failed:", e.message);
      throw new Error(`Chrome Free AI error: ${e.message}`);
    }
  }
}
