export async function configureOpenAICompatibleViaPopup({
  popup,
  baseUrl,
  apiKey = "test-key",
  model = "mock-model-a",
}) {
  await popup.waitForSelector("#provider-select", { timeout: 10000 });
  await popup.selectOption("#provider-select", "openai-compatible");
  await popup.fill("#base-url", baseUrl);
  await popup.fill("#api-key", apiKey);
  await popup.waitForFunction(
    (m) => Array.from(document.querySelectorAll("#model-select option")).some((o) => o.value === m),
    model,
    { timeout: 15000 },
  );
  await popup.selectOption("#model-select", model);
  await popup.click("#save-btn");
}

export async function seedOpenAICompatibleViaServiceWorker({
  sw,
  baseUrl,
  apiKey = "test-key",
  model = "mock-model-a",
}) {
  await sw.evaluate(
    async (cfg) => {
      await chrome.storage.local.set({
        providerId: "openai-compatible",
        apiKey: cfg.apiKey,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        enabled: true,
        disabledSites: [],
      });
    },
    { baseUrl, apiKey, model },
  );
}
