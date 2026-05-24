import { ChromeFreeAIProvider } from "../../providers/chrome-free-ai-provider.js";

export function registerChromeFreeAIHandlers(handlers, { log }) {
  handlers.set("GET_AI_STATUS", async (_message, _sender, sendResponse) => {
    try {
      const status = await ChromeFreeAIProvider.getStatus();
      log.info(`AI status request: ${status}`);
      sendResponse({ status });
    } catch (err) {
      log.error("GET_AI_STATUS failed:", err.message);
      sendResponse({ status: ChromeFreeAIProvider.STATUS.UNAVAILABLE });
    }
    return true;
  });

  handlers.set("TRIGGER_MODEL_DOWNLOAD", async (_message, _sender, sendResponse) => {
    log.info("Model download triggered by popup");
    try {
      await ChromeFreeAIProvider.ensureModel();
      sendResponse({ triggered: true });
    } catch (err) {
      log.error("Model download failed:", err.message);
      sendResponse({ triggered: false, error: err.message });
    }
    return true;
  });
}
