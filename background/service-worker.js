import { createLogger } from "../lib/logger.js";
import { getSettings } from "../lib/settings.js";
import { updateBadge } from "./handlers/badge.js";
import { registerGrammarHandlers, invalidateProviderCache } from "./handlers/grammar.js";
import { registerSettingsHandlers } from "./handlers/settings.js";
import { registerChromeFreeAIHandlers } from "./handlers/chrome-free-ai.js";

const log = createLogger("bg");
log.info("Service worker started");

// ── Badge init ──

getSettings().then(({ apiKey, enabled }) => {
  if (!apiKey) updateBadge(null, "nokey");
  else if (!enabled) updateBadge(null, "off");
  else updateBadge(null, "ready");
});

// ── Storage listener (badge + cache invalidation) ──

chrome.storage.onChanged.addListener((changes) => {
  log.debug("Storage changed:", Object.keys(changes));

  if (changes.providerId || changes.apiKey || changes.model) {
    invalidateProviderCache(log);
  }

  getSettings().then(({ apiKey, enabled }) => {
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
});
