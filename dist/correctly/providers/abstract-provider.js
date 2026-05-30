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
import { mergeConfidence, scoreResponse } from "../lib/score.js";

const log = createLogger("provider");

export class AbstractProvider {
  constructor(apiKey, model) {
    if (new.target === AbstractProvider) {
      throw new Error("AbstractProvider is abstract — extend it, do not instantiate directly");
    }

    AbstractProvider.enforceContract(new.target);

    this.apiKey = apiKey;
    this.model = model || new.target.defaultModel;
    log.debug(`Instantiated ${new.target.displayName} with model: ${this.model}`);
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
  async correctGrammar(text, { onProgress } = {}) {
    log.debug(`correctGrammar called — ${text?.length || 0} chars`);
    this.validateApiKey();

    if (!text || text.trim().length === 0) {
      log.debug("Empty text — short-circuiting with no changes");
      return { corrected: text, changes: [] };
    }

    const levels = [
      { fn: () => this._doCorrectGrammar(text), status: "checking" },
      { fn: () => this._doCorrectGrammarLevel2(text), status: "retrying" },
      { fn: () => this._doCorrectGrammarLevel3(text), status: "fallback" },
    ];

    const startLevel = await this._getStartLevel();
    log.debug(`Cascade starting at level ${startLevel}`);

    for (let i = startLevel - 1; i < levels.length; i++) {
      const { fn, status } = levels[i];
      onProgress?.({ status });
      log.debug(`Cascade level ${i + 1} — ${status}`);
      try {
        const t0 = performance.now();
        const result = await fn();
        result.responseTimeMs = Math.round(performance.now() - t0);
        const validated = this._validateResponse(result, text);

        // Score the response with our own checks, then merge with model's self-reported confidence
        const scored = await scoreResponse(validated, text, i + 1);
        const modelConfidence = typeof validated.confidence === "number" ? validated.confidence : 5;
        const merged = await mergeConfidence(modelConfidence, scored.score);
        onProgress?.({ status, confidence: merged });

        if (i < 2 && validated.changes.length === 0 && validated.corrected !== text) {
          log.debug(`Level ${i + 1}: changes empty but corrected differs — cascading`);
          continue;
        }

        if (i >= 2 || merged >= 60) {
          await this._updateCacheOnSuccess(startLevel, i + 1);
          if (scored.suppressed.length > 0) {
            log.debug(
              `Level ${i + 1}: suppressing ${scored.suppressed.length} low-confidence change(s) before display`,
            );
            validated.changes = scored.usable.map(({ _index, _entryScore, _issues, ...change }) => change);
          }
          validated.confidence = i >= 2 ? Math.min(Math.max(merged, 45), 55) : merged;
          validated.cascadeLevel = i + 1;
          onProgress?.({
            status: "done",
            confidence: validated.confidence,
            level: validated.cascadeLevel,
            responseTimeMs: validated.responseTimeMs,
          });
          return validated;
        }

        log.debug(`Level ${i + 1}: merged confidence ${merged} < 60, cascading`);
      } catch (err) {
        if (!this._isCascadeableError(err)) throw err;
        log.debug(`Level ${i + 1} cascadeable error: ${err.message}`);
      }
    }

    throw new Error("Grammar check failed after exhausting all cascade levels");
  }

  /**
   * Provider-specific API call. Subclasses MUST implement this.
   * @param {string} text — non-empty, already validated
   * @returns {Promise<{corrected: string, changes: Array}>}
   */
  async _doCorrectGrammar(_text) {
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
  async _doCorrectGrammarLevel2(_text) {
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
  async _doCorrectGrammarLevel3(_text) {
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
    const msg = err.message || "";
    return (
      msg.includes("Failed to parse") ||
      msg.includes("Provider returned invalid response") ||
      msg.includes("Provider response missing") ||
      msg.includes("Empty response from")
    );
  }

  /**
   * Checks whether the confidence score is high enough to accept this level's
   * result. If confidence is absent (null/undefined), it is treated as
   * acceptable — this allows Level 3 (which has no confidence) to always pass.
   * @param {number|null|undefined} confidence
   * @returns {boolean}
   */
  _isConfidenceAcceptable(confidence) {
    if (confidence === null || confidence === undefined) return true;
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
      const entry = cache[`${this.providerId}:${this.model}`];
      if (!entry) return 1;
      if (entry.level >= 3) {
        log.debug(`Cache pinned at L3 — model does not support structured output`);
        return 3;
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
  async _updateCacheOnSuccess(prevStart, succeededLevel) {
    try {
      const data = await chrome.storage.local.get("modelLevelCache");
      const cache = data.modelLevelCache || {};
      const key = `${this.providerId}:${this.model}`;
      const existing = cache[key];

      if (succeededLevel < prevStart) {
        cache[key] = { level: succeededLevel, checksAtLevel: 0 };
        log.debug(`Cache upgraded to level ${succeededLevel}`);
      } else if (succeededLevel > prevStart) {
        cache[key] = { level: succeededLevel, checksAtLevel: 0 };
        log.debug(`Cache downgraded to level ${succeededLevel}`);
      } else {
        cache[key] = {
          level: succeededLevel,
          checksAtLevel: (existing?.checksAtLevel || 0) + 1,
        };
        log.debug(`Cache checksAtLevel incremented to ${cache[key].checksAtLevel} at level ${succeededLevel}`);
      }

      await chrome.storage.local.set({ modelLevelCache: cache });
    } catch (err) {
      log.warn("Failed to update model level cache:", err.message);
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

  _validateResponse(result, _originalText) {
    if (!result || typeof result !== "object") {
      log.error("Response validation failed — not an object", result);
      throw new Error("Provider returned invalid response — expected an object");
    }

    if (typeof result.corrected !== "string") {
      log.error('Response validation failed — missing "corrected" string', result);
      throw new Error('Provider response missing "corrected" string');
    }

    if (!Array.isArray(result.changes)) {
      log.error('Response validation failed — missing "changes" array', result);
      throw new Error('Provider response missing "changes" array');
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
