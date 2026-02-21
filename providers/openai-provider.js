import { BaseProvider } from './base-provider.js';
import { createLogger } from '../lib/logger.js';
import { SYSTEM_PROMPT, AI_TEMPERATURE, AI_MAX_TOKENS_MIN } from '../lib/config.js';

const log = createLogger('openai');

const RESPONSE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'grammar_correction',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        corrected: { type: 'string' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string' },
              replacement: { type: 'string' },
              explanation: { type: 'string' },
            },
            required: ['original', 'replacement', 'explanation'],
            additionalProperties: false,
          },
        },
      },
      required: ['corrected', 'changes'],
      additionalProperties: false,
    },
  },
};

export class OpenAIProvider extends BaseProvider {

  // ── Static metadata (required by BaseProvider contract) ──

  static get id() { return 'openai'; }

  static get displayName() { return 'OpenAI'; }

  static get keyPlaceholder() { return 'sk-...'; }

  static get defaultModel() { return 'gpt-4o-mini'; }

  static get models() {
    return [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', hint: 'Fast & cheap' },
      { id: 'gpt-4o', label: 'GPT-4o', hint: 'Best quality' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', hint: 'Fastest, lowest cost' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', hint: 'Balanced' },
      { id: 'gpt-4.1', label: 'GPT-4.1', hint: 'Most capable' },
    ];
  }

  // ── Instance ──

  constructor(apiKey, model) {
    super(apiKey, model);
    this.endpoint = 'https://api.openai.com/v1/chat/completions';
  }

  async _doCorrectGrammar(text) {
    const maxTokens = Math.max(text.length * 3, AI_MAX_TOKENS_MIN);

    const payload = {
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text }
      ],
      temperature: AI_TEMPERATURE,
      max_tokens: maxTokens,
      response_format: RESPONSE_SCHEMA,
    };

    log.info(`API request → ${this.endpoint}`, { model: this.model, inputLength: text.length });
    log.debug('Request payload:', payload);
    log.debug(`Using key: ${this.apiKey.substring(0, 7)}...`);

    const endTimer = log.time('openai-api-call');
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      endTimer();
      const err = await response.json().catch(() => ({}));
      log.error(`API error ${response.status}:`, err);
      throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    endTimer();

    log.group('API response', () => {
      log.info(`Status: ${response.status}`);
      log.info(`Model used: ${data.model}`);
      if (data.usage) {
        log.info(`Tokens — prompt: ${data.usage.prompt_tokens}, completion: ${data.usage.completion_tokens}, total: ${data.usage.total_tokens}`);
      }
    });

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      log.error('Empty content in API response:', data);
      throw new Error('Empty response from OpenAI');
    }

    log.debug('Raw response content:', content);

    try {
      const parsed = JSON.parse(content);
      log.info(`Parsed result — ${parsed.changes?.length || 0} corrections`);
      return parsed;
    } catch (e) {
      log.error('JSON parse failed. Raw content:', content);
      throw new Error('Failed to parse grammar correction response');
    }
  }
}
