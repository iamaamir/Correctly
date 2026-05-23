import { createProvider } from "../../providers/provider-registry.js";

async function verifySettings(providerId, apiKey, model, log) {
  try {
    const provider = createProvider(providerId || "openai", apiKey, model);
    const result = await provider.correctGrammar("This is a test.");
    if (result && typeof result.corrected === "string") return { success: true };
    return { success: false, error: "Unexpected response from provider" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getExtensionStatus() {
  const { apiKey, enabled } = await chrome.storage.local.get(["apiKey", "enabled"]);
  return { enabled: enabled !== false, configured: Boolean(apiKey) };
}

export function registerSettingsHandlers(handlers, { log }) {
  handlers.set("VERIFY_SETTINGS", async (message, sender, sendResponse, tabInfo) => {
    log.info(`VERIFY_SETTINGS request from ${tabInfo}`, {
      providerId: message.providerId,
      model: message.model,
    });
    try {
      const result = await verifySettings(message.providerId, message.apiKey, message.model, log);
      log.info("Verification result:", result);
      sendResponse(result);
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  });

  handlers.set("GET_STATUS", async (message, sender, sendResponse, tabInfo) => {
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
}
