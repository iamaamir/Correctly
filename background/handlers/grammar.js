import { getSettings } from "../../lib/settings.js";
import { createProvider } from "../../providers/provider-registry.js";
import { BADGE_DURATION_ERROR, BADGE_DURATION_ISSUES, BADGE_DURATION_OK, updateBadge } from "./badge.js";

// ── Per-tab cancellation registry ──

const activeChecksByTabId = new Map();

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isActiveRequest(tabId, requestId) {
  const entry = activeChecksByTabId.get(tabId);
  return entry?.requestId === requestId;
}

export function abortActiveCheckForTab(tabId) {
  const entry = activeChecksByTabId.get(tabId);
  if (entry) {
    entry.controller.abort();
    activeChecksByTabId.delete(tabId);
  }
}

const TOKEN_USAGE_KEY = "sessionTokenUsage";

function createEmptyUsage() {
  return {
    checks: [],
    summary: {
      totalChecks: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
    },
  };
}

let cachedProvider = null;
let cachedProviderKey = "";

const TOKEN_FLUSH_INTERVAL = 30_000;
const TOKEN_MAX_BUFFER = 10;

let tokenUsageBuffer = createEmptyUsage();
let flushTimer = null;

function scheduleTokenFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushTokenUsage();
  }, TOKEN_FLUSH_INTERVAL);
}

async function flushTokenUsage() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (tokenUsageBuffer.checks.length === 0) return;
  try {
    const data = await chrome.storage.session.get([TOKEN_USAGE_KEY]);
    const stored = data[TOKEN_USAGE_KEY] || createEmptyUsage();
    stored.checks.push(...tokenUsageBuffer.checks);
    stored.summary.totalChecks += tokenUsageBuffer.summary.totalChecks;
    stored.summary.totalPromptTokens += tokenUsageBuffer.summary.totalPromptTokens;
    stored.summary.totalCompletionTokens += tokenUsageBuffer.summary.totalCompletionTokens;
    stored.summary.totalTokens += tokenUsageBuffer.summary.totalTokens;
    await chrome.storage.session.set({ [TOKEN_USAGE_KEY]: stored });
    tokenUsageBuffer = createEmptyUsage();
  } catch (_err) {
    // silent — non-critical background op
  }
}

function addTokenUsageRecord(record) {
  tokenUsageBuffer.checks.push(record);
  tokenUsageBuffer.summary.totalChecks++;
  tokenUsageBuffer.summary.totalPromptTokens += record.prompt_tokens;
  tokenUsageBuffer.summary.totalCompletionTokens += record.completion_tokens;
  tokenUsageBuffer.summary.totalTokens += record.total_tokens;
  scheduleTokenFlush();
  if (tokenUsageBuffer.checks.length >= TOKEN_MAX_BUFFER) {
    flushTokenUsage();
  }
}

function getOrCreateProvider(providerId, apiKey, model, baseUrl, log) {
  const key = `${providerId}|${apiKey}|${model}|${baseUrl || ""}`;
  if (cachedProvider && cachedProviderKey === key) {
    log.debug("Reusing cached provider instance");
    return cachedProvider;
  }
  log.debug("Creating new provider instance (settings changed)");
  cachedProvider = createProvider(providerId, apiKey, model, baseUrl);
  cachedProviderKey = key;
  return cachedProvider;
}

async function createGrammarContext(log) {
  const { providerId, apiKey, model, baseUrl, enabled } = await getSettings();
  log.debug("Settings loaded", {
    providerId,
    model: model || "default",
    enabled,
    hasKey: Boolean(apiKey),
  });
  if (!enabled) throw new Error("Correctly is disabled");
  if (!apiKey) throw new Error("No API key configured. Click the Correctly icon to set one up.");
  const provider = getOrCreateProvider(providerId, apiKey, model, baseUrl, log);
  log.info(`Using provider: ${provider.providerName}, model: ${provider.model}`);
  return { provider };
}

async function runGrammarCheck(text, { tabId, provider, signal, requestId }) {
  const result = await provider.correctGrammar(text, {
    signal,
    onProgress: (info) => {
      if (tabId && !signal?.aborted && isActiveRequest(tabId, requestId)) {
        chrome.tabs.sendMessage(tabId, { type: "CHECK_PROGRESS", status: info.status }).catch(() => {});
      }
    },
  });

  if (result.usage) {
    addTokenUsageRecord({
      provider: provider.providerId,
      model: provider.model,
      prompt_tokens: result.usage.prompt_tokens || 0,
      completion_tokens: result.usage.completion_tokens || 0,
      total_tokens: result.usage.total_tokens || 0,
      timestamp: Date.now(),
    });
  }

  return {
    corrected: result.corrected,
    changes: result.changes,
    confidence: result.confidence,
    cascadeLevel: result.cascadeLevel,
    responseTimeMs: result.responseTimeMs,
  };
}

export function registerGrammarHandlers(handlers, { log }) {
  handlers.set("CHECK_GRAMMAR", async (message, sender, sendResponse, tabInfo) => {
    const tabId = sender.tab?.id;
    log.info(`CHECK_GRAMMAR request from ${tabInfo}`, {
      textLength: message.text?.length,
    });
    const endTimer = log.time("grammar-check");

    if (tabId) {
      abortActiveCheckForTab(tabId);
    }

    updateBadge(tabId, "checking");

    try {
      const { provider } = await createGrammarContext(log);

      const controller = new AbortController();
      const requestId = createRequestId();

      if (tabId) {
        activeChecksByTabId.set(tabId, { controller, provider, requestId });
      }

      try {
        const result = await runGrammarCheck(message.text, {
          tabId,
          provider,
          signal: controller.signal,
          requestId,
        });

        endTimer();
        const hasIssues = result.changes?.length > 0;
        if (!tabId || isActiveRequest(tabId, requestId)) {
          updateBadge(tabId, hasIssues ? "found" : "ok");
          setTimeout(() => updateBadge(tabId, "ready"), hasIssues ? BADGE_DURATION_ISSUES : BADGE_DURATION_OK);
          log.group("CHECK_GRAMMAR result", () => {
            log.info(`Changes found: ${result.changes?.length || 0}`);
            if (result.changes?.length > 0) log.table(result.changes);
          });
          sendResponse({ success: true, data: result });
        }
      } finally {
        const entry = activeChecksByTabId.get(tabId);
        if (entry?.requestId === requestId && entry?.controller === controller) {
          activeChecksByTabId.delete(tabId);
        }
      }
    } catch (err) {
      endTimer();
      if (err.name === "AbortError") {
        if (tabId) {
          updateBadge(tabId, "ready");
        }
        log.debug("CHECK_GRAMMAR cancelled");
        sendResponse({ success: false, cancelled: true, error: "Request cancelled" });
        return true;
      }
      updateBadge(tabId, "error");
      setTimeout(() => updateBadge(tabId, "ready"), BADGE_DURATION_ERROR);
      log.error("CHECK_GRAMMAR failed:", err.message);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  });

  handlers.set("GET_SESSION_USAGE", async (_message, _sender, sendResponse, tabInfo) => {
    log.debug(`GET_SESSION_USAGE request from ${tabInfo}`);
    try {
      await flushTokenUsage();
      const data = await chrome.storage.session.get([TOKEN_USAGE_KEY]);
      sendResponse(data[TOKEN_USAGE_KEY] || createEmptyUsage());
    } catch (err) {
      log.error("GET_SESSION_USAGE failed:", err.message);
      sendResponse(createEmptyUsage());
    }
    return true;
  });
}

export async function invalidateProviderCache(log) {
  const oldProvider = cachedProvider;
  cachedProvider = null;
  cachedProviderKey = "";
  await flushTokenUsage();
  chrome.storage.session.remove(TOKEN_USAGE_KEY);
  log.debug("Provider cache invalidated — token usage cleared");

  for (const [tabId, entry] of activeChecksByTabId) {
    if (entry.provider === oldProvider) {
      entry.controller.abort();
      activeChecksByTabId.delete(tabId);
    }
  }

  await oldProvider?.destroySessions?.();
}

export function collectProviderMetrics() {
  const measures = performance.getEntriesByType("measure");
  const correctly = measures.filter((m) => m.name.startsWith("correctly:"));

  const groups = {};
  for (const m of correctly) {
    if (!groups[m.name]) groups[m.name] = [];
    groups[m.name].push(m.duration);
  }

  const summarized = {};
  for (const [name, durations] of Object.entries(groups)) {
    const sorted = [...durations].sort((a, b) => a - b);
    summarized[name] = {
      count: durations.length,
      totalMs: Math.round(durations.reduce((s, d) => s + d, 0) * 10) / 10,
      avgMs: Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10,
      minMs: Math.round(sorted[0] * 10) / 10,
      maxMs: Math.round(sorted[sorted.length - 1] * 10) / 10,
    };
  }

  let sessionMetrics = null;
  let cascadeMetrics = null;
  if (cachedProvider && typeof cachedProvider.getSessionMetrics === "function") {
    sessionMetrics = cachedProvider.getSessionMetrics();
  }
  if (cachedProvider && typeof cachedProvider.getCascadeMetrics === "function") {
    cascadeMetrics = cachedProvider.getCascadeMetrics();
  }

  return {
    performanceMeasures: summarized,
    provider: {
      id: cachedProvider?.providerId ?? null,
      model: cachedProvider?.model ?? null,
      sessionMetrics,
      cascadeMetrics,
    },
    activeChecks: activeChecksByTabId.size,
  };
}
