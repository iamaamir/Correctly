import { createProvider } from "../../providers/provider-registry.js";
import { updateBadge, BADGE_DURATION_ISSUES, BADGE_DURATION_OK, BADGE_DURATION_ERROR } from "./badge.js";

const TOKEN_USAGE_KEY = "sessionTokenUsage";
const DEFAULT_USAGE = {
  checks: [],
  summary: { totalChecks: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0 },
};

let cachedProvider = null;
let cachedProviderKey = "";

function getOrCreateProvider(providerId, apiKey, model, log) {
  const key = `${providerId}|${apiKey}|${model}`;
  if (cachedProvider && cachedProviderKey === key) {
    log.debug("Reusing cached provider instance");
    return cachedProvider;
  }
  log.debug("Creating new provider instance (settings changed)");
  cachedProvider = createProvider(providerId, apiKey, model);
  cachedProviderKey = key;
  return cachedProvider;
}

async function handleGrammarCheck(text, log) {
  const { providerId, apiKey, model, enabled } = await chrome.storage.local.get([
    "providerId", "apiKey", "model", "enabled",
  ]);

  log.debug("Settings loaded", {
    providerId: providerId || "openai",
    model: model || "default",
    enabled,
    hasKey: Boolean(apiKey),
  });

  if (enabled === false) throw new Error("Correctly is disabled");
  if (!apiKey) throw new Error("No API key configured. Click the Correctly icon to set one up.");

  const provider = getOrCreateProvider(providerId || "openai", apiKey, model, log);
  log.info(`Using provider: ${provider.providerName}, model: ${provider.model}`);

  const result = await provider.correctGrammar(text);

  if (result.usage) {
    await persistTokenUsage({
      provider: provider.providerId,
      model: provider.model,
      prompt_tokens: result.usage.prompt_tokens || 0,
      completion_tokens: result.usage.completion_tokens || 0,
      total_tokens: result.usage.total_tokens || 0,
      timestamp: Date.now(),
    }, log);
  }

  return { corrected: result.corrected, changes: result.changes };
}

async function persistTokenUsage(record, log) {
  try {
    const data = await chrome.storage.session.get([TOKEN_USAGE_KEY]);
    const current = data[TOKEN_USAGE_KEY] || { checks: [], summary: { ...DEFAULT_USAGE.summary } };
    current.checks.push(record);
    current.summary.totalChecks++;
    current.summary.totalPromptTokens += record.prompt_tokens;
    current.summary.totalCompletionTokens += record.completion_tokens;
    current.summary.totalTokens += record.total_tokens;
    await chrome.storage.session.set({ [TOKEN_USAGE_KEY]: current });
    log.debug(`Token usage persisted — ${record.total_tokens} total tokens (${current.summary.totalChecks} checks)`);
  } catch (err) {
    log.error("Failed to persist token usage:", err.message);
  }
}

export function registerGrammarHandlers(handlers, { log }) {
  handlers.set("CHECK_GRAMMAR", (message, sender, sendResponse, tabInfo) => {
    const tabId = sender.tab?.id;
    log.info(`CHECK_GRAMMAR request from ${tabInfo}`, { textLength: message.text?.length });
    const endTimer = log.time("grammar-check");

    updateBadge(tabId, "checking");

    handleGrammarCheck(message.text, log)
      .then((result) => {
        endTimer();
        const hasIssues = result.changes?.length > 0;
        updateBadge(tabId, hasIssues ? "found" : "ok");
        setTimeout(
          () => updateBadge(tabId, "ready"),
          hasIssues ? BADGE_DURATION_ISSUES : BADGE_DURATION_OK,
        );
        log.group("CHECK_GRAMMAR result", () => {
          log.info(`Changes found: ${result.changes?.length || 0}`);
          if (result.changes?.length > 0) log.table(result.changes);
        });
        sendResponse({ success: true, data: result });
      })
      .catch((err) => {
        endTimer();
        updateBadge(tabId, "error");
        setTimeout(() => updateBadge(tabId, "ready"), BADGE_DURATION_ERROR);
        log.error("CHECK_GRAMMAR failed:", err.message);
        sendResponse({ success: false, error: err.message });
      });
  });

  handlers.set("GET_SESSION_USAGE", (message, sender, sendResponse, tabInfo) => {
    log.debug(`GET_SESSION_USAGE request from ${tabInfo}`);
    chrome.storage.session
      .get([TOKEN_USAGE_KEY])
      .then((data) => {
        sendResponse(data[TOKEN_USAGE_KEY] || { checks: [], summary: { ...DEFAULT_USAGE.summary } });
      })
      .catch((err) => {
        log.error("GET_SESSION_USAGE failed:", err.message);
        sendResponse({ checks: [], summary: { ...DEFAULT_USAGE.summary } });
      });
  });
}

export function invalidateProviderCache(log) {
  cachedProvider = null;
  cachedProviderKey = "";
  chrome.storage.session.remove(TOKEN_USAGE_KEY);
  log.debug("Provider cache invalidated — token usage cleared");
}
