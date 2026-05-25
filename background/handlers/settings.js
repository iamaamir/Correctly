import { getSettings } from "../../lib/settings.js";
import { createProvider } from "../../providers/provider-registry.js";

const TRAILING_SLASHES = /\/+$/;

const VERIFY_TEXT = "Aamir go to school yesterday";

async function verifySettings(providerId, apiKey, model, baseUrl, log) {
  try {
    const provider = createProvider(providerId || "openai", apiKey, model, baseUrl);
    const result = await provider.correctGrammar(VERIFY_TEXT);
    if (!result || typeof result.corrected !== "string") {
      return { success: false, error: "Unexpected response from provider" };
    }
    if (!Array.isArray(result.changes) || result.changes.length === 0) {
      log.warn("Verify: no changes reported for known-incorrect input");
    }
    log.info(`Verify result: "${result.corrected}"`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getExtensionStatus() {
  const { apiKey, enabled } = await getSettings();
  return { enabled, configured: Boolean(apiKey) };
}

export function registerSettingsHandlers(handlers, { log }) {
  handlers.set("VERIFY_SETTINGS", async (message, _sender, sendResponse, tabInfo) => {
    log.info(`VERIFY_SETTINGS request from ${tabInfo}`, {
      providerId: message.providerId,
      model: message.model,
    });
    try {
      const result = await verifySettings(message.providerId, message.apiKey, message.model, message.baseUrl, log);
      log.info("Verification result:", result);
      sendResponse(result);
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  });

  handlers.set("GET_STATUS", async (_message, _sender, sendResponse, tabInfo) => {
    log.debug(`GET_STATUS request from ${tabInfo}`);
    try {
      const status = await getExtensionStatus();
      log.debug("Status:", status);
      sendResponse(status);
    } catch (err) {
      log.error("GET_STATUS failed:", err.message);
      sendResponse({ enabled: false, configured: false });
    }
    return true;
  });

  handlers.set("FETCH_MODELS", async (message, _sender, sendResponse, _tabInfo) => {
    const baseUrl = message.baseUrl;
    const apiKey = message.apiKey || "";
    if (!baseUrl) {
      sendResponse({ success: false, error: "Base URL is required" });
      return true;
    }

    log.info(`FETCH_MODELS from ${baseUrl}`);
    try {
      const url = `${baseUrl.replace(TRAILING_SLASHES, "")}/models`;
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        sendResponse({
          success: false,
          error: `Server returned ${response.status}`,
        });
        return true;
      }
      const data = await response.json();
      const models = (data.data || []).map((m) => ({
        id: m.id,
        label: m.id,
        hint: m.owned_by ? `by ${m.owned_by}` : "",
      }));
      log.info(`Fetched ${models.length} models from ${baseUrl}`);
      sendResponse({ success: true, data: models });
    } catch (err) {
      log.warn(`FETCH_MODELS failed: ${err.message}`);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  });
}
