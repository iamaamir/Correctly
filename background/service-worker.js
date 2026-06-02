import { createLogger } from "../lib/logger.js";
import { clearSettingsCache, getSettings } from "../lib/settings.js";
import { unloadProviderModel } from "../providers/provider-registry.js";
import { updateBadge } from "./handlers/badge.js";
import { registerChromeFreeAIHandlers } from "./handlers/chrome-free-ai.js";
import {
  abortActiveCheckForTab,
  collectProviderMetrics,
  invalidateProviderCache,
  registerGrammarHandlers,
} from "./handlers/grammar.js";
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

// ── Tab cleanup — abort in-flight checks when tab is closed ──

chrome.tabs.onRemoved.addListener((tabId) => {
  abortActiveCheckForTab(tabId);
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

// ── Console-accessible metrics collector ──

/**
 * Type `collectCorrectlyMetrics()` in the service worker DevTools console
 * to see a live snapshot of:
 *   - correctly:* PerformanceMeasure entries (aggregated)
 *   - Provider session lifecycle counters
 *   - Provider cascade counters
 *   - Active in-flight check count
 *
 * Returns the raw data object for further inspection.
 */
self.collectCorrectlyMetrics = () => {
  const data = collectProviderMetrics();

  console.log("%c── Correctly Session Lifecycle Metrics ──", "font-weight:bold;font-size:14px");

  const { performanceMeasures, provider, activeChecks } = data;

  if (Object.keys(performanceMeasures).length > 0) {
    console.log("%cPerformanceMeasures (correctly:*)", "font-weight:bold");
    console.table(performanceMeasures);
  } else {
    console.log("No correctly:* PerformanceMeasure entries found.");
    console.log("  Grammar checks will create entries as they run.");
  }

  if (provider.sessionMetrics) {
    console.log("%cSession Lifecycle Counters", "font-weight:bold");
    console.table(provider.sessionMetrics);
  }

  if (provider.cascadeMetrics) {
    console.log("%cCascade Counters", "font-weight:bold");
    console.table({
      "total checks": provider.cascadeMetrics.calls,
      "L1 attempts": provider.cascadeMetrics.levelAttempts[0],
      "L1 successes": provider.cascadeMetrics.levelSuccesses[0],
      "L2 attempts": provider.cascadeMetrics.levelAttempts[1],
      "L3 attempts": provider.cascadeMetrics.levelAttempts[2],
      aborted: provider.cascadeMetrics.aborted,
    });
  }

  console.log(`%cActive in-flight checks: ${activeChecks}`, "font-weight:bold");

  if (!provider.sessionMetrics && !provider.cascadeMetrics) {
    console.log(
      "%cNote: Provider metrics only available for ChromeFreeAIProvider after a grammar check has run.",
      "color:#888",
    );
  }

  console.log("%cRaw data returned — assign to a variable: const m = collectCorrectlyMetrics()", "color:#888");
  return data;
};

// Also register it as a message handler so content/popup can request metrics
handlers.set("COLLECT_METRICS", async (_message, _sender, sendResponse) => {
  sendResponse(collectProviderMetrics());
  return true;
});
