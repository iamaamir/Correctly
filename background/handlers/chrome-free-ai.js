import { ChromeFreeAIProvider } from "../../providers/chrome-free-ai-provider.js";

export function registerChromeFreeAIHandlers(handlers, { log }) {
  handlers.set("GET_AI_STATUS", (message, sender, sendResponse) => {
    ChromeFreeAIProvider.getStatus()
      .then((status) => {
        log.info(`AI status request: ${status}`);
        sendResponse({ status });
      })
      .catch((err) => {
        log.error("GET_AI_STATUS failed:", err.message);
        sendResponse({ status: ChromeFreeAIProvider.STATUS.UNAVAILABLE });
      });
  });

  handlers.set("TRIGGER_MODEL_DOWNLOAD", (message, sender, sendResponse) => {
    log.info("Model download triggered by popup");
    ChromeFreeAIProvider.ensureModel().catch((err) => {
      log.error("Model download failed:", err.message);
    });
    sendResponse({ triggered: true });
  });
}
