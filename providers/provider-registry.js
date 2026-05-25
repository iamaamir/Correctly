/**
 * Provider Registry
 *
 * To add a new provider:
 *   1. Create a new file extending AbstractProvider (or AbstractOpenAICompatibleProvider
 *      for OpenAI-compatible APIs)
 *   2. Implement all required static metadata and _doCorrectGrammar()
 *   3. Import it below and add the class to the PROVIDER_CLASSES array
 *
 * That's it. The registry reads all metadata from the class itself.
 * The AbstractProvider contract enforces correctness at instantiation time.
 */

import { getCachedAvailability, setCachedAvailability } from "../lib/cache.js";
import { createLogger } from "../lib/logger.js";
import { ChromeFreeAIProvider } from "./chrome-free-ai-provider.js";
import { GenericOpenAIProvider } from "./generic-openai-provider.js";
import { LMStudioProvider } from "./lmstudio-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { OpenAIProvider } from "./openai-provider.js";

const log = createLogger("registry");

// ── Add new provider classes here ──
const PROVIDER_CLASSES = [
  OpenAIProvider,
  ChromeFreeAIProvider,
  OllamaProvider,
  LMStudioProvider,
  GenericOpenAIProvider,
];

const PROVIDERS_BY_ID = Object.fromEntries(PROVIDER_CLASSES.map((P) => [P.id, P]));

log.info(`Registered ${PROVIDER_CLASSES.length} provider(s): ${PROVIDER_CLASSES.map((P) => P.id).join(", ")}`);

export function createProvider(providerId, apiKey, model, baseUrl) {
  const ProviderClass = PROVIDERS_BY_ID[providerId];
  if (!ProviderClass) {
    const available = PROVIDER_CLASSES.map((P) => P.id).join(", ");
    log.error(`Unknown provider "${providerId}". Available: ${available}`);
    throw new Error(`Unknown provider: "${providerId}". Available: ${available}`);
  }
  log.debug(`Creating provider: ${ProviderClass.displayName} (model: ${model || ProviderClass.defaultModel})`);
  return new ProviderClass(apiKey, model, baseUrl);
}

export async function getAvailableProviders() {
  const list = await Promise.all(
    PROVIDER_CLASSES.map(async (P) => {
      let available = true;
      if (P.isAvailable) {
        const cached = getCachedAvailability(P.id);
        if (cached !== null) {
          available = cached;
        } else {
          available = await P.isAvailable();
          setCachedAvailability(P.id, available);
        }
      }
      if (!available) {
        log.info(`Provider ${P.id} is not available`);
      }
      return {
        id: P.id,
        name: P.displayName,
        keyPlaceholder: P.keyPlaceholder,
        requiresApiKey: P.requiresApiKey,
        models: P.models,
        defaultModel: P.defaultModel,
        available,
        // back-reference to the provider class, used by the popup for:
        //   - lazy model fetching  (_classRef.getModels())
        //   - reading static metadata  (_classRef.availabilityHint)
        _classRef: P,
      };
    }),
  );

  log.info(
    `Available providers: ${list
      .filter((p) => p.available)
      .map((p) => p.id)
      .join(", ")}`,
  );
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
    requiresApiKey: ProviderClass.requiresApiKey,
    models: ProviderClass.models,
    defaultModel: ProviderClass.defaultModel,
  };
}
