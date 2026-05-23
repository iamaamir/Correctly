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
  handlers.set("VERIFY_SETTINGS", (message, sender, sendResponse, tabInfo) => {
    log.info(`VERIFY_SETTINGS request from ${tabInfo}`, {
      providerId: message.providerId,
      model: message.model,
    });
    verifySettings(message.providerId, message.apiKey, message.model, log)
      .then((result) => {
        log.info("Verification result:", result);
        sendResponse(result);
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
  });

  handlers.set("GET_STATUS", (message, sender, sendResponse, tabInfo) => {
    log.debug(`GET_STATUS request from ${tabInfo}`);
    getExtensionStatus()
      .then((status) => {
        log.debug("Status:", status);
        sendResponse(status);
      })
      .catch((err) => {
        log.error("GET_STATUS failed:", err.message);
        sendResponse({ enabled: false, configured: false });
      });
  });
}
