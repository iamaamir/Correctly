/**
 * Abstract base class for all AI grammar correction providers.
 *
 * EVERY provider must:
 *   1. Extend this class
 *   2. Implement all static metadata (id, name, defaultModel, keyPlaceholder)
 *   3. Implement _doCorrectGrammar(text) — the actual API call
 *   4. Implement static get models() — synchronous cache/fallback accessor
 *   5. Optionally override getModels() for dynamic fetching (defaults to models)
 *   6. Optionally override validateApiKey() for provider-specific key validation
 *   7. Optionally override isAvailable() to check if provider is reachable
 *
 * The base class handles:
 *   - Constructor contract (apiKey + model)
 *   - Response shape validation
 *   - Empty text short-circuit
 *   - Enforcing the abstract contract (constructor + static enforceContract)
 *
 * RESPONSE CONTRACT:
 *   correctGrammar() must return:
 *   {
 *     corrected: string,          // the full corrected text
 *     changes: [                  // array, can be empty
 *       {
 *         original: string,       // the incorrect fragment
 *         replacement: string,    // the corrected fragment
 *         explanation: string     // why it was changed
 *       }
 *     ]
 *   }
 *
 * MODEL DEFINITION:
 *   static async getModels() — canonical API. Returns Promise<Array<{id, label, hint}>>.
 *     Cache internally. Handle errors gracefully. Return fallbacks on failure.
 *
 *   static get models() — synchronous accessor for contract validation & sync reads.
 *     Must return same structure as getModels().
 */
import { createLogger } from "../lib/logger.js";
import { classifyProviderFailure, mergeConfidence, scoreResponse, validateGrammarResponse } from "../lib/score.js";

const L2_FAILURE_THRESHOLD = 3;
const log = createLogger("provider");

export class AbstractProvider {
  constructor(apiKey, model) {
    if (new.target === AbstractProvider) {
      throw new Error("AbstractProvider is abstract — extend it, do not instantiate directly");
    }

    AbstractProvider.enforceContract(new.target);

    this.apiKey = apiKey;
    this.model = model || new.target.defaultModel;
    this._cascadeMetrics = this._createCascadeMetrics();
    log.debug(`Instantiated ${new.target.displayName} with model: ${this.model}`);
  }

  // ──────────────────────────────────────────────
  //  CASCADE METRICS (instrumentation / benchmark)
  // ──────────────────────────────────────────────

  _createCascadeMetrics() {
    return { calls: 0, levelAttempts: [0, 0, 0], levelSuccesses: [0, 0, 0], aborted: 0 };
  }

  getCascadeMetrics() {
    return { ...(this._cascadeMetrics ?? this._createCascadeMetrics()) };
  }

  resetCascadeMetrics() {
    this._cascadeMetrics = this._createCascadeMetrics();
  }

  // ──────────────────────────────────────────────
  //  STATIC METADATA — every provider must define
  // ──────────────────────────────────────────────

  /** Unique identifier used in storage and registry (e.g. 'openai') */
  static get id() {
    throw new Error(`${AbstractProvider.name} must implement static get id()`);
  }

  /** Display name shown in the UI (e.g. 'OpenAI') */
  static get displayName() {
    throw new Error(`${AbstractProvider.name} must implement static get displayName()`);
  }

  /**
   * Async model list — the canonical API for fetching models.
   * Default implementation delegates to the static `models` getter.
   * Override for dynamic fetching (e.g. Ollama queries its API).
   * - Cache internally to avoid repeated fetches.
   * - Handle errors gracefully, return fallbacks on failure.
   * @returns {Promise<Array<{id: string, label: string, hint: string}>>}
   */
  static async getModels() {
    // biome-ignore lint/complexity/noThisInStatic: needed for polymorphic dispatch to subclass models
    return this.models;
  }

  /*
   * Why both getModels() (async) AND models (sync getter)?
   *
   * getModels() is the canonical async API. Registry calls it to fetch model lists
   * before populating the UI. Providers that talk to remote APIs (like Ollama) fetch
   * dynamically and cache the result.
   *
   * models (sync) exists because the constructor is synchronous and must validate
   * defaultModel against the model list at construction time. It cannot await
   * getModels(). The sync getter gives providers a trivial way to return cached
   * data or a static fallback for this validation.
   *
   * Contract: both must return the same structure [{ id, label, hint }].
   *   getModels() is the source of truth for UI.
   *   models is the synchronous snapshot for contract enforcement.
   */

  /**
   * Synchronous model accessor (cache/fallback).
   * Subclasses MUST implement.
   * Used for contract enforcement (defaultModel validation) and sync reads.
   * Must return same structure as getModels().
   * @returns {Array<{id: string, label: string, hint: string}>}
   */
  static get models() {
    throw new Error(`${AbstractProvider.name} must implement static get models()`);
  }

  /** Default model id — must match one of the models[].id values */
  static get defaultModel() {
    throw new Error(`${AbstractProvider.name} must implement static get defaultModel()`);
  }

  /** Placeholder text for the API key input (e.g. 'sk-...') */
  static get keyPlaceholder() {
    throw new Error(`${AbstractProvider.name} must implement static get keyPlaceholder()`);
  }

  /**
   * Check if the provider is available/reachable.
   * Override in subclasses to perform health checks (e.g. check if Ollama daemon is running).
   * @returns {Promise<boolean>} - true if provider is available
   */
  static async isAvailable() {
    // assuming all are avilable
    return true;
  }

  /**
   * Optional hook: called when this provider's model is being unloaded (e.g., user
   * switches to a different model or provider). Providers can override to clean up
   * resources (e.g., unload a local model from memory).
   *
   * This is fire-and-forget — errors are logged but never propagated.
   * @param {string} _oldModelId — the model ID that was previously active
   * @returns {Promise<void>}
   */
  static async onModelUnloaded(_oldModelId) {
    // no-op by default
  }

  /**
   * Hint shown when provider is unavailable.
   * Override to provide specific setup instructions.
   * @returns {string|null}
   */
  static get availabilityHint() {
    return null;
  }

  /** Whether this provider requires an API key to function */
  static get requiresApiKey() {
    return true;
  }

  // ──────────────────────────────────────────────
  //  INSTANCE METHODS
  // ──────────────────────────────────────────────

  /** Convenience accessors — read-through to static metadata */
  get providerName() {
    return this.constructor.displayName;
  }
  get providerId() {
    return this.constructor.id;
  }

  /**
   * Public entry point. Validates input, delegates to _doCorrectGrammar,
   * then validates the response shape.
   *
   * Cascades through three levels on failure:
   *   Level 1 — structured JSON via RESPONSE_SCHEMA
   *   Level 2 — CoT prompt + JSON extraction from unstructured text
   *   Level 3 — plain text, no changes
   *
   * @param {string} text — text to check
   * @param {{ onProgress?: (status: string) => void }} [options]
   * @returns {Promise<{corrected: string, changes: Array}>}
   */
  async correctGrammar(text, { onProgress, ...providerOptions } = {}) {
    const { signal } = providerOptions;
    log.debug(`correctGrammar called — ${text?.length || 0} chars`);
    this.validateApiKey();

    if (!text || text.trim().length === 0) {
      log.debug("Empty text — short-circuiting with no changes");
      return { corrected: text, changes: [], confidence: 10 };
    }

    const levels = [
      { fn: () => this._doCorrectGrammar(text, providerOptions), status: "checking" },
      { fn: () => this._doCorrectGrammarLevel2(text, providerOptions), status: "retrying" },
      { fn: () => this._doCorrectGrammarLevel3(text, providerOptions), status: "fallback" },
    ];

    const startLevel = await this._getStartLevel();
    log.debug(`Cascade starting at level ${startLevel}`);
    let cacheLevelHint = null;
    let cacheReason = null;
    let level2CascadeFailed = false;
    this._cascadeMetrics.calls++;

    for (let i = startLevel - 1; i < levels.length; i++) {
      const { fn, status } = levels[i];
      signal?.throwIfAborted?.();
      onProgress?.({ status });
      this._cascadeMetrics.levelAttempts[i]++;
      const levelLabel = `correctly:cascade:L${i + 1}`;
      performance.mark(`${levelLabel}:start`);
      log.debug(`Cascade level ${i + 1} — ${status}`);
      try {
        if (this._cascadeMetrics.aborted > 0) {
          status; // reference to keep lint happy
        }
        const t0 = performance.now();
        const result = await fn();
        signal?.throwIfAborted?.();
        result.responseTimeMs = Math.round(performance.now() - t0);
        performance.mark(`${levelLabel}:end`);
        performance.measure(levelLabel, `${levelLabel}:start`, `${levelLabel}:end`);
        this._cascadeMetrics.levelSuccesses[i]++;
        const validated = this._validateResponse(result, text, i + 1);

        // Stage 3 & 4: Score response + extract display-safe changes
        const scored = await scoreResponse(validated, text, i + 1);
        signal?.throwIfAborted?.();
        if (scored.score < 60 && i < 2) {
          log.debug(`Level ${i + 1}: score ${scored.score} < 60, cascading`);
          continue;
        }
        if (i >= 2 && scored.score < 60) {
          log.debug(`Level 3: accepting plain-text fallback despite score ${scored.score}`);
        }

        if (scored.suppressed.length > 0) {
          log.debug(`Level ${i + 1}: hiding ${scored.suppressed.length} change(s) from display`);
          validated.changes = scored.usable.map(({ _index, _entryScore, _issues, ...rest }) => rest);
        }

        // Stage 5: Merge confidence for the user-facing score
        const displayConfidence = await mergeConfidence(validated.confidence, scored.score);
        signal?.throwIfAborted?.();
        onProgress?.({ status, confidence: displayConfidence });

        // Update cache on success
        // - Level 1 with schema: structured_output_supported
        // - Level 1 without schema: level_1_no_schema_supported
        // - Level via capability cascade (e.g. structured_output_unsupported): use cacheReason
        // - Level 3 plain-text fallback: plain_text_only
        // - Score-based cascade: do NOT downgrade cache
        if (i >= 2 && cacheLevelHint !== null) {
          signal?.throwIfAborted?.();
          await this._updateCacheOnSuccess(startLevel, 3, "plain_text_only");
        } else if (i + 1 <= startLevel) {
          signal?.throwIfAborted?.();
          const reason = i + 1 === 1 && this._noStructuredOutput ? "level_1_no_schema_supported" : undefined;
          await this._updateCacheOnSuccess(startLevel, i + 1, reason);
        } else if (cacheLevelHint !== null) {
          signal?.throwIfAborted?.();
          await this._updateCacheOnSuccess(startLevel, i + 1, cacheReason);
        } else {
          log.debug(`Level ${i + 1}: not downgrading cache without capability signal`);
        }

        // Record Level 2 JSON failure before returning L3 success
        // (persisted on top of cache entry, preserving existing reason/level)
        if (i >= 2 && level2CascadeFailed) {
          signal?.throwIfAborted?.();
          await this._recordLevel2Failure();
          level2CascadeFailed = false;
        }

        validated.confidence = i >= 2 ? Math.min(Math.max(displayConfidence, 45), 55) : displayConfidence;
        validated.cascadeLevel = i + 1;
        signal?.throwIfAborted?.();
        onProgress?.({
          status: "done",
          confidence: validated.confidence,
          level: validated.cascadeLevel,
          responseTimeMs: validated.responseTimeMs,
        });
        return validated;
      } catch (err) {
        if (err.name === "AbortError" || signal?.aborted) {
          this._cascadeMetrics.aborted++;
          throw err;
        }
        if (!this._isCascadeableError(err)) throw err;
        const classification = classifyProviderFailure(err);
        log.debug(`Level ${i + 1} cascadeable error: ${err.message} (kind: ${classification.kind})`);
        // Track capability failures for cache downgrade
        if (classification.cacheLevelHint !== null) {
          cacheLevelHint = classification.cacheLevelHint;
          cacheReason = classification.cacheReason || classification.kind;
        }
        // Track repeated Level 2 JSON failures — may mark prompt as unreliable
        if (i === 1 && classification.kind === "json_not_followed") {
          level2CascadeFailed = true;
        }
      } finally {
        performance.clearMarks(`${levelLabel}:start`);
        performance.clearMarks(`${levelLabel}:end`);
      }
    }

    // After exhausting all levels: record Level 2 failures if they occurred
    if (level2CascadeFailed) {
      await this._recordLevel2Failure();
    }
    throw new Error("Grammar check failed after exhausting all cascade levels");
  }

  /**
   * Provider-specific API call. Subclasses MUST implement this.
   * @param {string} text — non-empty, already validated
   * @returns {Promise<{corrected: string, changes: Array}>}
   */
  async _doCorrectGrammar(_text, _options = {}) {
    throw new Error(`${this.constructor.name} must implement _doCorrectGrammar(text)`);
  }

  /**
   * Level 2 cascade fallback — CoT prompt with JSON extraction.
   * Subclasses should override to send a simpler prompt without
   * structured output enforcement, then extract JSON from the text response.
   * Default implementation throws to skip this level.
   * @param {string} _text — non-empty, already validated
   * @returns {Promise<{corrected: string, changes: Array}>}
   */
  async _doCorrectGrammarLevel2(_text, _options = {}) {
    throw new Error(`${this.constructor.name} does not support cascade level 2 — override _doCorrectGrammarLevel2`);
  }

  /**
   * Level 3 cascade fallback — plain text, no changes array.
   * Subclasses should override to send a minimal prompt and return
   * { corrected: text.trim(), changes: [] }.
   * Default implementation throws to skip this level.
   * @param {string} _text — non-empty, already validated
   * @returns {Promise<{corrected: string, changes: Array}>}
   */
  async _doCorrectGrammarLevel3(_text, _options = {}) {
    throw new Error(`${this.constructor.name} does not support cascade level 3 — override _doCorrectGrammarLevel3`);
  }

  /**
   * Validates that the API key is set and non-empty.
   * Skips validation if requiresApiKey is false.
   * Subclasses can override for provider-specific format validation.
   */
  validateApiKey() {
    if (!this.constructor.requiresApiKey) return true;
    if (!this.apiKey || typeof this.apiKey !== "string" || this.apiKey.trim() === "") {
      log.error("API key validation failed — key is missing or empty");
      throw new Error("API key is required");
    }
    log.debug("API key validated");
    return true;
  }

  // ──────────────────────────────────────────────
  //  CASCADE HELPERS
  // ──────────────────────────────────────────────

  /**
   * Determines whether an error should trigger a cascade to the next level.
   * Network errors, timeouts, and API auth/rate-limit errors are NOT
   * cascadeable — they should propagate immediately.
   * @param {Error} err
   * @returns {boolean}
   */
  _isCascadeableError(err) {
    const classification = classifyProviderFailure(err);
    if (classification.kind === "network_or_auth_failure" || classification.kind === "rate_limit") {
      return false;
    }
    return classification.cascadeable;
  }

  /**
   * Checks whether the confidence score is high enough to accept this level's
   * result.
   * @param {number|null|undefined} confidence
   * @returns {boolean}
   */
  _isConfidenceAcceptable(confidence) {
    return confidence >= 6;
  }

  /**
   * Reads the model level cache from chrome.storage.local to determine which
   * cascade level to start at. Returns 1 if no cache entry exists.
   * If a cached level > 1 has had 10+ successful checks, tries level 1
   * (auto-upgrade attempt).
   * @returns {Promise<number>} — start level (1, 2, or 3)
   */
  async _getStartLevel() {
    try {
      const data = await chrome.storage.local.get("modelLevelCache");
      const cache = data.modelLevelCache || {};
      const entry = cache[this._getModelLevelCacheKey()];
      if (!entry) return 1;
      if (entry.level >= 3 || entry.reason === "json_prompt_unreliable" || entry.reason === "plain_text_only") {
        log.debug(`Cache pinned at L3 — ${entry.reason || "level >= 3"}`);
        return 3;
      }
      if (entry.reason === "structured_output_unsupported") {
        log.debug("Cache reason structured_output_unsupported — starting at L2 (no-schema)");
        return 2;
      }
      if (entry.level > 1 && entry.checksAtLevel >= 10) {
        log.debug(`Cache auto-upgrade — L${entry.level} has ${entry.checksAtLevel} checks, trying L1`);
        return 1;
      }
      return entry.level;
    } catch {
      return 1;
    }
  }

  /**
   * Updates the model level cache after a successful check.
   * - If we tried a lower level than cached (auto-upgrade succeeded): upgrade cache
   * - If we fell back to a higher level: downgrade cache
   * - If same level: increment checksAtLevel
   * @param {number} prevStart — the level we started at
   * @param {number} succeededLevel — the level that succeeded (1-indexed)
   */
  async _updateCacheOnSuccess(prevStart, succeededLevel, reason) {
    try {
      const data = await chrome.storage.local.get("modelLevelCache");
      const cache = data.modelLevelCache || {};
      const key = this._getModelLevelCacheKey();
      const existing = cache[key];
      const nextReason = reason || existing?.reason || "structured_output_supported";
      const level2Failures = existing?.level2Failures || 0;

      if (succeededLevel < prevStart) {
        cache[key] = { level: succeededLevel, checksAtLevel: 0, reason: nextReason, level2Failures };
        log.debug(`Cache upgraded to level ${succeededLevel}`);
      } else if (succeededLevel > prevStart) {
        cache[key] = { level: succeededLevel, checksAtLevel: 0, reason: nextReason, level2Failures };
        log.debug(`Cache downgraded to level ${succeededLevel}`);
      } else {
        cache[key] = {
          level: succeededLevel,
          checksAtLevel: (existing?.checksAtLevel || 0) + 1,
          reason: nextReason,
          level2Failures,
        };
        log.debug(`Cache checksAtLevel incremented to ${cache[key].checksAtLevel} at level ${succeededLevel}`);
      }

      await chrome.storage.local.set({ modelLevelCache: cache });
    } catch (err) {
      log.warn("Failed to update model level cache:", err.message);
    }
  }

  /**
   * Records a Level 2 JSON parse failure. After a threshold of repeated
   * failures, marks the cache as json_prompt_unreliable to skip Level 2
   * in future cascade attempts.
   */
  async _recordLevel2Failure() {
    try {
      const data = await chrome.storage.local.get("modelLevelCache");
      const cache = data.modelLevelCache || {};
      const key = this._getModelLevelCacheKey();
      const existing = cache[key] || { level: 1, checksAtLevel: 0, reason: undefined };
      const failures = (existing.level2Failures || 0) + 1;
      log.debug(`Level 2 JSON failure #${failures} for ${key}`);
      if (failures >= L2_FAILURE_THRESHOLD) {
        cache[key] = { level: 3, checksAtLevel: 0, reason: "json_prompt_unreliable", level2Failures: failures };
        log.debug("Level 2 repeated failures — cache set to json_prompt_unreliable");
      } else {
        cache[key] = { ...existing, level2Failures: failures };
      }
      await chrome.storage.local.set({ modelLevelCache: cache });
    } catch (err) {
      log.warn("Failed to record Level 2 failure:", err.message);
    }
  }

  /**
   * Attempts to extract a JSON object from free-form text.
   * Tries JSON code fences first, then falls back to finding the first
   * { ... } block. Throws if neither approach yields valid JSON.
   * @param {string} text — raw response text potentially containing JSON
   * @returns {object}
   */
  _extractJsonFromText(text) {
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // fall through to brace matching
      }
    }
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch {
        throw new Error("Failed to parse grammar correction response");
      }
    }
    throw new Error("Failed to parse grammar correction response");
  }

  _getModelLevelCacheKey() {
    return `${this.providerId}:${this.model}`;
  }

  // ──────────────────────────────────────────────
  //  CONTRACT ENFORCEMENT
  // ──────────────────────────────────────────────

  static enforceContract(ProviderClass) {
    const required = ["id", "displayName", "models", "defaultModel", "keyPlaceholder", "getModels"];
    for (const prop of required) {
      try {
        const val = ProviderClass[prop];
        if (val === undefined || val === null) {
          throw new Error(`static ${prop} returned ${val}`);
        }
      } catch (e) {
        if (e.message.includes("must implement")) throw e;
        throw new Error(`${ProviderClass.name}: static ${prop} is invalid — ${e.message}`);
      }
    }

    if (typeof ProviderClass.getModels !== "function") {
      throw new Error(`${ProviderClass.name}: static getModels must be a function`);
    }

    if (typeof ProviderClass.isAvailable !== "function" && ProviderClass.isAvailable !== undefined) {
      throw new Error(`${ProviderClass.name}: static isAvailable must be a function or undefined`);
    }

    const models = ProviderClass.models;
    if (!Array.isArray(models) || models.length === 0) {
      throw new Error(`${ProviderClass.name}: static models must be a non-empty array`);
    }
    for (const m of models) {
      if (!m.id || !m.label || !m.hint) {
        throw new Error(`${ProviderClass.name}: every model must have { id, label, hint } — got ${JSON.stringify(m)}`);
      }
    }

    const defaultModel = ProviderClass.defaultModel;
    if (!models.some((m) => m.id === defaultModel)) {
      throw new Error(`${ProviderClass.name}: defaultModel "${defaultModel}" is not in the models list`);
    }
  }

  _validateResponse(result, _originalText, _level) {
    const level = _level || 1;
    if (!result || typeof result !== "object") {
      log.error("Response validation failed — not an object", result);
      throw new Error("Provider returned invalid response — expected an object");
    }

    const contract = validateGrammarResponse(result, { level });
    if (!contract.ok) {
      log.error(`Response validation failed — ${contract.reason}`, result);
      throw new Error(`Provider response invalid: ${contract.reason}`);
    }

    for (let i = 0; i < result.changes.length; i++) {
      const c = result.changes[i];
      if (
        !c ||
        typeof c.original !== "string" ||
        typeof c.replacement !== "string" ||
        typeof c.explanation !== "string"
      ) {
        log.error(`Response validation failed — changes[${i}] malformed`, c);
        throw new Error(`Provider response changes[${i}] must have { original, replacement, explanation } strings`);
      }
    }

    log.debug(
      `Response validated — ${result.changes.length} change(s), corrected text: ${result.corrected.length} chars`,
    );
    return result;
  }
}
