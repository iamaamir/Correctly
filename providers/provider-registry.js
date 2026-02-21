/**
 * Provider Registry
 *
 * To add a new provider:
 *   1. Create a new file (e.g. anthropic-provider.js) extending BaseProvider
 *   2. Implement all required static metadata and _doCorrectGrammar()
 *   3. Import it below and add the class to the PROVIDER_CLASSES array
 *
 * That's it. The registry reads all metadata from the class itself.
 * The BaseProvider contract enforces correctness at instantiation time.
 */

import { OpenAIProvider } from './openai-provider.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('registry');

// ── Add new provider classes here ──
const PROVIDER_CLASSES = [
  OpenAIProvider,
];

const PROVIDERS_BY_ID = Object.fromEntries(
  PROVIDER_CLASSES.map(P => [P.id, P])
);

log.info(`Registered ${PROVIDER_CLASSES.length} provider(s): ${PROVIDER_CLASSES.map(P => P.id).join(', ')}`);

export function createProvider(providerId, apiKey, model) {
  const ProviderClass = PROVIDERS_BY_ID[providerId];
  if (!ProviderClass) {
    const available = PROVIDER_CLASSES.map(P => P.id).join(', ');
    log.error(`Unknown provider "${providerId}". Available: ${available}`);
    throw new Error(`Unknown provider: "${providerId}". Available: ${available}`);
  }
  log.debug(`Creating provider: ${ProviderClass.displayName} (model: ${model || ProviderClass.defaultModel})`);
  return new ProviderClass(apiKey, model);
}

export function getAvailableProviders() {
  const list = PROVIDER_CLASSES.map(P => ({
    id: P.id,
    name: P.displayName,
    keyPlaceholder: P.keyPlaceholder,
    models: P.models,
    defaultModel: P.defaultModel,
  }));
  log.debug(`Returning ${list.length} available provider(s)`);
  return list;
}

export function getProviderInfo(providerId) {
  const ProviderClass = PROVIDERS_BY_ID[providerId];
  if (!ProviderClass) {
    log.warn(`getProviderInfo: unknown provider "${providerId}"`);
    return null;
  }
  return {
    id: ProviderClass.id,
    name: ProviderClass.displayName,
    keyPlaceholder: ProviderClass.keyPlaceholder,
    models: ProviderClass.models,
    defaultModel: ProviderClass.defaultModel,
  };
}
