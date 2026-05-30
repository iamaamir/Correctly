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
 * AbstractProvider.enforceContract() validates every class at module load time —
 * violators are dropped with a clear warning, valid providers continue working.
 */

import { getCachedAvailability, getCachedModels, setCachedAvailability } from "../lib/cache.js";
import { createLogger } from "../lib/logger.js";
import { AbstractProvider } from "./abstract-provider.js";
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

// ── Validate contracts at module load — catch violations early ──
const VALID_PROVIDER_CLASSES = [];
const DROPPED = [];

for (const P of PROVIDER_CLASSES) {
  try {
    AbstractProvider.enforceContract(P);
    VALID_PROVIDER_CLASSES.push(P);
  } catch (err) {
    DROPPED.push(`${P.name || P.id}: ${err.message}`);
  }
}

if (DROPPED.length > 0) {
  log.warn(`Provider(s) excluded — contract violations:`, DROPPED);
}

const PROVIDERS_BY_ID = new Map(VALID_PROVIDER_CLASSES.map((P) => [P.id, P]));

log.info(
  `Registered ${VALID_PROVIDER_CLASSES.length} / ${PROVIDER_CLASSES.length} provider(s): ${VALID_PROVIDER_CLASSES.map((P) => P.id).join(", ")}`,
);

export function createProvider(providerId, apiKey, model, baseUrl) {
  const ProviderClass = PROVIDERS_BY_ID.get(providerId);
  if (!ProviderClass) {
    const available = VALID_PROVIDER_CLASSES.map((P) => P.id).join(", ");
    log.error(`Unknown provider "${providerId}". Available: ${available}`);
    throw new Error(`Unknown provider: "${providerId}". Available: ${available}`);
  }
  log.debug(`Creating provider: ${ProviderClass.displayName} (model: ${model || ProviderClass.defaultModel})`);
  return new ProviderClass(apiKey, model, baseUrl);
}

export async function getAvailableProviders() {
  const list = await Promise.all(
    VALID_PROVIDER_CLASSES.map(async (P) => {
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
        // Lazy getter: evaluated each time it's accessed (popup re-reads after
        // getModels() populates cache). Falls back to class static defaultModel
        // when cache is empty (init time or first load).
        get defaultModel() {
          const cached = getCachedModels(P.id);
          if (cached && cached.length > 0) return cached[0].id;
          return P.defaultModel;
        },
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
  const ProviderClass = PROVIDERS_BY_ID.get(providerId);
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

/**
 * Fire-and-forget provider model unload hook.
 * Called when user switches model/provider. Providers implement
 * onModelUnloaded() to clean up resources. Errors are caught and logged.
 * Never blocks or breaks the caller.
 */
export async function unloadProviderModel(providerId, modelId) {
  if (!providerId || !modelId) return;
  const ProviderClass = PROVIDERS_BY_ID.get(providerId);
  if (ProviderClass?.onModelUnloaded) {
    try {
      await ProviderClass.onModelUnloaded(modelId);
    } catch (err) {
      log.warn(`onModelUnloaded hook failed for ${providerId}: ${err.message}`);
    }
  }
}
