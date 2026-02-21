/**
 * Abstract base class for all AI grammar correction providers.
 *
 * EVERY provider must:
 *   1. Extend this class
 *   2. Implement all static metadata (id, name, models, defaultModel, keyPlaceholder)
 *   3. Implement _doCorrectGrammar(text) — the actual API call
 *   4. Optionally override validateApiKey() for provider-specific key validation
 *
 * The base class handles:
 *   - Constructor contract (apiKey + model)
 *   - Response shape validation
 *   - Empty text short-circuit
 *   - Enforcing the abstract contract at instantiation time
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
 *   static get models() must return an array of:
 *   {
 *     id: string,    // value sent to the API (e.g. 'gpt-4o-mini')
 *     label: string, // human-readable name shown in the UI (e.g. 'GPT-4o Mini')
 *     hint: string   // short description of cost/quality tradeoff (e.g. 'Fast & cheap')
 *   }
 */
import { createLogger } from '../lib/logger.js';

const log = createLogger('provider');

export class BaseProvider {
  constructor(apiKey, model) {
    if (new.target === BaseProvider) {
      throw new Error('BaseProvider is abstract — extend it, do not instantiate directly');
    }

    this._enforceStaticContract(new.target);

    this.apiKey = apiKey;
    this.model = model || new.target.defaultModel;
    log.debug(`Instantiated ${new.target.displayName} with model: ${this.model}`);
  }

  // ──────────────────────────────────────────────
  //  STATIC METADATA — every provider must define
  // ──────────────────────────────────────────────

  /** Unique identifier used in storage and registry (e.g. 'openai') */
  static get id() {
    throw new Error(`${this.name} must implement static get id()`);
  }

  /** Display name shown in the UI (e.g. 'OpenAI') */
  static get displayName() {
    throw new Error(`${this.name} must implement static get displayName()`);
  }

  /** Array of available models: [{ id, label, hint }] */
  static get models() {
    throw new Error(`${this.name} must implement static get models()`);
  }

  /** Default model id — must match one of the models[].id values */
  static get defaultModel() {
    throw new Error(`${this.name} must implement static get defaultModel()`);
  }

  /** Placeholder text for the API key input (e.g. 'sk-...') */
  static get keyPlaceholder() {
    throw new Error(`${this.name} must implement static get keyPlaceholder()`);
  }

  // ──────────────────────────────────────────────
  //  INSTANCE METHODS
  // ──────────────────────────────────────────────

  /** Convenience accessors — read-through to static metadata */
  get providerName() { return this.constructor.displayName; }
  get providerId() { return this.constructor.id; }

  /**
   * Public entry point. Validates input, delegates to _doCorrectGrammar,
   * then validates the response shape.
   */
  async correctGrammar(text) {
    log.debug(`correctGrammar called — ${text?.length || 0} chars`);
    this.validateApiKey();

    if (!text || text.trim().length === 0) {
      log.debug('Empty text — short-circuiting with no changes');
      return { corrected: text, changes: [] };
    }

    log.debug(`Delegating to ${this.constructor.name}._doCorrectGrammar`);
    const result = await this._doCorrectGrammar(text);
    return this._validateResponse(result, text);
  }

  /**
   * Provider-specific API call. Subclasses MUST implement this.
   * @param {string} text — non-empty, already validated
   * @returns {Promise<{corrected: string, changes: Array}>}
   */
  async _doCorrectGrammar(text) {
    throw new Error(`${this.constructor.name} must implement _doCorrectGrammar(text)`);
  }

  /**
   * Validates that the API key is set and non-empty.
   * Subclasses can override for provider-specific format validation.
   */
  validateApiKey() {
    if (!this.apiKey || typeof this.apiKey !== 'string' || this.apiKey.trim() === '') {
      log.error('API key validation failed — key is missing or empty');
      throw new Error('API key is required');
    }
    log.debug('API key validated');
    return true;
  }

  // ──────────────────────────────────────────────
  //  PRIVATE
  // ──────────────────────────────────────────────

  _enforceStaticContract(ProviderClass) {
    const required = ['id', 'displayName', 'models', 'defaultModel', 'keyPlaceholder'];
    for (const prop of required) {
      try {
        const val = ProviderClass[prop];
        if (val === undefined || val === null) {
          throw new Error(`static ${prop} returned ${val}`);
        }
      } catch (e) {
        if (e.message.includes('must implement')) throw e;
        throw new Error(`${ProviderClass.name}: static ${prop} is invalid — ${e.message}`);
      }
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
    if (!models.some(m => m.id === defaultModel)) {
      throw new Error(`${ProviderClass.name}: defaultModel "${defaultModel}" is not in the models list`);
    }
  }

  _validateResponse(result, originalText) {
    if (!result || typeof result !== 'object') {
      log.error('Response validation failed — not an object', result);
      throw new Error('Provider returned invalid response — expected an object');
    }

    if (typeof result.corrected !== 'string') {
      log.error('Response validation failed — missing "corrected" string', result);
      throw new Error('Provider response missing "corrected" string');
    }

    if (!Array.isArray(result.changes)) {
      log.error('Response validation failed — missing "changes" array', result);
      throw new Error('Provider response missing "changes" array');
    }

    for (let i = 0; i < result.changes.length; i++) {
      const c = result.changes[i];
      if (!c || typeof c.original !== 'string' || typeof c.replacement !== 'string' || typeof c.explanation !== 'string') {
        log.error(`Response validation failed — changes[${i}] malformed`, c);
        throw new Error(`Provider response changes[${i}] must have { original, replacement, explanation } strings`);
      }
    }

    log.debug(`Response validated — ${result.changes.length} change(s), corrected text: ${result.corrected.length} chars`);
    return result;
  }
}
