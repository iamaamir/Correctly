import { createLogger } from "../lib/logger.js";
import { clearSettingsCache, getSettings } from "../lib/settings.js";
import { unloadProviderModel } from "../providers/provider-registry.js";
import { updateBadge } from "./handlers/badge.js";
import { registerChromeFreeAIHandlers } from "./handlers/chrome-free-ai.js";
import { invalidateProviderCache, registerGrammarHandlers } from "./handlers/grammar.js";
import { registerSettingsHandlers } from "./handlers/settings.js";

const log = createLogger("bg");
log.info("Service worker started");

// ── Provider state for unload-on-switch ──

let lastProviderState = { providerId: null, model: null };

getSettings().then(({ providerId, model, apiKey, enabled }) => {
  lastProviderState = { providerId, model };
  if (!apiKey) updateBadge(null, "nokey");
  else if (!enabled) updateBadge(null, "off");
  else updateBadge(null, "ready");
});

// ── Storage listener (badge + cache invalidation + unload hook) ──

chrome.storage.onChanged.addListener((changes) => {
  log.debug("Storage changed:", Object.keys(changes));
  clearSettingsCache();

  if (changes.providerId || changes.model) {
    const oldProviderId = changes.providerId?.oldValue ?? lastProviderState.providerId;
    const oldModel = changes.model?.oldValue ?? lastProviderState.model;
    if (oldProviderId && oldModel) {
      unloadProviderModel(oldProviderId, oldModel);
    }
  }

  if (changes.providerId || changes.apiKey || changes.model || changes.baseUrl) {
    invalidateProviderCache(log);
  }

  getSettings().then(({ providerId, model, apiKey, enabled }) => {
    lastProviderState = { providerId, model };
    if (!apiKey) updateBadge(null, "nokey");
    else if (!enabled) updateBadge(null, "off");
    else updateBadge(null, "ready");
  });
});

// ── Message router ──

const handlers = new Map();
registerGrammarHandlers(handlers, { log });
registerSettingsHandlers(handlers, { log });
registerChromeFreeAIHandlers(handlers, { log });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabInfo = sender.tab ? `tab:${sender.tab.id} ${sender.tab.url}` : "popup";
  const handler = handlers.get(message.type);
  if (handler) {
    handler(message, sender, sendResponse, tabInfo);
    return true;
  }
  log.warn("Unknown message type:", message.type);
  sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
});
